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

    console.log(`[auto-open] Running for date: ${today}`);

    // Get an admin user_id
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .single();

    if (!adminRole) {
      const msg = "No admin user found";
      console.error(`[auto-open] ${msg}`);
      await logOpen(supabase, "error", { error: msg }, msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const created: string[] = [];

    // Check/create daily_closings (Tele)
    const { data: existingTele } = await supabase
      .from("daily_closings")
      .select("id")
      .eq("closing_date", today)
      .limit(1)
      .maybeSingle();

    if (!existingTele) {
      const { error: teleErr } = await supabase
        .from("daily_closings")
        .insert({
          closing_date: today,
          user_id: adminRole.user_id,
          status: "pending",
        });
      if (teleErr) {
        console.error("[auto-open] Error creating tele closing:", teleErr.message);
      } else {
        created.push("tele");
        console.log("[auto-open] Created tele closing for", today);
      }
    } else {
      console.log("[auto-open] Tele closing already exists for", today);
    }

    // Check/create salon_closings (Salão)
    const { data: existingSalon } = await supabase
      .from("salon_closings")
      .select("id")
      .eq("closing_date", today)
      .limit(1)
      .maybeSingle();

    if (!existingSalon) {
      const { error: salonErr } = await supabase
        .from("salon_closings")
        .insert({
          closing_date: today,
          user_id: adminRole.user_id,
          status: "pending",
        });
      if (salonErr) {
        console.error("[auto-open] Error creating salon closing:", salonErr.message);
      } else {
        created.push("salon");
        console.log("[auto-open] Created salon closing for", today);
      }
    } else {
      console.log("[auto-open] Salon closing already exists for", today);
    }

    const details = { date: today, created };
    await logOpen(
      supabase,
      "auto-open",
      details,
      null
    );

    return new Response(JSON.stringify(details), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[auto-open] Fatal error:", err.message);
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);
      await logOpen(supabase, "error", { fatal: true }, err.message);
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logOpen(
  supabase: any,
  status: string,
  details: Record<string, any>,
  errorMessage: string | null
) {
  try {
    await supabase.from("sync_logs").insert({
      sync_type: "auto-open",
      status,
      details,
      error_message: errorMessage,
    });
  } catch (e) {
    console.error("[auto-open] Failed to write sync log:", e.message);
  }
}
