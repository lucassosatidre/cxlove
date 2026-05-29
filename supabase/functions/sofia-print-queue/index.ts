// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Fila de impressão dos pedidos da Sofia — consultada pelo helper da cozinha
 * (etiqueta_saipos.py) por polling.
 *
 *   GET  ?secret=...                 -> lista pedidos com status 'pendente_impressao'
 *   POST { action:'mark', ids:[...] }-> marca como 'impresso'
 *
 * verify_jwt=false (o PC não tem JWT do Supabase). Protegido por SOFIA_WEBHOOK_SECRET
 * (mesmo secret do webhook). O secret fica num arquivo local no PC, nunca no repo.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sofia-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function horaBR(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch {
    // fallback manual (-03:00) se o runtime não tiver dados de timezone
    try {
      const d = new Date(iso); d.setHours(d.getHours() - 3);
      return d.toISOString().slice(11, 16);
    } catch { return ""; }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth por secret compartilhado — OBRIGATÓRIO (a fila expõe PII do cliente).
  const expected = Deno.env.get("SOFIA_WEBHOOK_SECRET");
  if (!expected) {
    return json({ error: "Servidor sem SOFIA_WEBHOOK_SECRET configurado." }, 503);
  }
  {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-sofia-secret");
    if (provided !== expected) return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.action === "mark" && Array.isArray(body.ids) && body.ids.length > 0) {
        const ids = body.ids.filter((x: unknown) => typeof x === "string");
        const { data: updated, error } = await supabase
          .from("sofia_orders")
          .update({ status: "impresso", impresso_em: new Date().toISOString() })
          .in("id", ids)
          .eq("status", "pendente_impressao") // só marca o que estava pendente (idempotente)
          .select("id");
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, marcados: (updated ?? []).length, pedidos: ids.length });
      }
      return json({ error: "ação inválida" }, 400);
    }

    // GET -> lista pendentes
    const { data, error } = await supabase
      .from("sofia_orders")
      .select("id, numero, tipo, nome_cliente, telefone, endereco, bairro, complemento, referencia, forma_pagamento, troco_para, taxa_entrega, subtotal, total, observacoes, itens, created_at, impresso_em")
      .eq("status", "pendente_impressao")
      .order("created_at", { ascending: true })
      .limit(30);
    if (error) return json({ error: error.message }, 500);

    const pedidos = (data ?? []).map((o: any) => ({
      id: o.id,
      numero: o.numero,
      tipo: o.tipo,
      nome_cliente: o.nome_cliente,
      telefone: o.telefone,
      endereco: o.endereco,
      bairro: o.bairro,
      complemento: o.complemento,
      referencia: o.referencia,
      forma_pagamento: o.forma_pagamento,
      troco_para: o.troco_para,
      taxa_entrega: o.taxa_entrega,
      subtotal: o.subtotal,
      total: o.total,
      observacoes: o.observacoes,
      hora: horaBR(o.created_at),
      itens: o.itens ?? [],
    }));

    return json({ pedidos, total: pedidos.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
