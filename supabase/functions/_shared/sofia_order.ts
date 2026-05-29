// deno-lint-ignore-file no-explicit-any
/**
 * Monta e grava um pedido estruturado da Sofia em public.sofia_orders.
 *
 * Usado por:
 *   - sofia-tools-callback (tool finalizar_pedido) — captura determinística
 *   - sofia-webhook (extrator LLM pós-chamada) — plano B quando a tool não foi chamada
 *
 * Recebe um payload "solto" (a Sofia/LLM pode variar a forma) e normaliza pro
 * formato fixo da tabela. NÃO confia cegamente nos totais: recalcula a partir
 * dos itens quando possível.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function toNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  // aceita "12,90", "12.90", "R$ 1.234,56" e "1,234.56" — detecta o separador decimal
  let s = String(v).replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const hasDot = s.includes("."), hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // o último separador que aparece é o decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(/\./g, "").replace(",", "."); // vírgula = decimal (padrão BR)
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const DRINK_RE = /(coca|guaran|fanta|sprite|pepsi|refrigerante|suco|água|agua|cerveja|heineken|vinho|h2o|tônica|tonica)/i;

function normSabores(raw: any, totalSabores?: number): { fracao: string | null; nome: string }[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: { fracao: string | null; nome: string }[] = [];
  for (const s of arr) {
    if (!s) continue;
    if (typeof s === "string") {
      // pode vir "1/2 Calabresa" embutido
      const m = s.match(/^\s*(\d+\s*\/\s*\d+)\s+(.+)$/);
      if (m) out.push({ fracao: m[1].replace(/\s+/g, ""), nome: m[2].trim() });
      else out.push({ fracao: null, nome: s.trim() });
    } else if (typeof s === "object") {
      const nome = String(s.nome ?? s.sabor ?? s.name ?? "").trim();
      if (!nome) continue;
      const fr = s.fracao ?? s.fração ?? s.fraction ?? null;
      out.push({ fracao: fr ? String(fr).replace(/\s+/g, "") : null, nome });
    }
  }
  // Se não veio fração e há vários sabores, assume divisão igual (1/N)
  if (out.length > 1 && out.every((x) => !x.fracao)) {
    const n = totalSabores && totalSabores > 0 ? totalSabores : out.length;
    for (const x of out) x.fracao = `1/${n}`;
  }
  return out;
}

function normItem(raw: any): any | null {
  const nome = String(raw?.nome ?? raw?.name ?? raw?.produto ?? raw?.item ?? "").trim();
  if (!nome) return null; // item sem nome real é descartado
  const qtd = Math.max(1, Math.round(toNum(raw?.qtd ?? raw?.quantidade ?? raw?.quantity ?? 1)) || 1);
  const tamanho = raw?.tamanho ?? raw?.size ?? null;
  let categoria = raw?.categoria ?? raw?.tipo_pizza ?? null; // 'salgada' | 'doce'
  const sabores = normSabores(raw?.sabores ?? raw?.flavors ?? raw?.sabor, raw?.qtd_sabores);
  const borda = (raw?.borda ?? raw?.borda_sabor ?? null) || null;
  const valor = round2(toNum(raw?.valor ?? raw?.preco ?? raw?.subtotal ?? raw?.price ?? 0));
  const obs = raw?.obs ?? raw?.observacao ?? raw?.observação ?? null;

  // Inferir tipo
  let tipo = raw?.tipo ?? raw?.type ?? null;
  if (tipo === "pizza_salgada") { tipo = "pizza"; categoria = categoria ?? "salgada"; }
  if (tipo === "pizza_doce" || tipo === "broto_doce") { tipo = "pizza"; categoria = categoria ?? "doce"; }
  if (!tipo || !["pizza", "bebida", "outro"].includes(tipo)) {
    if (tamanho || sabores.length > 0 || categoria || /pizza|broto|gigante|grande/i.test(nome)) tipo = "pizza";
    else if (DRINK_RE.test(nome)) tipo = "bebida";
    else tipo = "outro";
  }
  if (tipo === "pizza" && !categoria) {
    categoria = /doce|chocolate|nutella|sensa|prest|charge|morango|coconut|imperial/i.test(nome + " " + sabores.map((s) => s.nome).join(" ")) ? "doce" : "salgada";
  }
  return {
    tipo,
    nome,
    qtd,
    tamanho: tamanho ? String(tamanho).toLowerCase() : null,
    categoria: tipo === "pizza" ? categoria : null,
    sabores,
    borda: borda ? String(borda) : null,
    valor,
    obs: obs ? String(obs) : null,
  };
}

const PAG_MAP: Record<string, string> = {
  dinheiro: "dinheiro", cash: "dinheiro", money: "dinheiro",
  maquininha: "maquininha", maquinona: "maquininha", cartao: "maquininha",
  cartão: "maquininha", credito: "maquininha", crédito: "maquininha",
  debito: "maquininha", débito: "maquininha", card: "maquininha",
  pix: "pix",
  pago: "pago", online: "pago", "pago online": "pago", "pago pelo cliente": "pago",
};

function normPagamento(v: any): string | null {
  if (!v) return null;
  const k = String(v).toLowerCase().trim();
  return PAG_MAP[k] ?? (k.includes("dinheiro") ? "dinheiro" : k.includes("pix") ? "pix" : k.includes("pago") || k.includes("online") ? "pago" : k.includes("cart") || k.includes("maqu") || k.includes("débito") || k.includes("debito") || k.includes("créd") || k.includes("cred") ? "maquininha" : k);
}

/**
 * Normaliza o payload e insere o pedido. Retorna o registro criado.
 * `supabase` deve ser um client com service role.
 */
