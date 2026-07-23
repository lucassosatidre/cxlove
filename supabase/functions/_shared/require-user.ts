// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Retorna o usuário logado (sessão real). Rejeita chamada só com anon key (sem sub) ou anônima.
export async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const c = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await c.auth.getUser();
  const u = data?.user;
  if (error || !u || (u as any).is_anonymous) return null;
  return u;
}

export function isAprovador(email?: string | null) {
  const list = (Deno.env.get("APROVADORES") || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}
