/**
 * Helpers compartilhados pra chamar a API da Sua SofIA.
 * Token vem do secret SOFIA_API_TOKEN configurado no Supabase.
 */
const SOFIA_BASE_URL = "https://suasofia.online/api";

export function getSofiaToken(): string {
  let token = Deno.env.get("SOFIA_API_TOKEN") ?? "";
  if (token.startsWith("Bearer ")) token = token.slice(7);
  if (!token) throw new Error("SOFIA_API_TOKEN não configurado");
  return token;
}

export async function sofiaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${SOFIA_BASE_URL}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getSofiaToken()}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
