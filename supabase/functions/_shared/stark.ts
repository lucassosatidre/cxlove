// @ts-nocheck
// Assinatura ECDSA secp256k1 para autenticar na API REST do Stark Bank. Validado contra produção.
import starkbankEcdsa from "npm:starkbank-ecdsa@1.2.0";
const { PrivateKey, Ecdsa } = starkbankEcdsa;

export function starkConfig() {
  const projectId = Deno.env.get("STARKBANK_PROJECT_ID");
  const pem = Deno.env.get("STARKBANK_PRIVATE_KEY");
  const env = (Deno.env.get("STARKBANK_ENVIRONMENT") || "production").toLowerCase();
  if (!projectId || !pem) throw new Error("STARKBANK_PROJECT_ID/STARKBANK_PRIVATE_KEY não configurados");
  const base = env === "sandbox"
    ? "https://sandbox.api.starkbank.com/v2"
    : "https://api.starkbank.com/v2";
  return { projectId, pem, base, env };
}

export async function starkFetch(path: string, opts: { method?: string; body?: any } = {}) {
  const { projectId, pem, base } = starkConfig();
  const method = opts.method || "GET";
  const bodyStr = opts.body != null ? JSON.stringify(opts.body) : "";
  const accessId = `project/${projectId}`;
  const accessTime = Math.floor(Date.now() / 1000).toString();
  const message = `${accessId}:${accessTime}:${bodyStr}`;
  const privateKey = PrivateKey.fromPem(pem);
  const signature = Ecdsa.sign(message, privateKey).toBase64();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Access-Id": accessId,
      "Access-Time": accessTime,
      "Access-Signature": signature,
      "Content-Type": "application/json",
      "User-Agent": "Vigia-Proposito/1.0",
    },
    body: bodyStr || undefined,
  });
  const txt = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch (_) {}
  return { ok: res.ok, status: res.status, data: parsed, raw: txt };
}

export function starkErrorMessage(data: any, raw: string, status: number): string {
  const errs = data?.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs.map((e: any) => `${e.code || 'erro'}: ${e.message || ''}`.trim()).join(' | ');
  }
  return `Stark ${status}: ${raw?.slice(0, 500) || 'erro desconhecido'}`;
}
