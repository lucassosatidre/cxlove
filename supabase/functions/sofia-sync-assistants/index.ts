import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sofiaFetch, corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Sincroniza assistentes da Sofia (GET /api/user/assistants/get)
 * com sofia_assistants no Supabase via upsert por sofia_id.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Paginação completa
    const collected: any[] = [];
    let page = 1;
    while (true) {
      const r = await sofiaFetch(`/user/assistants/get?per_page=100&page=${page}`);
      if (!r.ok) {
        const text = await r.text();
        return jsonResponse({ error: "Falha ao buscar assistentes", status: r.status, body: text.slice(0, 500) }, 502);
      }
      const data = await r.json();
      collected.push(...(data.data ?? []));
      if (!data.last_page || data.current_page >= data.last_page) break;
      page++;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const rows = collected.map((a: any) => ({
      sofia_id: a.id,
      name: a.name,
      type: a.type === "outbound" ? "outbound" : "inbound",
      status: a.status === "active" ? "active" : "inactive",
      voice_id: a.voice_id ?? null,
      language_id: a.language_id ?? null,
      phone_number_id: a.phone_number_id ?? null,
      webhook_url: a.webhook_url ?? null,
      inbound_webhook_url: a.inbound_webhook_url ?? null,
      post_call_evaluation: !!a.post_call_evaluation,
      post_call_schema: a.post_call_schema ?? null,
      raw: a,
      synced_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("sofia_assistants")
        .upsert(rows, { onConflict: "sofia_id" });
      if (error) return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ synced: rows.length, sample: rows.slice(0, 3).map((r) => ({ sofia_id: r.sofia_id, name: r.name, type: r.type })) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
