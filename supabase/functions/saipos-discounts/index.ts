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

// Primeira linha "útil" das observações (ignora as linhas automáticas do iFood/Brendi)
function firstUsefulNote(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const lines = String(notes).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (/^Desconto do (Restaurante|Ifood)|^CASHBACK|^Bandeira|^Pago Online|^Entrega para|^Entrega feita|^Tel/i.test(l)) continue;
    return l.slice(0, 120);
  }
  return null;
}

async function fetchSaiposWithRetry(url: string, token: string, tentativas = 6): Promise<Response> {
  const delays = [1500, 3000, 6000, 9000, 12000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tentativas; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return res;
      const transient = res.status >= 500 || res.status === 429 || res.status === 403 || res.status === 408;
      if (transient) {
        if (attempt < tentativas - 1) {
          const base = delays[Math.min(attempt, delays.length - 1)];
          await new Promise((r) => setTimeout(r, base + Math.random() * 1000));
          continue;
        }
        return res;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < tentativas - 1) {
        const base = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((r) => setTimeout(r, base + Math.random() * 1000));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchAllPaged(endpoint: string, closing_date: string, token: string): Promise<any[]> {
  const out: any[] = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      p_date_column_filter: "shift_date",
      p_filter_date_start: `${closing_date}T00:00:00`,
      p_filter_date_end: `${closing_date}T23:59:59`,
      p_limit: String(limit),
      p_offset: String(offset),
    });
    const res = await fetchSaiposWithRetry(
      `https://data.saipos.io/v1/${endpoint}?${params.toString()}`,
      token
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`API Saipos ${endpoint}: ${res.status} - ${errText}`);
    }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.data || data.results || [];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    let sales: any[];
    try {
      sales = await fetchAllPaged("search_sales", closing_date, saiposToken);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const discounts: any[] = [];
    for (const sale of sales) {
      if (!allowedTypes.includes(sale.id_sale_type)) continue;
      if (sale.canceled === "Y") continue;

      // Descontos automáticos de integração (iFood, Brendi, etc.) NÃO entram:
      // são promos externas pequenas, não descontos que o atendente aplicou na comanda.
      const partner = sale.partner_sale?.desc_partner_sale || null;
      if (partner) continue;

      const discount = Number(sale.total_discount) || 0;
      const coupon = sale.discount_coupon?.coupon || null;
      if (discount <= 0 && !coupon) continue;

      const total = Number(sale.total_amount) || 0;
      const items = Number(sale.total_amount_items) || 0;
      const base = items > 0 ? items : total + discount;
      const pct = base > 0 ? Math.round((discount / base) * 1000) / 10 : 0;
      const reason = (sale.discount_reason && String(sale.discount_reason).trim()) || null;
      const note = firstUsefulNote(sale.notes);
      // "Zerada" = cliente não pagou nada OU os itens foram 100% descontados (o troco vira só a taxa de entrega)
      const is_zeroed = total <= 0.01 || (items > 0 && discount >= items - 0.01);

      discounts.push({
        id_sale: sale.id_sale,
        sale_number: String(sale.sale_number || sale.id_sale),
        order_type: mapSaleType(sale.id_sale_type),
        sale_time: saleTime(sale.created_at),
        total_amount: total,
        items_amount: items,
        discount_amount: discount,
        discount_pct: pct,
        coupon,
        coupon_discount: sale.discount_coupon?.discount != null ? Number(sale.discount_coupon.discount) : null,
        reason,
        note,
        customer_name: sale.customer?.name || null,
        is_zeroed,
      });
    }

    // Mais crítico primeiro: zeradas, depois maior desconto
    discounts.sort((a, b) => {
      if (a.is_zeroed !== b.is_zeroed) return a.is_zeroed ? -1 : 1;
      return b.discount_amount - a.discount_amount;
    });

    const payload = {
      closing_date,
      scope,
      discounts,
      counts: {
        total: discounts.length,
        zeroed: discounts.filter((d) => d.is_zeroed).length,
        sum_discount: Math.round(discounts.reduce((s, d) => s + d.discount_amount, 0) * 100) / 100,
      },
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg || "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
