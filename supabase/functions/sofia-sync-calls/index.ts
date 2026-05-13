import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sofiaFetch, corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Sincroniza chamadas da Sofia (GET /api/user/calls) com sofia_calls.
 * Aceita body opcional: { date_from?, date_to?, max_pages? }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dateFrom = body.date_from as string | undefined;
    const dateTo = body.date_to as string | undefined;
    const maxPages = Math.min(Math.max(parseInt(body.max_pages ?? "20", 10), 1), 100);

    // Mapa: sofia_id (assistant) → uuid local (pra FK via assistant_sofia_id é bigint, mas RESTRICT no FK precisa existir)
    // Já que assistant_sofia_id é bigint não-fk, não preciso buscar. Vou só armazenar o sofia_id.

    const collected: any[] = [];
    const params = new URLSearchParams();
    params.set("per_page", "100");
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    for (let page = 1; page <= maxPages; page++) {
      params.set("page", String(page));
      const r = await sofiaFetch(`/user/calls?${params}`);
      if (!r.ok) {
        const text = await r.text();
        return jsonResponse({ error: "Falha ao buscar chamadas", status: r.status, body: text.slice(0, 500) }, 502);
      }
      const data = await r.json();
      const pageData = data.data ?? [];
      collected.push(...pageData);
      if (!data.last_page || data.current_page >= data.last_page || pageData.length === 0) break;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Pegar sofia_id → assistant id mapping (pra resolver assistant_sofia_id)
    // Aqui assistant_sofia_id da chamada é null no payload da Sofia listing — vem só assistant_name
    // Vou consultar localmente por nome
    const { data: assistants } = await supabase
      .from("sofia_assistants")
      .select("sofia_id, name");
    const nameToSofiaId = new Map<string, number>();
    (assistants ?? []).forEach((a) => nameToSofiaId.set(a.name, a.sofia_id));

    const rows = collected.map((c: any) => {
      // Direção: Sofia retorna 'inbound' | 'outbound' | 'web' — mapeamos 'web' como 'inbound'
      const direction = c.type === "outbound" ? "outbound" : "inbound";

      // Status mapping
      let status = c.status ?? "completed";
      const validStatus = ["queued", "in_progress", "completed", "failed", "no_answer", "voicemail", "cancelled"];
      if (!validStatus.includes(status)) status = "completed";

      // Extracted data: pega array `evaluation` e transforma em objeto chave→valor
      const extractedData: Record<string, unknown> = {};
      if (Array.isArray(c.evaluation)) {
        for (const ev of c.evaluation) {
          if (ev && ev.name) extractedData[ev.name] = ev.value ?? null;
        }
      }

      return {
        sofia_call_id: String(c.id),
        direction,
        assistant_sofia_id: nameToSofiaId.get(c.assistant_name) ?? null,
        phone: c.client_phone_number ?? null,
        customer_name: extractedData["nome_cliente"] as string | null ?? null,
        status,
        duration_sec: c.duration ?? null,
        cost_minutes: c.total_cost ? Number(c.total_cost) : null,
        recording_url: c.recording_url ?? null,
        transcript: c.transcript ?? null,
        summary: extractedData["summary"] as string | null ?? null,
        extracted_data: extractedData,
        raw: c,
        started_at: c.created_at ?? null,
        ended_at: c.updated_at ?? null,
      };
    });

    if (rows.length > 0) {
      const { error } = await supabase
        .from("sofia_calls")
        .upsert(rows, { onConflict: "sofia_call_id" });
      if (error) return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ synced: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
