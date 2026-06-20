import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Limpa as importações do dia que acabou e re-sincroniza UMA única vez (tele + salão).
// Resolve a divergência diária em que o sync incremental só acrescenta pedidos novos
// e nunca corrige valor/forma de pagamento dos pedidos que mudaram no Saipos.
//
// Roda às 06:00 BRT (09:00 UTC) e age sobre o dia operacional que acabou de fechar
// (ontem em horário de Brasília). Pula fechamentos cuja conciliação já foi concluída,
// para nunca apagar trabalho manual (cancelamentos, migrações, agrupamentos).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Data alvo: ontem em horário de Brasília (UTC-3), salvo se vier override no body.
    let targetDate: string;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.target_date) {
        targetDate = body.target_date;
      } else {
        const now = new Date();
        const brasiliaMs = now.getTime() + now.getTimezoneOffset() * 60000 + (-3 * 60) * 60000;
        const brasilia = new Date(brasiliaMs);
        brasilia.setDate(brasilia.getDate() - 1);
        targetDate = brasilia.toISOString().split("T")[0];
      }
    } catch {
      const now = new Date();
      const brasiliaMs = now.getTime() + now.getTimezoneOffset() * 60000 + (-3 * 60) * 60000;
      const brasilia = new Date(brasiliaMs);
      brasilia.setDate(brasilia.getDate() - 1);
      targetDate = brasilia.toISOString().split("T")[0];
    }

    console.log(`[daily-resync] Data alvo: ${targetDate}`);

    const results: any[] = [];

    // Pega o admin para criar fechamentos quando necessário
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    const adminUserId = adminRole?.user_id ?? null;

    // ============ TELE / DELIVERY ============
    try {
      let { data: closing } = await supabase
        .from("daily_closings")
        .select("id, closing_date, reconciliation_status")
        .eq("closing_date", targetDate)
        .maybeSingle();

      if (closing && closing.reconciliation_status === "completed") {
        console.log("[daily-resync] Tele já concluída — pulando limpeza.");
        results.push({ type: "tele", skipped: "reconciliation_completed", date: targetDate });
      } else {
        if (!closing) {
          if (!adminUserId) throw new Error("Nenhum admin configurado");
          const { data: newClosing, error: createErr } = await supabase
            .from("daily_closings")
            .insert({ closing_date: targetDate, user_id: adminUserId, status: "pending" })
            .select("id, closing_date, reconciliation_status")
            .single();
          if (createErr) throw createErr;
          closing = newClosing;
        }

        // 1) Apaga as importações antigas do dia (cascade remove imported_orders)
        const { data: oldImports } = await supabase
          .from("imports")
          .select("id")
          .eq("daily_closing_id", closing.id);
        const deletedImports = oldImports?.length || 0;
        if (deletedImports > 0) {
          await supabase.from("imports").delete().eq("daily_closing_id", closing.id);
        }

        // 2) Solta os vínculos das transações da maquininha (os pedidos serão recriados)
        await supabase
          .from("card_transactions")
          .update({ matched_order_id: null, match_type: null, match_confidence: null })
          .eq("daily_closing_id", closing.id)
          .not("matched_order_id", "is", null);

        // 3) Re-sincroniza UMA vez
        const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-saipos-sales`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ closing_date: targetDate, daily_closing_id: closing.id }),
        });
        const syncData = await syncRes.json();
        console.log(`[daily-resync] Tele resync:`, JSON.stringify(syncData));
        results.push({ type: "tele", date: targetDate, deleted_imports: deletedImports, ...syncData });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[daily-resync] Erro tele:", msg);
      results.push({ type: "tele", error: msg });
    }

    // ============ SALÃO ============
    try {
      let { data: salonClosing } = await supabase
        .from("salon_closings")
        .select("id, closing_date, status")
        .eq("closing_date", targetDate)
        .maybeSingle();

      if (salonClosing && salonClosing.status === "completed") {
        console.log("[daily-resync] Salão já concluído — pulando limpeza.");
        results.push({ type: "salon", skipped: "status_completed", date: targetDate });
      } else {
        if (!salonClosing) {
          if (!adminUserId) throw new Error("Nenhum admin configurado");
          const { data: newSalon, error: createErr } = await supabase
            .from("salon_closings")
            .insert({ closing_date: targetDate, user_id: adminUserId, status: "pending" })
            .select("id, closing_date, status")
            .single();
          if (createErr) throw createErr;
          salonClosing = newSalon;
        }

        // 1) Apaga as importações antigas do salão (cascade remove salon_orders)
        const { data: oldImports } = await supabase
          .from("salon_imports")
          .select("id")
          .eq("salon_closing_id", salonClosing.id);
        const deletedImports = oldImports?.length || 0;
        if (deletedImports > 0) {
          await supabase.from("salon_imports").delete().eq("salon_closing_id", salonClosing.id);
        }

        // 2) Re-sincroniza UMA vez
        const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-saipos-salon`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ closing_date: targetDate, salon_closing_id: salonClosing.id }),
        });
        const syncData = await syncRes.json();
        console.log(`[daily-resync] Salão resync:`, JSON.stringify(syncData));
        results.push({ type: "salon", date: targetDate, deleted_imports: deletedImports, ...syncData });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[daily-resync] Erro salão:", msg);
      results.push({ type: "salon", error: msg });
    }

    // Log
    try {
      const hasErrors = results.some((r) => r.error);
      await supabase.from("sync_logs").insert({
        sync_type: "daily-resync",
        status: hasErrors ? "partial" : "success",
        details: { date: targetDate, results },
        error_message: hasErrors ? results.filter((r) => r.error).map((r) => r.error).join("; ") : null,
      });
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ date: targetDate, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[daily-resync] Erro fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
