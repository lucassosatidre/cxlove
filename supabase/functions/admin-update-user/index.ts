import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json({ error: "Not authenticated" }, 401);
    const { data: adminRole } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", callerData.user.id).eq("role", "admin").maybeSingle();
    const isAdmin = !!adminRole;
    if (!isAdmin) return json({ error: "Sem permissão para gerenciar usuários" }, 403);

    const { user_id, email, password } = await req.json();
    if (!user_id) return json({ error: "user_id é obrigatório" }, 400);
    const updates: Record<string, unknown> = {};
    if (typeof email === "string" && email.trim()) { updates.email = email.trim(); updates.email_confirm = true; }
    if (typeof password === "string" && password.length > 0) {
      if (password.length < 6) return json({ error: "Senha deve ter pelo menos 6 caracteres" }, 400);
      updates.password = password;
    }
    if (Object.keys(updates).length === 0) return json({ error: "Nada para atualizar" }, 400);
    const { data: upd, error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, updates);
    if (updErr) return json({ error: updErr.message }, 400);
    if (updates.email) { await supabaseAdmin.from("profiles").update({ email: updates.email }).eq("id", user_id); }
    return json({ ok: true, user: upd.user });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
