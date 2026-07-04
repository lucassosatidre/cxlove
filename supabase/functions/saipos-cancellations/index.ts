import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function mapSaleType(id: number): string {
  switch (id) {
    case 1: return "Delivery";
    case 2: return "Retirada";
    case 3: return "Salão";
    case 4: return "Ficha";
    default: return String(id);
  }
}

function saleTime(created_at: string | null | undefined): string | null {
  if (!created_at) return null;
  try {
    const dt = new Date(created_at);
    return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

async function fetchSaiposWithRetry(url: string, token: string, tentativas = 4): Promise<Response> {
  const delays = [1500, 4000, 9000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tentativas; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        if (attempt < tentativas - 1) {
          await new Promise((r) => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]));
          continue;
        }
        return res;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < tentativas - 1) {
        await new Promise((r) => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
    if (saiposToken?.startsWith("Bearer ")) saiposToken = saiposToken.slice(7);

    if (!saiposToken) {
      return new Response(JSON.stringify({ error: "Token da API Saipos não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { closing_date, scope } = await req.json();
    if (!closing_date || !/^\d{4}-\d{2}-\d{2}$/.test(closing_date)) {
      return new Response(JSON.stringify({ error: "closing_date inválido (esperado YYYY-MM-DD)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (scope !== "salon" && scope !== "tele") {
      return new Response(JSON.stringify({ error: "scope inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allowedTypes = scope === "salon" ? [2, 3, 4] : [1];

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
      const res = await fetchSaiposWithRetry(
        `https://data.saipos.io/v1/search_sales?${params.toString()}`,
        saiposToken
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return new Response(JSON.stringify({ error: `Erro na API Saipos: ${res.status} - ${errText}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await res.json();
      const sales = Array.isArray(data) ? data : data.data || data.results || [];
      if (sales.length === 0) break;
      allSales.push(...sales);
      if (sales.length < limit) break;
      offset += limit;
    }

    const inScope = allSales.filter((s: any) => allowedTypes.includes(s.id_sale_type));

    const canceled_sales = inScope
      .filter((s: any) => s.canceled === "Y")
      .map((s: any) => ({
        id_sale: s.id_sale,
        sale_number: String(s.sale_number || s.id_sale),
        order_type: mapSaleType(s.id_sale_type),
        sale_time: saleTime(s.created_at),
        total_amount: s.total_amount || 0,
        desc_sale: s.desc_sale || null,
        customer_name: s.customer?.name || null,
      }))
      .sort((a: any, b: any) => (a.sale_time || "").localeCompare(b.sale_time || ""));

    const canceled_item_sales = inScope
      .filter((s: any) => s.canceled !== "Y" && (s.count_canceled_items || 0) > 0)
      .map((s: any) => ({
        id_sale: s.id_sale,
        sale_number: String(s.sale_number || s.id_sale),
        order_type: mapSaleType(s.id_sale_type),
        sale_time: saleTime(s.created_at),
        total_amount: s.total_amount || 0,
        desc_sale: s.desc_sale || null,
        customer_name: s.customer?.name || null,
        canceled_items_count: s.count_canceled_items,
      }))
      .sort((a: any, b: any) => (a.sale_time || "").localeCompare(b.sale_time || ""));

    return new Response(JSON.stringify({
      closing_date,
      scope,
      canceled_sales,
      canceled_item_sales,
      counts: {
        canceled_sales: canceled_sales.length,
        canceled_item_sales: canceled_item_sales.length,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg || "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
