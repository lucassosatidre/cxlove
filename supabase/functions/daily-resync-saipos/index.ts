import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Reimportação limpa DIÁRIA do Saipos (tele + salão).
// Roda às 06:00 BRT (09:00 UTC) sobre o dia operacional que acabou de fechar (ontem em BRT).
// Pula fechamentos cuja conciliação já foi concluída para nunca apagar trabalho manual.
//
// NOVO COMPORTAMENTO (à prova de falha):
//   - Em vez de apagar antes e sincronizar depois (que zerava o dia em caso de 504),
//     agora apenas chama as funções de sync em MODO `replace: true`. Essas funções
//     buscam, inserem e SÓ DEPOIS apagam os antigos — preservando o estado se a API
//     do Saipos falhar.
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
        console.log("[daily-resync] Tele já concluída — pulando.");
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

        // Chama sync em MODO REPLACE — a função só apaga antigos depois de inserir novos.
        const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-saipos-sales`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ closing_date: targetDate, daily_closing_id: closing.id, replace: true }),
        });
        const syncData = await syncRes.json().catch(() => ({ error: "Resposta inválida do sync" }));
        if (!syncRes.ok || syncData?.error) {
          console.error("[daily-resync] Tele replace falhou — dados antigos PRESERVADOS:", syncData);
          results.push({ type: "tele", date: targetDate, error: syncData?.error || `HTTP ${syncRes.status}`, replaced: false });
        } else {
          console.log(`[daily-resync] Tele resync OK:`, JSON.stringify(syncData));
          results.push({ type: "tele", date: targetDate, ...syncData });
        }
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

      // SALÃO: sempre reimporta LIMPO (replace) — espelho exato do Saipos, igual ao Tele.
      // A conciliação de maquininha do salão é feita de manhã (depois das 6h), então o replace às 6h não a apaga.
      // replace é à prova de falha: se o Saipos cair, retorna 502/replaced:false e NÃO apaga os dados antigos.
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

      const syncRes = await fetch(`${supabaseUrl}/functions/v1/sync-saipos-salon`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ closing_date: targetDate, salon_closing_id: salonClosing.id, replace: true }),
      });
      const syncData = await syncRes.json().catch(() => ({ error: "Resposta inválida do sync" }));
      if (!syncRes.ok || syncData?.error) {
        console.error("[daily-resync] Salão replace falhou — dados antigos PRESERVADOS:", syncData);
        results.push({ type: "salon", date: targetDate, error: syncData?.error || `HTTP ${syncRes.status}`, replaced: false });
      } else {
        console.log(`[daily-resync] Salão resync OK:`, JSON.stringify(syncData));
        results.push({ type: "salon", date: targetDate, ...syncData });
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
