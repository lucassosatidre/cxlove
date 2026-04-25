import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get today's date in Brasília timezone (UTC-3)
    const now = new Date();
    const brasiliaOffset = -3 * 60;
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const brasiliaMs = utcMs + brasiliaOffset * 60000;
    const brasilia = new Date(brasiliaMs);
    const today = brasilia.toISOString().split("T")[0];

    console.log(`[auto-sync] Running for date: ${today}`);

    // Find open daily_closings for today
    let { data: closings, error: closingsErr } = await supabase
      .from("daily_closings")
      .select("id, closing_date, status")
      .eq("closing_date", today)
      .neq("status", "completed");

    if (closingsErr) {
      console.error("[auto-sync] Error fetching closings:", closingsErr.message);
      await logSync(supabase, "error", { error: closingsErr.message }, closingsErr.message);
      return new Response(
        JSON.stringify({ error: closingsErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If no closing exists for today, create one
    if (!closings || closings.length === 0) {
      console.log("[auto-sync] No closing for today, creating one...");

      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .single();

      if (!adminRole) {
        console.error("[auto-sync] No admin user found to create closing");
        await logSync(supabase, "error", { error: "No admin user found" }, "No admin user found");
        return new Response(
          JSON.stringify({ error: "No admin user found" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: newClosing, error: createErr } = await supabase
        .from("daily_closings")
        .insert({
          closing_date: today,
          user_id: adminRole.user_id,
          status: "pending",
        })
        .select("id, closing_date, status")
        .single();

      if (createErr) {
        console.error("[auto-sync] Error creating closing:", createErr.message);
        await logSync(supabase, "error", { error: createErr.message }, createErr.message);
        return new Response(
          JSON.stringify({ error: createErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      closings = [newClosing];
    }

    const results: any[] = [];

    for (const closing of closings) {
      console.log(`[auto-sync] Syncing tele closing ${closing.id} for ${closing.closing_date}`);

      try {
        const syncRes = await fetch(
          `${supabaseUrl}/functions/v1/sync-saipos-sales`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              closing_date: closing.closing_date,
              daily_closing_id: closing.id,
            }),
          }
        );

        const syncData = await syncRes.json();
        console.log(`[auto-sync] Tele result for ${closing.id}:`, JSON.stringify(syncData));
        results.push({ type: "tele", closing_id: closing.id, date: closing.closing_date, ...syncData });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[auto-sync] Error syncing tele ${closing.id}:`, msg);
        results.push({ type: "tele", closing_id: closing.id, error: msg });
      }
    }

    // === SALON SYNC ===
    let { data: salonClosings, error: salonErr } = await supabase
      .from("salon_closings")
      .select("id, closing_date, status")
      .eq("closing_date", today)
      .neq("status", "completed");

    if (salonErr) {
      console.error("[auto-sync] Error fetching salon closings:", salonErr.message);
    }

    // If no salon closing exists for today, create one
    if (!salonClosings || salonClosings.length === 0) {
      console.log("[auto-sync] No salon closing for today, creating one...");
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .single();

      if (adminRole) {
        const { data: newSalonClosing, error: createSalonErr } = await supabase
          .from("salon_closings")
          .insert({
            closing_date: today,
            user_id: adminRole.user_id,
            status: "pending",
          })
          .select("id, closing_date, status")
          .single();

        if (createSalonErr) {
          console.error("[auto-sync] Error creating salon closing:", createSalonErr.message);
        } else {
          salonClosings = [newSalonClosing];
        }
      }
    }

    if (salonClosings && salonClosings.length > 0) {
      for (const salonClosing of salonClosings) {
        console.log(`[auto-sync] Syncing salon closing ${salonClosing.id} for ${salonClosing.closing_date}`);
        try {
          const salonSyncRes = await fetch(
            `${supabaseUrl}/functions/v1/sync-saipos-salon`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                closing_date: salonClosing.closing_date,
                salon_closing_id: salonClosing.id,
              }),
            }
          );

          const salonSyncData = await salonSyncRes.json();
          console.log(`[auto-sync] Salon result for ${salonClosing.id}:`, JSON.stringify(salonSyncData));
          results.push({ type: "salon", closing_id: salonClosing.id, date: salonClosing.closing_date, ...salonSyncData });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[auto-sync] Error syncing salon ${salonClosing.id}:`, msg);
          results.push({ type: "salon", closing_id: salonClosing.id, error: msg });
        }
      }
    }

    // Log successful execution
    const hasErrors = results.some(r => r.error);
    await logSync(
      supabase,
      hasErrors ? "partial" : "success",
      { date: today, results },
      hasErrors ? results.filter(r => r.error).map(r => r.error).join("; ") : null
    );

    return new Response(
      JSON.stringify({ date: today, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auto-sync] Fatal error:", msg);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);
      await logSync(supabase, "error", { fatal: true }, msg);
    } catch (_) { /* ignore logging errors */ }

    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logSync(
  supabase: any,
  status: string,
  details: Record<string, any>,
  errorMessage: string | null
) {
  try {
    await supabase.from("sync_logs").insert({
      sync_type: "auto",
      status,
      details,
      error_message: errorMessage,
    });
  } catch (e) {
    console.error("[auto-sync] Failed to write sync log:", e instanceof Error ? e.message : String(e));
  }
}
