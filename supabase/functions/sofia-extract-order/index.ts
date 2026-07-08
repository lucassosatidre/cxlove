// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/sofia.ts";
import { criarSofiaOrder } from "../_shared/sofia_order.ts";

/**
 * Plano B de captura: lê a transcrição de uma chamada da Sofia e monta o pedido
 * estruturado com a IA (Claude), quando a tool finalizar_pedido NÃO foi chamada.
 *
 * POST { sofia_call_id: string, force?: boolean }
 * Idempotente: não recria pedido pra uma chamada que já tem pedido (a menos de force).
 */

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-5";

const PEDIDO_TOOL = {
  name: "registrar_pedido",
  description: "Registra o pedido de pizza estruturado extraído da conversa.",
  input_schema: {
    type: "object",
    properties: {
      tem_pedido: { type: "boolean", description: "true se a conversa fechou um pedido de verdade; false se não houve pedido concreto." },
      nome_cliente: { type: "string" },
      telefone: { type: "string" },
      tipo: { type: "string", enum: ["entrega", "retirada"] },
      endereco: { type: "string" },
      bairro: { type: "string" },
      complemento: { type: "string" },
      referencia: { type: "string" },
      taxa_entrega: { type: "number" },
      forma_pagamento: { type: "string", enum: ["dinheiro", "maquininha", "pix", "pago"] },
      troco_para: { type: "number", description: "Valor em dinheiro que o cliente vai pagar (pra calcular troco). 0 se não falou." },
      observacoes: { type: "string" },
      total: { type: "number" },
      itens: {
        type: "array",
        description: "Um item por pizza física (combos viram pizzas individuais + bebida). Bebidas e outros também entram.",
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["pizza", "bebida", "outro"] },
            nome: { type: "string", description: "Ex.: 'Pizza Grande', 'Pizza Gigante', 'Pizza Broto Doce', 'Coca-Cola 1,5L'." },
            qtd: { type: "number" },
            tamanho: { type: "string", enum: ["broto", "grande", "gigante"], description: "só pizza" },
            categoria: { type: "string", enum: ["salgada", "doce"], description: "só pizza" },
            sabores: {
              type: "array",
              description: "Sabores da pizza. fracao tipo '1/2','2/4','1/1'. Pizza inteira de 1 sabor: 1 sabor sem fração.",
              items: {
                type: "object",
                properties: { fracao: { type: "string" }, nome: { type: "string" } },
                required: ["nome"],
              },
            },
            borda: { type: "string", description: "Sabor da borda recheada, se houver (ex.: 'Catupiry')." },
            valor: { type: "number", description: "Valor total da linha." },
          },
          required: ["tipo", "nome", "qtd"],
        },
      },
    },
    required: ["tem_pedido", "itens"],
  },
};

function menuResumo(menu: any): string {
  try {
    const salg = (menu?.monte_do_seu_jeito?.sabores_salgados ?? []).map((s: any) => s.sabor);
    const doces = (menu?.monte_do_seu_jeito?.sabores_doces_broto_individual ?? []).map((s: any) => s.sabor);
    const bordas = menu?.bordas_disponiveis ?? [];
    const bebidas = (menu?.bebidas_avulsas ?? []).map((b: any) => b.nome);
    return [
      `SABORES SALGADOS: ${salg.join(", ")}`,
      `SABORES DOCES (broto): ${doces.join(", ")}`,
      `BORDAS: ${bordas.join(", ")}`,
      `BEBIDAS: ${bebidas.join(", ")}`,
      `Tamanhos: broto(1 sabor), grande(até 2 sabores), gigante(até 3 sabores).`,
      `Combo 1 = 2 pizzas grandes + refri 1,5L. Combo 2 = 1 gigante + 1 broto doce + refri 1,5L.`,
    ].join("\n");
  } catch { return ""; }
}

function transcriptToText(t: any): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    return t.map((m: any) => `${m.type ?? m.role ?? "msg"}: ${m.text ?? m.content ?? ""}`).join("\n");
  }
  return JSON.stringify(t);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // verify_jwt=false: protege com o secret dedicado da Sofia-caixa (se configurado)
  const expectedSecret = Deno.env.get("SOFIA_PRINT_SECRET");
  if (expectedSecret) {
    const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-sofia-secret");
    if (provided !== expectedSecret) return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "ANTHROPIC_API_KEY não configurada" }, 500);
    const { sofia_call_id, force } = await req.json();
    if (!sofia_call_id) return jsonResponse({ error: "sofia_call_id obrigatório" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Dedup: já existe pedido pra essa chamada?
    if (!force) {
      const { data: existing } = await supabase
        .from("sofia_orders").select("id, numero").eq("sofia_call_id", sofia_call_id).maybeSingle();
      if (existing) return jsonResponse({ ok: true, skipped: "já existe pedido", numero: existing.numero });
    }

    const { data: call, error: callErr } = await supabase
      .from("sofia_calls")
      .select("sofia_call_id, phone, customer_name, transcript, summary, extracted_data")
      .eq("sofia_call_id", sofia_call_id).maybeSingle();
    if (callErr || !call) return jsonResponse({ error: "chamada não encontrada" }, 404);

    const { data: menuRow } = await supabase
      .from("sofia_menu").select("data").eq("slug", "estrela_da_ilha_v1").maybeSingle();
    const menu = menuRow?.data ?? {};

    const userContent = [
      `TRANSCRIÇÃO DA LIGAÇÃO:\n${transcriptToText(call.transcript)}`,
      `\nDADOS JÁ EXTRAÍDOS PELA SOFIA:\n${JSON.stringify(call.extracted_data ?? {}, null, 0)}`,
      `\nRESUMO: ${call.summary ?? ""}`,
      `\nTELEFONE DO CLIENTE: ${call.phone ?? ""}`,
      `\nCARDÁPIO (referência pra grafar sabores corretos):\n${menuResumo(menu)}`,
    ].join("\n");

    const system = [
      "Você organiza pedidos de pizzaria a partir da transcrição de uma ligação telefônica atendida por IA.",
      "Extraia APENAS o que foi efetivamente confirmado na conversa. Não invente itens, endereço ou pagamento.",
      "Cada pizza física vira um item separado (um combo de 2 pizzas = 2 itens pizza + 1 item bebida).",
      "Use os nomes de sabores exatamente como no cardápio fornecido. Se a conversa não fechou pedido, retorne tem_pedido=false.",
      "Sempre chame a tool registrar_pedido.",
    ].join(" ");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: [PEDIDO_TOOL],
        tool_choice: { type: "tool", name: "registrar_pedido" },
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return jsonResponse({ error: `Anthropic ${resp.status}: ${t}` }, 502);
    }
    const data = await resp.json();
    const toolUse = (data.content ?? []).find((c: any) => c.type === "tool_use");
    if (!toolUse) return jsonResponse({ error: "IA não retornou pedido" }, 502);
    const pedido = toolUse.input ?? {};

    if (pedido.tem_pedido === false || !(Array.isArray(pedido.itens) && pedido.itens.length > 0)) {
      return jsonResponse({ ok: true, skipped: "sem pedido concreto na chamada" });
    }

    const { order, error: ordErr } = await criarSofiaOrder(supabase, pedido, {
      sofiaCallId: sofia_call_id,
      origem: "sofia-ia",
    });
    if (ordErr || !order) return jsonResponse({ error: ordErr ?? "falha ao criar pedido" }, 500);

    return jsonResponse({ ok: true, numero: order.numero, status: order.status, total: order.total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
