import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Get the operational date in Brasília timezone.
 * The business day starts at 03:00 BRT.
 * Before 03:00, the operational date is still yesterday.
 */
function getOperationalDate(): string {
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const brasiliaMs = utcMs + brasiliaOffset * 60000;
  const brasilia = new Date(brasiliaMs);

  // If before 03:00 BRT, operational date = yesterday
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Use operational date (accounts for 03:00 BRT boundary)
    const today = getOperationalDate();

    console.log(`[auto-open] Running for operational date: ${today}`);

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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auto-open] Fatal error:", msg);
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);
      await logOpen(supabase, "error", { fatal: true }, msg);
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ error: msg }), {
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
    console.error("[auto-open] Failed to write sync log:", e instanceof Error ? e.message : String(e));
  }
}
