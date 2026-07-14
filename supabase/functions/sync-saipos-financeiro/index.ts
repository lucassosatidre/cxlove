import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getToken(): string | null {
  let t = Deno.env.get("SAIPOS_API_TOKEN") || Deno.env.get("SAIPOS_API_KEY");
  if (t?.startsWith("Bearer ")) t = t.slice(7);
  return t || null;
}

async function fetchWithRetry(url: string, token: string, tentativas = 4): Promise<Response> {
  const delays = [2000, 5000, 12000, 25000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tentativas; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        const txt = await res.text().catch(() => "");
        console.warn(`[fin-retry] ${attempt + 1}/${tentativas} status=${res.status} ${txt.slice(0, 150)}`);
        if (attempt < tentativas - 1) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return new Response(txt, { status: res.status });
      }
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`[fin-retry] ${attempt + 1}/${tentativas} threw:`, err instanceof Error ? err.message : String(err));
      if (attempt < tentativas - 1) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}

function parseDateOnly(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date().toISOString();
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const saiposToken = getToken();
    if (!saiposToken) {
      return new Response(JSON.stringify({ error: "SAIPOS_API_TOKEN não configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: presence of Bearer already required above. For user calls we validate JWT;
    // for internal cron (anon/service role from pg_net) we accept any valid-shaped token.
    const token = authHeader.replace("Bearer ", "");
    const isInternal =
      token === supabaseServiceKey ||
      token === supabaseAnonKey ||
      // JWT anon key from cloud-project-info (starts with eyJ and is long)
      (token.startsWith("eyJ") && token.length > 100 && token.split(".").length === 3);
    if (!isInternal) {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userRes, error: userErr } = await supabaseUser.auth.getUser();
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Optional body: { days_back, days_forward }
    let daysBack = 35, daysForward = 65;
    try {
      const body = await req.json().catch(() => null);
      if (body?.days_back != null) daysBack = Number(body.days_back);
      if (body?.days_forward != null) daysForward = Number(body.days_forward);
    } catch { /* no body */ }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = addDays(today, -daysBack);
    const end = addDays(today, daysForward);

    // Chunks de 14 dias
    const chunkSize = 14;
    const all: any[] = [];
    let chunkStart = new Date(start);
    while (chunkStart <= end) {
      const chunkEnd = new Date(Math.min(addDays(chunkStart, chunkSize - 1).getTime(), end.getTime()));
      const startStr = toIsoDate(chunkStart);
      const endStr = toIsoDate(chunkEnd);

      let offset = 0;
      const limit = 1000;
      while (true) {
        const params = new URLSearchParams({
          p_date_column_filter: "date",
          p_filter_date_start: `${startStr}T00:00:00`,
          p_filter_date_end: `${endStr}T23:59:59`,
          p_limit: String(limit),
          p_offset: String(offset),
        });
        const url = `https://data.saipos.io/v1/search_financial_transactions?${params.toString()}`;
        const res = await fetchWithRetry(url, saiposToken);
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error(`[fin] Saipos ${res.status} ${startStr}..${endStr}: ${errText.slice(0, 300)}`);
          await supabaseAdmin.from("sync_logs").insert({
            sync_type: "saipos_financeiro",
            status: "error",
            details: `Saipos ${res.status}: ${errText.slice(0, 400)}`,
            executed_at: startedAt,
          });
          return new Response(
            JSON.stringify({ error: `Erro Saipos: ${res.status}`, details: errText.slice(0, 500) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const data = await res.json().catch(() => null);
        const rows = Array.isArray(data) ? data : (data?.data || data?.results || []);
        all.push(...rows);
        if (rows.length < limit) break;
        offset += limit;
        await new Promise((r) => setTimeout(r, 350));
      }

      chunkStart = addDays(chunkEnd, 1);
      await new Promise((r) => setTimeout(r, 350));
    }

    // Dedup por id_store_fin_transaction (mesma tx pode aparecer em 2 chunks se cair na borda)
    const byId = new Map<number, any>();
    for (const tx of all) {
      const id = tx?.id_store_fin_transaction;
      if (id != null) byId.set(Number(id), tx);
    }
    const unique = Array.from(byId.values());

    // Upsert em lotes
    const now = new Date().toISOString();
    const batchSize = 500;
    let upserted = 0;
    for (let i = 0; i < unique.length; i += batchSize) {
      const slice = unique.slice(i, i + batchSize);
      const mapped = slice.map((t: any) => ({
        id_store_fin_transaction: Number(t.id_store_fin_transaction),
        id_store: t.id_store != null ? Number(t.id_store) : null,
        date: parseDateOnly(t.date),
        issuance_date: parseDateOnly(t.issuance_date),
        payment_date: parseDateOnly(t.payment_date),
        paid: t.paid ?? null,
        conciliated: t.conciliated ?? null,
        amount: t.amount != null ? Number(t.amount) : null,
        desc_store_fin_transaction: t.desc_store_fin_transaction ?? null,
        desc_store_category_financial: t.desc_store_category_financial ?? null,
        desc_store_payment_method: t.desc_store_payment_method ?? null,
        desc_store_bank_account: t.desc_store_bank_account ?? null,
        provider_trade_name: t.provider_trade_name ?? null,
        children: Array.isArray(t.children) ? t.children : null,
        raw: t,
        synced_at: now,
      }));
      const { error } = await supabaseAdmin
        .from("saipos_fin_transactions")
        .upsert(mapped, { onConflict: "id_store_fin_transaction" });
      if (error) {
        console.error("[fin] upsert error:", error.message);
        await supabaseAdmin.from("sync_logs").insert({
          sync_type: "saipos_financeiro",
          status: "error",
          details: `Upsert: ${error.message}`,
          executed_at: startedAt,
        });
        return new Response(
          JSON.stringify({ error: `Erro upsert: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      upserted += mapped.length;
    }

    // Deletar órfãos: registros na janela que não vieram nesta rodada (foram apagados no Saipos)
    const startStr = toIsoDate(start);
    const endStr = toIsoDate(end);
    const seenIds = Array.from(byId.keys());
    let deleted = 0;
    {
      // Buscar IDs existentes na janela
      const existingIds: number[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabaseAdmin
          .from("saipos_fin_transactions")
          .select("id_store_fin_transaction")
          .gte("date", startStr)
          .lte("date", endStr)
          .range(from, from + pageSize - 1);
        if (error) {
          console.error("[fin] select existing error:", error.message);
          break;
        }
        if (!data || data.length === 0) break;
        for (const r of data) existingIds.push(Number(r.id_store_fin_transaction));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      const seenSet = new Set(seenIds);
      const toDelete = existingIds.filter((id) => !seenSet.has(id));
      if (toDelete.length > 0) {
        const delBatch = 500;
        for (let i = 0; i < toDelete.length; i += delBatch) {
          const slice = toDelete.slice(i, i + delBatch);
          const { error } = await supabaseAdmin
            .from("saipos_fin_transactions")
            .delete()
            .in("id_store_fin_transaction", slice);
          if (error) {
            console.error("[fin] delete error:", error.message);
            break;
          }
          deleted += slice.length;
        }
      }
    }

    await supabaseAdmin.from("sync_logs").insert({
      sync_type: "saipos_financeiro",
      status: "success",
      details: `${upserted} lançamentos, ${deleted} deletados (${startStr}..${endStr})`,
      executed_at: startedAt,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        total_fetched: all.length,
        total_upserted: upserted,
        total_deleted: deleted,
        range: { start: startStr, end: endStr },
        synced_at: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fin] fatal:", msg);
    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await supabaseAdmin.from("sync_logs").insert({
        sync_type: "saipos_financeiro",
        status: "error",
        details: msg.slice(0, 500),
        executed_at: startedAt,
      });
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
