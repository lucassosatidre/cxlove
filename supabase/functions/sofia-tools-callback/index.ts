import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Webhook das custom mid-call tools da Sofia (Lucinéia v9).
 *
 * Sofia chama com payload do tipo:
 *   { tool_name, arguments } | { name, arguments } | { function: {name, arguments} }
 *
 * Despacha pelas 6 tools de função + listar_sabores. Retorna sempre:
 *   { ok: true, result: <obj com floats em reais> }
 * ou
 *   { ok: false, error: "..." }
 *
 * Cardápio vem da tabela sofia_menu (slug=estrela_da_ilha_v1).
 */

type MenuData = {
  regras_gerais: { pedido_minimo_produtos: number };
  combo_1: {
    preco_base: number;
    borda_por_pizza: number;
    bebidas_inclusas: string[];
    sabores_salgados: { sabor: string; adicional_combo_1: number }[];
  };
  combo_2: {
    preco_base: number;
    borda_gigante: number;
    bebidas_inclusas: string[];
    sabores_salgados_gigante: { sabor: string; adicional_combo_2: number }[];
    brotos_doces_obrigatorias: { sabor: string; adicional_broto_combo_2: number }[];
  };
  monte_do_seu_jeito: {
    tamanhos: {
      broto: { preco_base: number; borda: number };
      grande: { preco_base: number; borda: number; bebida_promocional: number };
      gigante: { preco_base: number; borda: number; bebida_promocional: number };
    };
    bebidas_promocionais_grande_ou_gigante: string[];
    sabores_salgados: {
      sabor: string;
      adicional_broto: number;
      adicional_grande: number;
      adicional_gigante: number;
    }[];
    sabores_doces_broto_individual: { sabor: string; adicional_broto_doce_individual: number }[];
    brotos_doces_opcionais_com_grande: { sabor: string; valor: number }[];
    brotos_doces_opcionais_com_gigante: { sabor: string; valor: number }[];
  };
  bebidas_avulsas: { nome: string; preco: number }[];
  taxas_entrega: { bairro: string; taxa: number }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findBy<T extends Record<string, unknown>>(list: T[], key: keyof T, target: string): T | null {
  const n = normalize(target);
  return list.find((it) => normalize(String(it[key])) === n) ?? null;
}

function listarSabores(menu: MenuData, categoria: string) {
  switch (categoria) {
    case "salgados_grande_gigante":
      return menu.monte_do_seu_jeito.sabores_salgados.map((s) => s.sabor);
    case "doces_broto_individual":
      return menu.monte_do_seu_jeito.sabores_doces_broto_individual.map((s) => s.sabor);
    case "brotos_doces_opcionais":
      return menu.combo_2.brotos_doces_obrigatorias.map((s) => s.sabor);
    case "bebidas_avulsas":
      return menu.bebidas_avulsas.map((b) => b.nome);
    case "bebidas_inclusas_combo":
      return menu.combo_1.bebidas_inclusas;
    default:
      return null;
  }
}

function consultarCombo1(menu: MenuData, args: any) {
  // Aceita 3 formatos:
  //  (a) pizza_1: [s1,s2], pizza_2: [s1,s2]
  //  (b) sabor_pizza1_a/b, sabor_pizza2_a/b (com números)
  //  (c) sabor_pizza_um_a/b, sabor_pizza_dois_a/b (Sofia não aceita números no nome)
  const pizza_1: string[] = Array.isArray(args.pizza_1)
    ? args.pizza_1
    : [args.sabor_pizza_um_a ?? args.sabor_pizza1_a, args.sabor_pizza_um_b ?? args.sabor_pizza1_b].filter(Boolean);
  const pizza_2: string[] = Array.isArray(args.pizza_2)
    ? args.pizza_2
    : [args.sabor_pizza_dois_a ?? args.sabor_pizza2_a, args.sabor_pizza_dois_b ?? args.sabor_pizza2_b].filter(Boolean);
  const partes: string[] = [...pizza_1, ...pizza_2];
  if (partes.length !== 4) return { error: "Combo 1 precisa de 4 sabores: 2 para pizza 1 e 2 para pizza 2 (repita o mesmo sabor se for pizza inteira)." };

  const detalhe_partes: { parte: string; adicional: number }[] = [];
  let adicionais = 0;
  for (const p of partes) {
    const item = findBy(menu.combo_1.sabores_salgados, "sabor", p);
    if (!item) return { error: `Sabor "${p}" não existe no Combo 1. Use listar_sabores categoria='salgados_grande_gigante'.` };
    detalhe_partes.push({ parte: item.sabor, adicional: item.adicional_combo_1 });
    adicionais += item.adicional_combo_1;
  }
  const borda1 = args.borda_pizza_um ?? args.borda_pizza_1;
  const borda2 = args.borda_pizza_dois ?? args.borda_pizza_2;
  const bordas =
    (borda1 ? menu.combo_1.borda_por_pizza : 0) +
    (borda2 ? menu.combo_1.borda_por_pizza : 0);
  let bebida_extra = 0;
  if (args.bebida_extra && args.bebida_extra !== "nenhuma") {
    const b = findBy(menu.bebidas_avulsas, "nome", args.bebida_extra);
    if (!b) return { error: `Bebida "${args.bebida_extra}" não existe.` };
    bebida_extra = b.preco;
  }
  const subtotal = round2(menu.combo_1.preco_base + adicionais + bordas + bebida_extra);
  return {
    combo: "Combo 1 - 2 pizzas grandes + refrigerante 1,5L incluso",
    preco_base: menu.combo_1.preco_base,
    adicionais_pizzas: round2(adicionais),
    bordas,
    bebida_extra,
    subtotal_produtos: subtotal,
    pedido_minimo_atingido: subtotal >= menu.regras_gerais.pedido_minimo_produtos,
    falta_para_minimo: subtotal >= menu.regras_gerais.pedido_minimo_produtos ? 0 : round2(menu.regras_gerais.pedido_minimo_produtos - subtotal),
    detalhe_partes,
  };
}

function consultarCombo2(menu: MenuData, args: any) {
  // Aceita 3 formatos para os 3 sabores da gigante
  const partes: string[] = Array.isArray(args.pizza_gigante)
    ? args.pizza_gigante
    : [
        args.sabor_gigante_um ?? args.sabor_gigante_1,
        args.sabor_gigante_dois ?? args.sabor_gigante_2,
        args.sabor_gigante_tres ?? args.sabor_gigante_3,
      ].filter(Boolean);
  if (partes.length !== 3) return { error: "Combo 2 precisa de 3 sabores para a pizza gigante (repita o sabor se for pizza inteira de 1 sabor)." };

  let adicionais_gigante = 0;
  const detalhe_gigante: { parte: string; adicional: number }[] = [];
  for (const p of partes) {
    const item = findBy(menu.combo_2.sabores_salgados_gigante, "sabor", p);
    if (!item) return { error: `Sabor "${p}" não existe no Combo 2 gigante.` };
    detalhe_gigante.push({ parte: item.sabor, adicional: item.adicional_combo_2 });
    adicionais_gigante += item.adicional_combo_2;
  }
  const broto = findBy(menu.combo_2.brotos_doces_obrigatorias, "sabor", args.broto_doce);
  if (!broto) return { error: `Broto doce "${args.broto_doce}" não existe. Use listar_sabores categoria='brotos_doces_opcionais'.` };
  const adicional_broto = broto.adicional_broto_combo_2;
  const borda = args.borda_gigante ? menu.combo_2.borda_gigante : 0;
  let bebida_extra = 0;
  if (args.bebida_extra && args.bebida_extra !== "nenhuma") {
    const b = findBy(menu.bebidas_avulsas, "nome", args.bebida_extra);
    if (!b) return { error: `Bebida "${args.bebida_extra}" não existe.` };
    bebida_extra = b.preco;
  }
  const subtotal = round2(menu.combo_2.preco_base + adicionais_gigante + adicional_broto + borda + bebida_extra);
  return {
    combo: "Combo 2 - pizza gigante + broto doce + refrigerante 1,5L incluso",
    preco_base: menu.combo_2.preco_base,
    adicionais_gigante: round2(adicionais_gigante),
    broto_doce: { sabor: broto.sabor, adicional: adicional_broto },
    borda,
    bebida_extra,
    subtotal_produtos: subtotal,
    pedido_minimo_atingido: subtotal >= menu.regras_gerais.pedido_minimo_produtos,
    falta_para_minimo: subtotal >= menu.regras_gerais.pedido_minimo_produtos ? 0 : round2(menu.regras_gerais.pedido_minimo_produtos - subtotal),
    detalhe_gigante,
  };
}

function consultarMonteDoSeuJeito(menu: MenuData, args: any) {
  const tamanho = args.tamanho as "broto" | "grande" | "gigante";
  const cfg = menu.monte_do_seu_jeito.tamanhos[tamanho];
  if (!cfg) return { error: `tamanho "${tamanho}" inválido.` };

  // Aceita sabores: [...] OU flat (com palavras ou números)
  const sabores: string[] = Array.isArray(args.sabores)
    ? args.sabores
    : [
        args.sabor_um ?? args.sabor_1,
        args.sabor_dois ?? args.sabor_2,
        args.sabor_tres ?? args.sabor_3,
      ].filter(Boolean);
  const expected = tamanho === "broto" ? 1 : tamanho === "grande" ? 2 : 3;
  if (sabores.length !== expected) {
    return { error: `tamanho ${tamanho} exige ${expected} sabor(es). Para pizza inteira de 1 sabor, repita o mesmo sabor.` };
  }

  let adicionais = 0;
  const detalhe: { parte: string; adicional: number }[] = [];
  if (tamanho === "broto") {
    const tipo = args.tipo_broto;
    if (tipo === "doce") {
      const item = findBy(menu.monte_do_seu_jeito.sabores_doces_broto_individual, "sabor", sabores[0]);
      if (!item) return { error: `Sabor doce broto "${sabores[0]}" não existe.` };
      adicionais = item.adicional_broto_doce_individual;
      detalhe.push({ parte: item.sabor, adicional: adicionais });
    } else if (tipo === "salgada") {
      const item = findBy(menu.monte_do_seu_jeito.sabores_salgados, "sabor", sabores[0]);
      if (!item) return { error: `Sabor salgado broto "${sabores[0]}" não existe.` };
      adicionais = item.adicional_broto;
      detalhe.push({ parte: item.sabor, adicional: item.adicional_broto });
    } else {
      return { error: "tipo_broto deve ser 'salgada' ou 'doce' quando tamanho=broto." };
    }
  } else {
    const key = (tamanho === "grande" ? "adicional_grande" : "adicional_gigante") as
      | "adicional_grande"
      | "adicional_gigante";
    for (const s of sabores) {
      const item = findBy(menu.monte_do_seu_jeito.sabores_salgados, "sabor", s);
      if (!item) return { error: `Sabor "${s}" não existe.` };
      const adic = item[key];
      detalhe.push({ parte: item.sabor, adicional: adic });
      adicionais += adic;
    }
  }

  const borda = args.borda ? cfg.borda : 0;
  let bebida_promo = 0;
  if (
    args.bebida_promocional &&
    args.bebida_promocional !== "nenhuma" &&
    (tamanho === "grande" || tamanho === "gigante")
  ) {
    if (!menu.monte_do_seu_jeito.bebidas_promocionais_grande_ou_gigante.includes(args.bebida_promocional)) {
      return { error: `bebida_promocional "${args.bebida_promocional}" não está na lista promocional.` };
    }
    bebida_promo = (menu.monte_do_seu_jeito.tamanhos as any)[tamanho].bebida_promocional ?? 0;
  }
  let bebida_avulsa = 0;
  if (args.bebida_avulsa && args.bebida_avulsa !== "nenhuma") {
    const b = findBy(menu.bebidas_avulsas, "nome", args.bebida_avulsa);
    if (!b) return { error: `Bebida avulsa "${args.bebida_avulsa}" não existe.` };
    bebida_avulsa = b.preco;
  }

  const subtotal = round2(cfg.preco_base + adicionais + borda + bebida_promo + bebida_avulsa);
  return {
    pedido: `Monte do Seu Jeito - ${tamanho}`,
    preco_base: cfg.preco_base,
    adicionais_sabores: round2(adicionais),
    borda,
    bebida_promocional: bebida_promo,
    bebida_avulsa,
    subtotal_produtos: subtotal,
    pedido_minimo_atingido: subtotal >= menu.regras_gerais.pedido_minimo_produtos,
    falta_para_minimo: subtotal >= menu.regras_gerais.pedido_minimo_produtos ? 0 : round2(menu.regras_gerais.pedido_minimo_produtos - subtotal),
    detalhe,
  };
}

function consultarBebidaAvulsa(menu: MenuData, args: any) {
  const b = findBy(menu.bebidas_avulsas, "nome", args.bebida);
  if (!b) return { error: `Bebida "${args.bebida}" não existe.` };
  const qtd = Math.max(1, Math.min(20, Number(args.quantidade ?? 1)));
  const subtotal = round2(b.preco * qtd);
  return {
    bebida: b.nome,
    preco_unitario: b.preco,
    quantidade: qtd,
    subtotal_produtos: subtotal,
    pedido_minimo_atingido: subtotal >= menu.regras_gerais.pedido_minimo_produtos,
    falta_para_minimo: subtotal >= menu.regras_gerais.pedido_minimo_produtos ? 0 : round2(menu.regras_gerais.pedido_minimo_produtos - subtotal),
  };
}

function consultarTaxaEntrega(menu: MenuData, args: any) {
  const target = normalize(String(args.bairro ?? ""));
  if (!target) return { error: "Informe o bairro." };
  const item = menu.taxas_entrega.find((t) => normalize(t.bairro) === target);
  if (!item) {
    return {
      bairro_consultado: args.bairro,
      atendido: false,
      mensagem:
        "Bairro fora da nossa área de entrega. Oferecer retirada no balcão ou transferir para humano confirmar viabilidade.",
    };
  }
  return { bairro: item.bairro, atendido: true, taxa: item.taxa };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  // Shared-secret básico opcional
  const expectedSecret = Deno.env.get("SOFIA_WEBHOOK_SECRET");
  if (expectedSecret) {
    const got = req.headers.get("x-sofia-webhook-secret") ?? "";
    if (got !== expectedSecret) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }
  }

  try {
    const body = await req.json();
    // Sofia pode mandar em formatos diferentes — normalizar.
    // Em Custom Mid-Call Tools, a Sofia não envia o nome da tool no body,
    // então preferimos pegar via query string ?tool=NOMEDATOOL.
    const url = new URL(req.url);
    const toolName: string =
      url.searchParams.get("tool") ??
      body?.tool_name ??
      body?.name ??
      body?.function?.name ??
      body?.tool?.name ??
      "";
    let args: any =
      body?.arguments ??
      body?.args ??
      body?.function?.arguments ??
      body?.tool?.arguments ??
      body?.parameters ??
      body;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // mantém string crua
      }
    }
    // Quando a Sofia chama via Custom Mid-Call Tools, o body é só os argumentos
    // (sem wrapping). Já é o que queremos: args = body.
    if (!toolName) {
      return jsonResponse({ ok: false, error: "tool_name ausente no payload." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: row, error } = await supabase
      .from("sofia_menu")
      .select("data")
      .eq("slug", "estrela_da_ilha_v1")
      .single();
    if (error || !row) {
      return jsonResponse({ ok: false, error: "Menu não encontrado." }, 500);
    }
    const menu = row.data as MenuData;

    let result: unknown;
    switch (toolName) {
      case "listar_sabores": {
        const lista = listarSabores(menu, args.categoria);
        if (lista === null) {
          result = { error: `categoria "${args.categoria}" inválida.` };
        } else {
          result = { categoria: args.categoria, items: lista };
        }
        break;
      }
      case "consultar_combo_1":
        result = consultarCombo1(menu, args);
        break;
      case "consultar_combo_2":
        result = consultarCombo2(menu, args);
        break;
      case "consultar_monte_do_seu_jeito":
        result = consultarMonteDoSeuJeito(menu, args);
        break;
      case "consultar_bebida_avulsa":
        result = consultarBebidaAvulsa(menu, args);
        break;
      case "consultar_taxa_entrega":
        result = consultarTaxaEntrega(menu, args);
        break;
      default:
        return jsonResponse({ ok: false, error: `tool desconhecida: ${toolName}` }, 400);
    }

    if ((result as any)?.error) {
      return jsonResponse({ ok: false, error: (result as any).error, tool: toolName }, 200);
    }
    return jsonResponse({ ok: true, tool: toolName, result }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
