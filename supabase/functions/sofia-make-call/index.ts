import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sofiaFetch, corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Dispara uma chamada via Sofia.
 *
 * Body:
 *   - assistant_sofia_id: number (obrigatório)
 *   - phone_number: string (E.164, ex: +5548999999999)
 *   - variables?: Record<string, any>
 *   - campaign_id?: uuid (opcional, vincula à campanha)
 *   - target_id?: uuid (opcional, atualiza last_call_id no target)
 *
 * Resposta: { sofia_call_id, local_id, status }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { assistant_sofia_id, phone_number, variables, campaign_id, target_id } = body ?? {};

    if (!assistant_sofia_id || !phone_number) {
      return jsonResponse({ error: "assistant_sofia_id e phone_number são obrigatórios" }, 400);
    }

    // Dispara chamada na Sofia
    const sofiaRes = await sofiaFetch("/user/calls", {
      method: "POST",
      body: JSON.stringify({
        assistant_id: assistant_sofia_id,
        phone_number,
        variables: variables ?? {},
      }),
    });

    const sofiaText = await sofiaRes.text();
    let sofiaPayload: any = {};
    try { sofiaPayload = JSON.parse(sofiaText); } catch { /* keep as text */ }

    if (!sofiaRes.ok) {
      return jsonResponse(
        { error: "Sofia recusou a chamada", status: sofiaRes.status, body: sofiaPayload || sofiaText.slice(0, 500) },
        502
      );
    }

    // ID da chamada retornada (pode vir em diferentes campos dependendo da API)
    const sofiaCallId =
      sofiaPayload?.data?.id ??
      sofiaPayload?.data?.call_id ??
      sofiaPayload?.id ??
      null;

    // Salva local
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const customerName = variables?.nome_cliente ?? variables?.customer_name ?? null;

    const { data: insertData, error: insertErr } = await supabase
      .from("sofia_calls")
      .insert({
        sofia_call_id: sofiaCallId ? String(sofiaCallId) : null,
        direction: "outbound",
        assistant_sofia_id,
        phone: phone_number,
        customer_name: customerName,
        status: "queued",
        campaign_id: campaign_id ?? null,
        raw: sofiaPayload,
      })
      .select("id")
      .single();

    if (insertErr) {
      return jsonResponse({ error: "Sofia disparou mas erro salvando local", detail: insertErr.message, sofia: sofiaPayload }, 500);
    }

    // Atualiza target se vier
    if (target_id) {
      await supabase
        .from("sofia_campaign_targets")
        .update({
          status: "dialing",
          attempts: 1,
          last_call_id: insertData.id,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", target_id);
    }

    return jsonResponse({
      sofia_call_id: sofiaCallId,
      local_id: insertData.id,
      status: "queued",
      sofia_message: sofiaPayload?.message ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
