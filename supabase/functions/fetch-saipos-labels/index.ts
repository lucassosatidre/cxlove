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

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 2000): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok || attempt === retries) return res;
    if (res.status >= 500) {
      console.log(`[RETRY] Attempt ${attempt}/${retries} failed with ${res.status}, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 1.5;
    } else {
      return res;
    }
  }
  return fetch(url, options); // fallback
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
        console.error("Error fetching items:", res.status, await res.text());
        break;
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : data.data || data.results || [];
      if (items.length === 0) break;

      // Debug: log first 3 items structure
      if (itemOffset === 0) {
        console.log(`[DEBUG] sales_items total batch: ${items.length}`);
        console.log(`[DEBUG] First 3 items keys:`, items.slice(0, 3).map((i: any) => Object.keys(i)));
        console.log(`[DEBUG] First 3 items:`, JSON.stringify(items.slice(0, 3)));
      }

      allItems.push(...items);
      if (items.length < limit) break;
      itemOffset += limit;
    }

    console.log(`[DEBUG] Total sales: ${allSales.length}, Total items: ${allItems.length}`);
    // Debug: check id_sale presence in items
    if (allItems.length > 0) {
      const sampleItem = allItems[0];
      console.log(`[DEBUG] Sample item fields: ${Object.keys(sampleItem).join(', ')}`);
      console.log(`[DEBUG] Sample item id_sale: ${sampleItem.id_sale}, sale_number: ${sampleItem.sale_number}`);
    }

    // 3) Build items map by id_sale — handle both flat and nested structures
    const itemsBySale = new Map<number, any[]>();
    for (const rawRecord of allItems) {
      const saleId = rawRecord.id_sale;
      if (!saleId) continue;
      if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);

      // Check if record has nested items array (structure: { id_sale, items: [...] })
      const nestedItems = rawRecord.items;
      if (Array.isArray(nestedItems) && nestedItems.length > 0) {
        for (const subItem of nestedItems) {
          const parsed = buildItemLabel(subItem);
          itemsBySale.get(saleId)!.push(parsed);
        }
      } else {
        // Flat structure: each record IS an item
        const parsed = buildItemLabel(rawRecord);
        itemsBySale.get(saleId)!.push(parsed);
      }
    }

    // Debug: log first 3 sales item mapping
    const saleIds = Array.from(itemsBySale.keys()).slice(0, 3);
    for (const sid of saleIds) {
      console.log(`[DEBUG] Sale ${sid} items:`, JSON.stringify(itemsBySale.get(sid)));
    }

    // 4) Build response using correct Saipos field names
    const orders = allSales.map((sale: any) => {
      const saleId = sale.id_sale;
      const saleNumber = String(sale.sale_number || saleId);

      // Payment method from payments array
      const payments = sale.payments || [];
      const paymentMethod = payments.length > 0
        ? payments.map((p: any) => p.desc_store_payment_type || "").filter(Boolean).join(", ") || "N/A"
        : "N/A";

      const total = sale.total_amount || 0;
      const items = itemsBySale.get(saleId) || [];

      // Delivery person
      let deliveryPerson: string | null = null;
      if (sale.delivery_man?.delivery_man_name) {
        deliveryPerson = sale.delivery_man.delivery_man_name;
      } else if (sale.delivery?.delivery_by === "PARTNER" || sale.partner_delivery?.partner_order_id) {
        deliveryPerson = "Entrega Parceiro";
      }

      // Time from created_at
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
        payment_method: paymentMethod,
        total,
        items,
        delivery_person: deliveryPerson,
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
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