export async function criarSofiaOrder(
  supabase: any,
  payload: any,
  opts: { sofiaCallId?: string | null; origem?: string } = {},
): Promise<{ order: any | null; error: string | null }> {
  try {
    const p = payload ?? {};
    const itensRaw = p.itens ?? p.items ?? p.pedido ?? [];
    const itens = (Array.isArray(itensRaw) ? itensRaw : []).map(normItem).filter((i) => !!i);
    if (itens.length === 0) {
      return { order: null, error: "Pedido sem itens." };
    }

    const tipo = (String(p.tipo ?? p.tipo_pedido ?? "entrega").toLowerCase().includes("retir")) ? "retirada" : "entrega";
    const taxa_entrega = round2(toNum(p.taxa_entrega ?? p.taxa ?? p.delivery_fee ?? 0));

    let subtotal = round2(itens.reduce((acc, i) => acc + (i.valor || 0), 0));
    if (subtotal === 0) subtotal = round2(toNum(p.subtotal ?? p.subtotal_produtos ?? 0));
    let total = round2(toNum(p.total ?? p.valor_total ?? p.valor ?? 0));
    if (total === 0) total = round2(subtotal + (tipo === "entrega" ? taxa_entrega : 0));

    const forma_pagamento = normPagamento(p.forma_pagamento ?? p.pagamento ?? p.payment ?? p.metodo_pagamento);
    const troco_paraN = toNum(p.troco_para ?? p.troco ?? p.change_for);
    const troco_para = troco_paraN > 0 ? round2(troco_paraN) : null;

    // status inicial conforme toggle auto_print
    let status = "pendente_conferencia";
    try {
      const { data: cfg } = await supabase
        .from("sofia_settings").select("data").eq("slug", "caixa").maybeSingle();
      if (cfg?.data?.auto_print === true) status = "pendente_impressao";
    } catch (_e) { /* mantém conferência */ }

    const { data: numeroData, error: numErr } = await supabase.rpc("sofia_next_numero");
    if (numErr) return { order: null, error: `numeração: ${numErr.message}` };
    const numero = numeroData as number;

    const row = {
      sofia_call_id: opts.sofiaCallId ?? p.sofia_call_id ?? null,
      numero,
      origem: opts.origem ?? "sofia",
      nome_cliente: (p.nome_cliente ?? p.cliente ?? p.nome ?? null) || null,
      telefone: (p.telefone ?? p.telefone_cliente ?? p.phone ?? null) || null,
      tipo,
      endereco: (p.endereco ?? p.endereco_cliente ?? p.address ?? null) || null,
      bairro: (p.bairro ?? null) || null,
      complemento: (p.complemento ?? null) || null,
      referencia: (p.referencia ?? p.ponto_referencia ?? p.referência ?? null) || null,
      taxa_entrega,
      subtotal,
      total,
      forma_pagamento,
      troco_para,
      observacoes: (p.observacoes ?? p.obs ?? p.observação ?? null) || null,
      itens,
      status,
      raw: payload ?? null,
    };

    const { data, error } = await supabase
      .from("sofia_orders").insert(row).select().single();
    if (error) return { order: null, error: error.message };
    return { order: data, error: null };
  } catch (err) {
    return { order: null, error: err instanceof Error ? err.message : String(err) };
  }
}
