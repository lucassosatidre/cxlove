import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Webhook público pra receber notificações pós-chamada da Sofia.
 *
 * Configure essa URL no painel de cada assistente:
 *   https://<project>.supabase.co/functions/v1/sofia-webhook
 *
 * Não exige JWT (verify_jwt = false em config.toml).
 * Faz upsert em sofia_calls usando sofia_call_id como chave.
 *
 * Aceita ?secret=<SOFIA_WEBHOOK_SECRET> como validação opcional;
 * se SOFIA_WEBHOOK_SECRET não estiver configurado, qualquer POST é aceito.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const expectedSecret = Deno.env.get("SOFIA_WEBHOOK_SECRET");
    if (expectedSecret) {
      const url = new URL(req.url);
      const provided = url.searchParams.get("secret") ?? req.headers.get("x-sofia-secret");
      if (provided !== expectedSecret) {
        return jsonResponse({ error: "Invalid secret" }, 401);
      }
    }

    const payload = await req.json();

    // O payload pós-chamada da Sofia inclui (campos podem variar):
    //   call_id / id, type/direction, status, duration, recording_url,
    //   transcript, evaluation (variáveis extraídas), client_phone_number,
    //   assistant_name / assistant_id, campaign_name, total_cost, created_at, updated_at
    const sofiaCallId = String(payload.call_id ?? payload.id ?? "");
    if (!sofiaCallId) {
      return jsonResponse({ error: "Payload sem call_id/id" }, 400);
    }

    const direction = (payload.type === "outbound") ? "outbound" : "inbound";

    let status = payload.status ?? "completed";
    const validStatus = ["queued", "in_progress", "completed", "failed", "no_answer", "voicemail", "cancelled"];
    if (!validStatus.includes(status)) status = "completed";

    // Extracted data
    const extractedData: Record<string, unknown> = {};
    if (Array.isArray(payload.evaluation)) {
      for (const ev of payload.evaluation) {
        if (ev && ev.name) extractedData[ev.name] = ev.value ?? null;
      }
    } else if (payload.extracted_variables && typeof payload.extracted_variables === "object") {
      Object.assign(extractedData, payload.extracted_variables);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve assistant_sofia_id via nome ou ID direto se vier no payload
    let assistantSofiaId: number | null = null;
    if (typeof payload.assistant_id === "number") {
      assistantSofiaId = payload.assistant_id;
    } else if (payload.assistant_name) {
      const { data } = await supabase
        .from("sofia_assistants")
        .select("sofia_id")
        .eq("name", payload.assistant_name)
        .maybeSingle();
      assistantSofiaId = data?.sofia_id ?? null;
    }

    const row = {
      sofia_call_id: sofiaCallId,
      direction,
      assistant_sofia_id: assistantSofiaId,
      phone: payload.client_phone_number ?? null,
      customer_name: (extractedData["nome_cliente"] as string | null) ?? null,
      status,
      duration_sec: payload.duration ?? null,
      cost_minutes: payload.total_cost ? Number(payload.total_cost) : null,
      recording_url: payload.recording_url ?? null,
      transcript: payload.transcript ?? null,
      summary: (extractedData["summary"] as string | null) ?? null,
      extracted_data: extractedData,
      raw: payload,
      started_at: payload.created_at ?? null,
      ended_at: payload.updated_at ?? new Date().toISOString(),
    };

    const { error } = await supabase
      .from("sofia_calls")
      .upsert(row, { onConflict: "sofia_call_id" });

    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true, sofia_call_id: sofiaCallId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
