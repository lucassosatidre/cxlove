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
      return new Response(
        JSON.stringify({ error: closingsErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If no closing exists for today, create one
    if (!closings || closings.length === 0) {
      console.log("[auto-sync] No closing for today, creating one...");

      // Use a system-level user_id — we'll use a deterministic UUID for the auto-sync bot
      // We need a valid user. Let's pick any admin user.
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .single();

      if (!adminRole) {
        console.error("[auto-sync] No admin user found to create closing");
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
        return new Response(
          JSON.stringify({ error: createErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      closings = [newClosing];
    }

    const results: any[] = [];

    for (const closing of closings) {
      console.log(`[auto-sync] Syncing closing ${closing.id} for ${closing.closing_date}`);

      try {
        // Call sync-saipos-sales directly via HTTP
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
        console.log(`[auto-sync] Result for ${closing.id}:`, JSON.stringify(syncData));
        results.push({ closing_id: closing.id, date: closing.closing_date, ...syncData });
      } catch (err) {
        console.error(`[auto-sync] Error syncing ${closing.id}:`, err.message);
        results.push({ closing_id: closing.id, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ date: today, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[auto-sync] Fatal error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
