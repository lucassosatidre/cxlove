// @ts-nocheck
// count-massas-day
// Conta unidades de massa pré-assada vendidas em um dia, a partir da API Saipos.
// Categorias: gigante, grande, broto_salgado (3 salgados), broto_doce dividido entre salão
// vs outros canais (delivery + retirada + ficha), e 4 tipos de borda recheada.
// Auth: header `x-cmo-shared-secret` (mesmo secret usado por cmo-saipos-aggregator).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cmo-shared-secret, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SAIPOS_BASE = "https://data.saipos.io/v1";
const PAGE_LIMIT = 1000;
const TOTAL_TIMEOUT_MS = 3 * 60 * 1000;

const BORDA_SLOTS: Record<string, string> = {
  "catupiry": "borda_catupiry",
  "cheddar": "borda_cheddar",
  "chocolate preto": "borda_chocolate_preto",
  "chocolate branco": "borda_chocolate_branco",
};

function normalize(s: any): string {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function classifyBorda(text: string): string | null {
  const n = normalize(text);
  if (!n) return null;
  if (n in BORDA_SLOTS) return BORDA_SLOTS[n];
  if (n.includes("borda")) {
    for (const [k, slot] of Object.entries(BORDA_SLOTS)) {
      if (n.includes(k)) return slot;
    }
  }
  return null;
}

function classifyPizzaPart(desc: string): { slot: "gigante" | "grande" | "broto_salgado" | "broto_doce" } | null {
  const n = normalize(desc);
  if (!n) return null;
  if (n.includes("gigante")) return { slot: "gigante" };
  if (n.includes("grande")) return { slot: "grande" };
  if (n.includes("broto")) {
    const isDoce = n.includes("broto de") || n.includes("broto doce") || n.includes("doce");
    return { slot: isDoce ? "broto_doce" : "broto_salgado" };
  }
  return null;
}

async function saiposFetch(url: string, token: string, deadline: number): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() > deadline) throw new Error("Timeout total");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res;
    if ((res.status === 403 || res.status === 429) && attempt === 0) {
      await new Promise(r => setTimeout(r, 30_000));
      continue;
    }
    return res;
  }
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function fetchAllPaged(endpoint: string, day: string, token: string, deadline: number) {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    if (Date.now() > deadline) throw new Error("Timeout total");
    const params = new URLSearchParams({
      p_date_column_filter: "shift_date",
      p_filter_date_start: `${day}T00:00:00`,
      p_filter_date_end: `${day}T23:59:59`,
      p_limit: String(PAGE_LIMIT),
      p_offset: String(offset),
    });
    const res = await saiposFetch(`${SAIPOS_BASE}/${endpoint}?${params.toString()}`, token, deadline);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Saipos ${endpoint} ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.data || data.results || [];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return all;
}

