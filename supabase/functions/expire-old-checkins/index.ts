import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getOperationalDate(): string {
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const brasiliaMs = utcMs + brasiliaOffset * 60000;
  const brasilia = new Date(brasiliaMs);
  if (brasilia.getHours() < 3) {
    brasilia.setDate(brasilia.getDate() - 1);
  }
  return brasilia.toISOString().split("T")[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const operationalToday = getOperationalDate();

    // Encontra checkins fila_espera de turnos com data anterior ao dia operacional atual
    const { data: oldShifts, error: shiftErr } = await supabase
      .from("delivery_shifts")
      .select("id")
      .lt("data", operationalToday);

    if (shiftErr) throw shiftErr;
    const shiftIds = (oldShifts ?? []).map((s) => s.id);

    if (shiftIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, expired_count: 0, cutoff_date: operationalToday }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: expired, error: updErr } = await supabase
      .from("delivery_checkins")
      .update({
        status: "cancelado",
        cancelled_at: new Date().toISOString(),
        cancel_reason: "Expirado automaticamente (cleanup diário 03:05 BRT)",
      })
      .eq("status", "fila_espera")
      .in("shift_id", shiftIds)
      .select("id, driver_id");

    if (updErr) throw updErr;

    // Notifica os entregadores cuja espera expirou
    if (expired && expired.length > 0) {
      const driverIds = expired.map((e) => e.driver_id);
      const { data: drivers } = await supabase
        .from("delivery_drivers")
        .select("id, auth_user_id")
        .in("id", driverIds);

      const notifs = (drivers ?? [])
        .filter((d) => d.auth_user_id)
        .map((d) => ({
          user_id: d.auth_user_id,
          title: "Fila de espera",
          message: "Sua espera no turno expirou. Tente novamente no próximo turno.",
          type: "fila_expirada",
        }));

      if (notifs.length > 0) {
        await supabase.from("notifications").insert(notifs);
      }
    }

    // Log
    await supabase.from("sync_logs").insert({
      sync_type: "expire_old_checkins",
      status: "success",
      details: {
        cutoff_date: operationalToday,
        expired_count: expired?.length ?? 0,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        expired_count: expired?.length ?? 0,
        cutoff_date: operationalToday,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("expire-old-checkins error:", msg);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await supabase.from("sync_logs").insert({
        sync_type: "expire_old_checkins",
        status: "error",
        error_message: msg,
      });
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
