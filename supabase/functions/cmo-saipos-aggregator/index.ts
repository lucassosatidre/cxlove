// @ts-nocheck
// cmo-saipos-aggregator
// Cross-project endpoint para o módulo C.M.O. do rhlove.
// Auth via header `x-cmo-shared-secret` (rhlove e cxlove são projetos diferentes,
// então JWT nativo do Supabase não funciona).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cmo-shared-secret, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SAIPOS_BASE = "https://data.saipos.io/v1";
const PAGE_LIMIT = 1000;
const TOTAL_TIMEOUT_MS = 10 * 60 * 1000;

function pad(n: number) { return String(n).padStart(2, "0"); }

function buildWindows(year: number, month: number): { start: string; end: string }[] {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const windows: { start: string; end: string }[] = [];
  let cur = 1;
  while (cur <= lastDay) {
    const end = Math.min(cur + 13, lastDay);
    windows.push({
      start: `${year}-${pad(month)}-${pad(cur)}`,
      end: `${year}-${pad(month)}-${pad(end)}`,
    });
    cur = end + 1;
  }
  return windows;
}

async function saiposFetch(url: string, token: string, deadline: number): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() > deadline) throw new Error("Timeout total excedido");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res;
    if (res.status === 403 || res.status === 429) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
    }
    return res;
  }
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function fetchAllPaged(
  endpoint: string,
  startDate: string,
  endDate: string,
  token: string,
  deadline: number,
): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    if (Date.now() > deadline) throw new Error("Timeout total excedido");
    const params = new URLSearchParams({
      p_date_column_filter: "shift_date",
      p_filter_date_start: `${startDate}T00:00:00`,
      p_filter_date_end: `${endDate}T23:59:59`,
      p_limit: String(PAGE_LIMIT),
      p_offset: String(offset),
    });
    const res = await saiposFetch(`${SAIPOS_BASE}/${endpoint}?${params.toString()}`, token, deadline);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Saipos ${endpoint} ${res.status}: ${body.slice(0, 500)}`);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const sharedSecret = Deno.env.get("CMO_SHARED_SECRET");
    let saiposToken = Deno.env.get("SAIPOS_API_TOKEN");
    if (saiposToken?.startsWith("Bearer ")) saiposToken = saiposToken.slice(7);

    if (!sharedSecret) {
      return new Response(JSON.stringify({ error: "CMO_SHARED_SECRET não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!saiposToken) {
      return new Response(JSON.stringify({ error: "SAIPOS_API_TOKEN não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const incoming = req.headers.get("x-cmo-shared-secret");
    if (!incoming || incoming !== sharedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const year = Number(body.year);
    const month = Number(body.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return new Response(JSON.stringify({ error: "year/month inválidos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const windows = buildWindows(year, month);

    const allSales: any[] = [];
    const allItems: any[] = [];

    for (const w of windows) {
      const [sales, items] = await Promise.all([
        fetchAllPaged("search_sales", w.start, w.end, saiposToken, deadline),
        fetchAllPaged("search_items_of_sale", w.start, w.end, saiposToken, deadline),
      ]);
      for (const s of sales) {
        if (String(s.canceled || "").toUpperCase() !== "Y") allSales.push(s);
      }
      allItems.push(...items);
    }

    // Agregação
    let salao_faturamento = 0;
    const salaoMesas = new Set<any>();
    let balcao_faturamento = 0, balcao_qtd = 0;
    let telefone_faturamento = 0, telefone_qtd = 0;
    let delivery_faturamento = 0;

    for (const s of allSales) {
      const total = Number(s.total_amount) || 0;
      const type = s.id_sale_type;
      if (type === 3) {
        salao_faturamento += total;
        const tableId = s.table_order?.id_store_table;
        if (tableId != null) salaoMesas.add(tableId);
      } else if (type === 2) {
        balcao_faturamento += total;
        balcao_qtd += 1;
      } else if (type === 1) {
        const cod = s.partner_sale?.cod_sale1;
        const hasPartner = cod != null && String(cod).trim() !== "";
        if (hasPartner) {
          delivery_faturamento += total;
        } else {
          telefone_faturamento += total;
          telefone_qtd += 1;
        }
      }
    }

    // Pizzas — items podem vir aninhados em `items` (ver fetch-saipos-labels)
    let cozinha_qtd_pizzas = 0;
    const countPizza = (it: any) => {
      const desc = String(it.desc_sale_item || it.name || "").toUpperCase();
      if (desc.includes("PIZZA")) cozinha_qtd_pizzas += Number(it.quantity || it.qt_quantity || 0);
    };
    for (const rec of allItems) {
      const nested = rec.items;
      if (Array.isArray(nested) && nested.length > 0) {
        for (const sub of nested) countPizza(sub);
      } else {
        countPizza(rec);
      }
    }

    const total_faturamento = salao_faturamento + balcao_faturamento + telefone_faturamento + delivery_faturamento;

    return new Response(JSON.stringify({
      year, month,
      salao_faturamento,
      salao_qtd_mesas: salaoMesas.size,
      balcao_faturamento,
      balcao_qtd,
      telefone_faturamento,
      telefone_qtd,
      delivery_faturamento,
      total_faturamento,
      cozinha_qtd_pizzas,
      sales_count: allSales.length,
      items_count: allItems.length,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