// Extrai pizzas (com tamanho) e bordas de um item potencialmente composto.
// Combo: "Pizza Gigante X + Pizza Broto de Y" → 1 gigante + 1 broto doce.
// Choices: ['Catupiry'] ou ['Borda de Catupiry'] → conta borda.
function extractFromItem(rawItem: any, qty: number): { pizzas: string[]; bordas: string[]; unclassified: string[] } {
  const desc = String(rawItem.desc_sale_item || rawItem.name || rawItem.product_name || "");
  const itemQty = (Number(rawItem.quantity) || Number(rawItem.qt_quantity) || 1) * qty;
  const choices: any[] = Array.isArray(rawItem.choices) ? rawItem.choices : [];
  const pizzas: string[] = [];
  const bordas: string[] = [];
  const unclassified: string[] = [];

  // 1. Combos: divide por "+" e classifica cada parte
  if (desc.includes("+")) {
    const cleaned = desc.replace(/^#+\s*/, "").replace(/\s*#+$/, "").trim();
    const parts = cleaned.split("+").map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const qtyMatch = part.match(/^(\d+)\s*[xX]\s*(.+)$/);
      const partQty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const partName = qtyMatch ? qtyMatch[2].trim() : part.trim();
      const cls = classifyPizzaPart(partName);
      if (cls) {
        for (let i = 0; i < partQty * itemQty; i++) pizzas.push(cls.slot);
      }
      // refrigerantes/bebidas: ignora
    }
  } else {
    const cls = classifyPizzaPart(desc);
    if (cls) {
      for (let i = 0; i < itemQty; i++) pizzas.push(cls.slot);
    } else if (normalize(desc).includes("pizza")) {
      unclassified.push(desc);
    }
  }

  // 2. Choices: extrai bordas + brotos doces que aparecem como choice (combo 2)
  for (const ch of choices) {
    const chText = ch?.desc_sale_item_choice || ch?.name || ch?.desc || "";
    const chGroup = ch?.name || "";
    const borda = classifyBorda(chText) || classifyBorda(chGroup);
    if (borda) {
      for (let i = 0; i < itemQty; i++) bordas.push(borda);
      continue;
    }
    // Broto doce que vem como choice de combo (ex: "Pizza Broto de Chocolate")
    const n = normalize(chText);
    if (n.includes("broto de") || (n.includes("broto") && n.includes("doce"))) {
      for (let i = 0; i < itemQty; i++) pizzas.push("broto_doce");
    }
  }

  return { pizzas, bordas, unclassified };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const sharedSecret = Deno.env.get("CMO_SHARED_SECRET");
    let saiposToken = Deno.env.get("SAIPOS_API_TOKEN");
    if (saiposToken?.startsWith("Bearer ")) saiposToken = saiposToken.slice(7);
    if (!sharedSecret) return new Response(JSON.stringify({ error: "CMO_SHARED_SECRET ausente" }), { status: 500, headers: corsHeaders });
    if (!saiposToken) return new Response(JSON.stringify({ error: "SAIPOS_API_TOKEN ausente" }), { status: 500, headers: corsHeaders });

    const incoming = req.headers.get("x-cmo-shared-secret");
    if (!incoming || incoming !== sharedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const day: string = String(body.date || "");
    const debug: boolean = Boolean(body.debug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return new Response(JSON.stringify({ error: "date (YYYY-MM-DD) obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deadline = Date.now() + TOTAL_TIMEOUT_MS;

    const [sales, items] = await Promise.all([
      fetchAllPaged("search_sales", day, saiposToken, deadline),
      fetchAllPaged("sales_items", day, saiposToken, deadline),
    ]);

    // Filtra cancelados
    const activeSales = sales.filter(s => String(s.canceled || "").toUpperCase() !== "Y" && s.id_status !== 3);
    const saleTypeById = new Map<number, number>();
    const salesByType: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, other: 0 };
    for (const s of activeSales) {
      saleTypeById.set(s.id_sale, s.id_sale_type);
      const key = String(s.id_sale_type);
      if (key in salesByType) salesByType[key]++;
      else salesByType.other++;
    }

    // Acumuladores
    const counts: Record<string, number> = {
      gigante: 0,
      grande: 0,
      broto_salgado: 0,
      broto_doce_outros: 0,  // delivery (1) + retirada (2) + ficha (4)
      broto_doce_salao: 0,   // salão (3)
      borda_catupiry: 0,
      borda_cheddar: 0,
      borda_chocolate_preto: 0,
      borda_chocolate_branco: 0,
    };

    const unclassifiedSamples: string[] = [];
    const bordaDebug: any[] = [];
    let itemsConsidered = 0;
    let itemsIgnoredNoSale = 0;

    for (const rec of items) {
      const saleId = rec.id_sale;
      if (!saleId) continue;
      const saleType = saleTypeById.get(saleId);
      if (saleType == null) { itemsIgnoredNoSale++; continue; }  // venda cancelada/não no escopo

      itemsConsidered++;

      // O record raiz pode conter outro array `items` (combos aninhados)
      const nested = Array.isArray(rec.items) ? rec.items : [];
      const subItems = nested.length > 0 ? nested : [rec];

      for (const sub of subItems) {
        const extracted = extractFromItem(sub, 1);
        for (const p of extracted.pizzas) {
          if (p === "broto_doce") {
            if (saleType === 3) counts.broto_doce_salao++;
            else counts.broto_doce_outros++;
          } else if (p in counts) {
            counts[p]++;
          }
        }
        for (const b of extracted.bordas) {
          if (b in counts) counts[b]++;
          if (debug && bordaDebug.length < 10) bordaDebug.push({ borda: b, item: sub.desc_sale_item });
        }
        if (debug && extracted.unclassified.length > 0 && unclassifiedSamples.length < 15) {
          unclassifiedSamples.push(...extracted.unclassified);
        }
      }
    }

    return new Response(JSON.stringify({
      date: day,
      counts,
      diagnostics: {
        sales_total: activeSales.length,
        sales_by_type: salesByType,  // 1=deliv, 2=retir, 3=salão, 4=ficha
        items_records: items.length,
        items_considered: itemsConsidered,
        items_ignored_no_active_sale: itemsIgnoredNoSale,
        ...(debug ? { unclassified_pizza_samples: unclassifiedSamples, borda_debug: bordaDebug } : {}),
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
