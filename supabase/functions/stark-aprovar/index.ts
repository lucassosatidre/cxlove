// Aprovação/recusa de pagamentos Stark com senha e lista fechada.
// Segurança REAL: exige usuário logado, email na whitelist e senha correta para aprovar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Não autenticado" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const email = (userData.user.email || "").toLowerCase().trim();
    const aprovadoresRaw = Deno.env.get("APROVADORES") || "";
    const aprovadores = aprovadoresRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!aprovadores.includes(email)) {
      return json({ ok: false, error: "Você não tem permissão para aprovar pagamentos" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { id, decisao, senha } = body || {};
    if (!id || (decisao !== "aprovar" && decisao !== "recusar")) {
      return json({ ok: false, error: "Parâmetros inválidos" }, 400);
    }

    if (decisao === "aprovar") {
      const expected = Deno.env.get("APROVACAO_SENHA");
      if (!senha || senha !== expected) {
        return json({ ok: false, error: "Senha de aprovação incorreta" }, 403);
      }
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const patch: Record<string, unknown> = {
      status: decisao === "aprovar" ? "aprovado" : "recusado",
      approved_by: userData.user.id,
    };
    if (decisao === "aprovar") patch.approved_at = new Date().toISOString();

    const { data: updated, error: updErr } = await admin
      .from("stark_pagamentos")
      .update(patch)
      .eq("id", id)
      .eq("status", "aguardando_aprovacao")
      .select("id");
    if (updErr) return json({ ok: false, error: updErr.message }, 500);
    if (!updated || updated.length === 0) {
      return json({ ok: false, error: "Pagamento não está mais aguardando aprovação" }, 409);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || "Erro inesperado" }, 500);
  }
});
