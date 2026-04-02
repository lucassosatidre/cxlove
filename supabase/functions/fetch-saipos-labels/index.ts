import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DRINK_KEYWORDS = ["coca", "pureza", "guaraná", "guarana", "vinho", "cerveja", "água", "agua", "fanta", "sprite", "pepsi", "suco", "refrigerante"];
const PIZZA_KEYWORDS = ["pizza", "gigante", "grande", "broto", "brotinho", "média", "media", "família", "familia", "temx"];

function isDrinkName(name: string): boolean {
  const lower = name.toLowerCase();
  return DRINK_KEYWORDS.some(kw => lower.includes(kw));
}

function isPizzaName(name: string): boolean {
  const lower = name.toLowerCase();
  return PIZZA_KEYWORDS.some(kw => lower.includes(kw));
}

function isCombo(desc: string): boolean {
  return desc.includes("+");
}

interface LabelItem {
  name: string;
  type: "pizza" | "drink";
  quantity: number;
}

function decomposeItems(rawItem: any): LabelItem[] {
  const desc = rawItem.desc_sale_item || rawItem.name || rawItem.product_name || "Item";
  const quantity = rawItem.quantity || rawItem.qt_quantity || 1;
  const choices: any[] = rawItem.choices || [];
  const results: LabelItem[] = [];

  if (isCombo(desc)) {
    // Parse combo: split by "+" and analyze each part
    // Clean up patterns like "## 2 x Pizza Grande TEMX ##"
    const cleaned = desc.replace(/^#+\s*/, "").replace(/\s*#+$/, "").trim();
    const parts = cleaned.split("+").map((p: string) => p.trim()).filter(Boolean);

    for (const part of parts) {
      // Extract quantity prefix like "2x", "2 x", "2 X"
      const qtyMatch = part.match(/^(\d+)\s*[xX]\s*(.+)$/);
      const partQty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const partName = qtyMatch ? qtyMatch[2].trim() : part.trim();

      if (isDrinkName(partName)) {
        results.push({ name: partName, type: "drink", quantity: partQty * quantity });
      } else if (isPizzaName(partName)) {
        results.push({ name: partName, type: "pizza", quantity: partQty * quantity });
      } else if (partName.toLowerCase().includes("refrigerante")) {
        // Generic "Refrigerante" — skip, will try to find real drink name in choices
      } else {
        // Unknown combo part — show as pizza by default
        results.push({ name: partName, type: "pizza", quantity: partQty * quantity });
      }
    }

    // Process choices for drinks and broto doce
    for (const choice of choices) {
      const choiceName = choice.desc_sale_item_choice || choice.name || "";
      if (!choiceName) continue;
      const lower = choiceName.toLowerCase();

      if (lower.includes("pizza broto de") || lower.includes("broto de")) {
        // Broto doce from combo
        results.push({ name: "Pizza Broto", type: "pizza", quantity: 1 });
      } else if (isDrinkName(choiceName)) {
        // Drink from combo choices (e.g., "Coca Cola Zero 1,5l")
        results.push({ name: choiceName, type: "drink", quantity: 1 });
      }
      // Ignore flavors, borders, etc.
    }

    // If combo had "Refrigerante" but no real drink found in choices, don't add generic

    return results.length > 0 ? results : [{ name: desc, type: "pizza", quantity }];
  }

  // Non-combo: pizza or drink
  if (isPizzaName(desc)) {
    return [{ name: desc, type: "pizza", quantity }];
  }

  // Default: treat as drink/other
  return [{ name: desc, type: "drink", quantity }];
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 2000): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok || attempt === retries) return res;
    if (res.status >= 500) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 1.5;
    } else {
      return res;
    }
  }
  return fetch(url, options);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let saiposToken = Deno.env.get("SAIPOS_API_TOKEN");
    if (saiposToken?.startsWith("Bearer ")) {
      saiposToken = saiposToken.slice(7);
    }

    if (!saiposToken) {
      return new Response(
        JSON.stringify({ error: "Token da API Saipos não configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { closing_date } = await req.json();
    if (!closing_date) {
      return new Response(
        JSON.stringify({ error: "closing_date é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1) Fetch sales
    const allSales: any[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const params = new URLSearchParams({
        p_date_column_filter: "shift_date",
        p_filter_date_start: `${closing_date}T00:00:00`,
        p_filter_date_end: `${closing_date}T23:59:59`,
        p_limit: String(limit),
        p_offset: String(offset),
      });

      const res = await fetchWithRetry(
        `https://data.saipos.io/v1/search_sales?${params.toString()}`,
        { headers: { Authorization: `Bearer ${saiposToken}` } }
      );

      if (!res.ok) {
        const errText = await res.text();
        return new Response(
          JSON.stringify({ error: `Erro na API Saipos: ${res.status} - ${errText}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json();
      const sales = Array.isArray(data) ? data : data.data || data.results || [];
      if (sales.length === 0) break;

      const filtered = sales.filter((s: any) => s.id_sale_type === 1 && s.id_status !== 3);
      allSales.push(...filtered);

      if (sales.length < limit) break;
      offset += limit;
    }

    // 2) Fetch items
    const allItems: any[] = [];
    let itemOffset = 0;

    while (true) {
      const params = new URLSearchParams({
        p_date_column_filter: "shift_date",
        p_filter_date_start: `${closing_date}T00:00:00`,
        p_filter_date_end: `${closing_date}T23:59:59`,
        p_limit: String(limit),
        p_offset: String(itemOffset),
      });

      const res = await fetchWithRetry(
        `https://data.saipos.io/v1/sales_items?${params.toString()}`,
        { headers: { Authorization: `Bearer ${saiposToken}` } }
      );

      if (!res.ok) break;

      const data = await res.json();
      const items = Array.isArray(data) ? data : data.data || data.results || [];
      if (items.length === 0) break;

      allItems.push(...items);
      if (items.length < limit) break;
      itemOffset += limit;
    }

    // 3) Build decomposed items map by id_sale
    const itemsBySale = new Map<number, LabelItem[]>();
    for (const rawRecord of allItems) {
      const saleId = rawRecord.id_sale;
      if (!saleId) continue;
      if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);

      const nestedItems = rawRecord.items;
      if (Array.isArray(nestedItems) && nestedItems.length > 0) {
        for (const subItem of nestedItems) {
          const decomposed = decomposeItems(subItem);
          itemsBySale.get(saleId)!.push(...decomposed);
        }
      } else {
        const decomposed = decomposeItems(rawRecord);
        itemsBySale.get(saleId)!.push(...decomposed);
      }
    }

    // 4) Build response
    const orders = allSales.map((sale: any) => {
      const saleId = sale.id_sale;
      const saleNumber = String(sale.sale_number || saleId);
      const total = sale.total_amount || 0;
      const items = itemsBySale.get(saleId) || [];

      let saleTime: string | null = null;
      if (sale.created_at) {
        try {
          const dt = new Date(sale.created_at);
          saleTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
        } catch { saleTime = null; }
      }

      return {
        id: saleId,
        sale_number: saleNumber,
        total,
        items,
        sale_time: saleTime,
      };
    });

    orders.sort((a, b) => {
      const numA = parseInt(a.sale_number, 10);
      const numB = parseInt(b.sale_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.sale_number.localeCompare(b.sale_number);
    });

    return new Response(
      JSON.stringify({ orders, total_sales: orders.length, total_items: allItems.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
