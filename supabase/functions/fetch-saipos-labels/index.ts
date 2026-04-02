import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PIZZA_KEYWORDS = ["broto", "brotinho", "média", "media", "grande", "gigante", "família", "familia", "especial"];

function isPizza(descItem: string): boolean {
  const lower = (descItem || "").toLowerCase();
  return PIZZA_KEYWORDS.some(kw => lower.includes(kw));
}

function buildItemLabel(rawItem: any): { name: string; type: "pizza" | "other"; quantity: number; price: number } {
  const desc = rawItem.desc_sale_item || rawItem.name || rawItem.product_name || "Item";
  const quantity = rawItem.quantity || rawItem.qt_quantity || 1;
  const price = rawItem.total_price || rawItem.vl_total || rawItem.price || 0;
  const choices: any[] = rawItem.choices || [];

  if (isPizza(desc)) {
    const flavors = choices
      .map((c: any) => c.desc_sale_item_choice || c.name || "")
      .filter(Boolean);
    const flavorStr = flavors.length > 0 ? ` - ${flavors.join(" / ")}` : "";
    return { name: `${desc}${flavorStr}`, type: "pizza", quantity, price };
  }

  return { name: desc, type: "other", quantity, price };
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

      const res = await fetch(
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

      const res = await fetch(
        `https://data.saipos.io/v1/sales_items?${params.toString()}`,
        { headers: { Authorization: `Bearer ${saiposToken}` } }
      );

      if (!res.ok) {
        console.error("Error fetching items:", res.status);
        break;
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : data.data || data.results || [];
      if (items.length === 0) break;

      allItems.push(...items);
      if (items.length < limit) break;
      itemOffset += limit;
    }

    // DEBUG: log first sale and first item to see actual field names
    if (allSales.length > 0) {
      console.log("FIRST SALE KEYS:", Object.keys(allSales[0]));
      console.log("FIRST SALE:", JSON.stringify(allSales[0]).substring(0, 2000));
    }
    if (allItems.length > 0) {
      console.log("FIRST ITEM KEYS:", Object.keys(allItems[0]));
      console.log("FIRST ITEM:", JSON.stringify(allItems[0]).substring(0, 2000));
    }

    // 3) Build items map by id_sale using new pizza/other logic
    const itemsBySale = new Map<number, any[]>();
    for (const rawItem of allItems) {
      const saleId = rawItem.id_sale;
      if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
      const parsed = buildItemLabel(rawItem);
      itemsBySale.get(saleId)!.push(parsed);
    }

    // 4) Build response
    const orders = allSales.map((sale: any) => {
      const saleId = sale.id_sale || sale.id;
      const saleNumber = String(sale.sale_number || sale.order_number || sale.nu_sale || saleId);
      const paymentMethod = sale.payment_method_name || sale.ds_payment_method || sale.payment_method || "N/A";
      const total = sale.total_value || sale.vl_total || sale.total || 0;
      const items = itemsBySale.get(saleId) || [];

      return {
        id: saleId,
        sale_number: saleNumber,
        payment_method: paymentMethod,
        total,
        items,
        delivery_person: sale.delivery_person_name || sale.ds_delivery_person || null,
        sale_time: sale.sale_time || sale.dt_sale || null,
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
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
