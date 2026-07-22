// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import starkbankEcdsa from "npm:starkbank-ecdsa@1.2.0";

const { Ecdsa, Signature, PublicKey } = starkbankEcdsa;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, digital-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STARK_ENV = (Deno.env.get("STARKBANK_ENVIRONMENT") || "production").toLowerCase();
const STARK_BASE = STARK_ENV === "sandbox"
  ? "https://sandbox.api.starkbank.com/v2"
  : "https://api.starkbank.com/v2";

let cachedPublicKeyPem: string | null = null;

async function fetchStarkPublicKey(force = false): Promise<string> {
  if (cachedPublicKeyPem && !force) return cachedPublicKeyPem;
  const res = await fetch(`${STARK_BASE}/public-key`);
  const data = await res.json();
  const pem = data?.publicKeys?.[0]?.content;
  if (!pem) throw new Error("Stark public key not found");
  cachedPublicKeyPem = pem;
  return pem;
}

function verifySignature(rawBody: string, sigB64: string, pem: string): boolean {
  try {
    return Ecdsa.verify(rawBody, Signature.fromBase64(sigB64), PublicKey.fromPem(pem));
  } catch (_) {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("Digital-Signature") || req.headers.get("digital-signature") || "";
  if (!sigHeader) {
    return new Response(JSON.stringify({ ok: false, error: "missing signature" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let pem = await fetchStarkPublicKey(false).catch(() => null);
  let valid = pem ? verifySignature(rawBody, sigHeader, pem) : false;
  if (!valid) {
    pem = await fetchStarkPublicKey(true).catch(() => null);
    valid = pem ? verifySignature(rawBody, sigHeader, pem) : false;
  }
  if (!valid) {
    return new Response(JSON.stringify({ ok: false, error: "invalid signature" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = JSON.parse(rawBody);
    const event = body?.event ?? {};
    const type = event?.type ?? null;
    const log = event?.log ?? {};
    const resource = type ? log?.[type] : null;
    const subscription = event?.subscription ?? log?.type ?? null;
    const amount_reais = resource?.amount != null ? Number(resource.amount) / 100 : null;
    const resource_id = resource?.id ?? null;
    const event_created = event?.created ?? null;
    const id = event?.id;

    if (!id) {
      console.error("stark-webhook: event without id", body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error } = await supabase.from("stark_events").upsert({
      id, type, subscription, resource_id, amount_reais,
      event_created, payload: body,
    }, { onConflict: "id" });

    if (error) console.error("stark-webhook insert error", error);
  } catch (e) {
    console.error("stark-webhook processing error", e);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
