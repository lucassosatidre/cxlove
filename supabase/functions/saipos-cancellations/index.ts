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

    // search_sales é OBRIGATÓRIO
    let sales: any[];
    try {
      sales = await fetchAllPaged("search_sales", closing_date, saiposToken);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // histories e sales_items são independentes/tolerantes
    const warnings: string[] = [];
    let histories: any[] = [];
    let salesItems: any[] = [];

    const [histRes, itemsRes] = await Promise.allSettled([
      fetchAllPaged("sales_status_histories", closing_date, saiposToken),
      fetchAllPaged("sales_items", closing_date, saiposToken),
    ]);
    if (histRes.status === "fulfilled") {
      histories = histRes.value;
    } else {
      console.warn("[saipos-cancellations] histories falhou:", histRes.reason);
      warnings.push("Não consegui carregar as vendas canceladas agora (Saipos instável).");
    }
    if (itemsRes.status === "fulfilled") {
      salesItems = itemsRes.value;
    } else {
      console.warn("[saipos-cancellations] sales_items falhou:", itemsRes.reason);
      warnings.push("Não consegui carregar os itens cancelados/transferidos agora (Saipos instável).");
    }

    // saleMeta by id_sale
    const saleMeta: Record<string, any> = {};
    for (const s of sales) {
      saleMeta[String(s.id_sale)] = {
        sale_number: String(s.sale_number || s.id_sale),
        desc_sale: s.desc_sale || null,
        customer_name: s.customer?.name || null,
        total_amount: s.total_amount || 0,
        sale_time: saleTime(s.created_at),
        id_sale_type: s.id_sale_type,
      };
    }

    // userMap from histories
    const userMap: Record<string, string> = {};
    const collectUser = (u: any) => {
      if (u && u.id_user && u.full_name) userMap[String(u.id_user)] = u.full_name;
    };
    for (const rec of histories) {
      for (const h of (rec.histories || [])) {
        collectUser(h.user);
        collectUser(h.authorized_by);
      }
    }

    // canceled_sales
    const canceled_sales: any[] = [];
    for (const rec of histories) {
      const meta = saleMeta[String(rec.id_sale)];
      if (!meta || !allowedTypes.includes(meta.id_sale_type)) continue;
      for (const h of (rec.histories || [])) {
        if (!h.desc_store_sale_status || !/cancel/i.test(h.desc_store_sale_status)) continue;
        canceled_sales.push({
          id_sale: rec.id_sale,
          sale_number: meta.sale_number,
          order_type: mapSaleType(meta.id_sale_type),
          sale_time: meta.sale_time,
          total_amount: meta.total_amount,
          desc_sale: meta.desc_sale,
          customer_name: meta.customer_name,
          reason: h.desc_cancellation_reason || null,
          done_by: h.user?.full_name || null,
          authorized_by: h.authorized_by?.full_name || null,
        });
      }
    }

    // canceled_items + transferred_items
    const canceled_items: any[] = [];
    const transferred_items: any[] = [];
    for (const rec of salesItems) {
      const meta = saleMeta[String(rec.id_sale)];
      if (!meta || !allowedTypes.includes(meta.id_sale_type)) continue;
      for (const it of (rec.items || [])) {
        if (it.deleted !== "Y") continue;
        const to = Number(it.id_sale_to) || 0;
        if (to === 0) {
          canceled_items.push({
            id_sale: rec.id_sale,
            sale_number: meta.sale_number,
            order_type: mapSaleType(meta.id_sale_type),
            sale_time: meta.sale_time,
            desc_sale: meta.desc_sale,
            customer_name: meta.customer_name,
            desc_sale_item: it.desc_sale_item,
            removed_by: userMap[String(it.deleted_by)] || (it.deleted_by ? `cód. ${it.deleted_by}` : null),
            authorized_by: userMap[String(it.delete_authorized_by)] || (it.delete_authorized_by ? `cód. ${it.delete_authorized_by}` : null),
            waiter_id: it.id_store_waiter || null,
          });
        } else {
          const toMeta = saleMeta[String(to)];
          const from_ref = meta.desc_sale || `#${meta.sale_number}`;
          const to_ref = toMeta ? (toMeta.desc_sale || `#${toMeta.sale_number}`) : String(to);
          transferred_items.push({
            desc_sale_item: it.desc_sale_item,
            from_sale: rec.id_sale,
            from_ref,
            to_sale: to,
            to_ref,
            sale_time: meta.sale_time,
            waiter_id: it.id_store_waiter || null,
          });
        }
      }
    }

    const byTime = (a: any, b: any) => (a.sale_time || "").localeCompare(b.sale_time || "");
    canceled_sales.sort(byTime);
    canceled_items.sort(byTime);
    transferred_items.sort(byTime);

    const partial = warnings.length > 0;
    const payload: Record<string, unknown> = {
      closing_date,
      scope,
      canceled_sales,
      canceled_items,
      transferred_items,
      counts: {
        canceled_sales: canceled_sales.length,
        canceled_items: canceled_items.length,
        transferred_items: transferred_items.length,
      },
    };
    if (partial) {
      payload.partial = true;
      payload.warning = warnings.join(" ") + " Aguarde alguns segundos e clique em Atualizar.";
    }

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
