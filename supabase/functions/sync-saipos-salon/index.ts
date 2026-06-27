import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function mapSaleType(id_sale_type: number): string {
  switch (id_sale_type) {
    case 3: return "Salão";
    case 2: return "Retirada";
    case 4: return "Ficha";
    default: return String(id_sale_type);
  }
}

// Helper: fetch the Saipos API with exponential-backoff retries (5xx/429/network).
async function fetchSaiposWithRetry(url: string, token: string, tentativas = 4): Promise<Response> {
  const delays = [1500, 4000, 9000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tentativas; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        const txt = await res.text().catch(() => "");
        console.warn(`[saipos-retry] attempt ${attempt + 1}/${tentativas} status=${res.status} body=${txt.slice(0, 200)}`);
        if (attempt < tentativas - 1) {
          await new Promise((r) => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]));
          continue;
        }
        return new Response(txt, { status: res.status });
      }
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`[saipos-retry] attempt ${attempt + 1}/${tentativas} threw:`, err instanceof Error ? err.message : String(err));
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
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

    // Validate caller: accept either a user JWT or the service role key
    // (service role key is used by auto-sync-saipos cron for internal calls).
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    if (token === supabaseServiceKey) {
      const { data: adminRole } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();
      if (!adminRole?.user_id) {
        return new Response(
          JSON.stringify({ error: "Nenhum admin configurado para chamada interna" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = adminRole.user_id;
    } else {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const userResult = await supabaseUser.auth.getUser();
      const callerUser = userResult?.data?.user ?? null;
      const userErr = userResult?.error ?? null;
      if (userErr || !callerUser) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = callerUser.id;
    }

    const body = await req.json();
    const { closing_date, salon_closing_id } = body;
    if (!closing_date || !salon_closing_id) {
      return new Response(
        JSON.stringify({ error: "closing_date e salon_closing_id são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ====== PAYMENT BACKFILL MODE (preenche pagamento em branco, NÃO apaga/insere pedido) ======
    // Usado pela rotina das 6h em dias JÁ CONCLUÍDOS: relê o Saipos e preenche
    // payment_method apenas onde está vazio (mesa importada antes de a comanda ser paga).
    // Nunca insere/apaga pedido, nunca cria import, nunca sobrescreve pagamento já preenchido.
    if (body.payment_backfill === true) {
      const bfSales: any[] = [];
      let bfOffset = 0;
      const bfLimit = 1000;
      try {
        while (true) {
          const params = new URLSearchParams({
            p_date_column_filter: "shift_date",
            p_filter_date_start: `${closing_date}T00:00:00`,
            p_filter_date_end: `${closing_date}T23:59:59`,
            p_limit: String(bfLimit),
            p_offset: String(bfOffset),
          });
          const apiRes = await fetchSaiposWithRetry(
            `https://data.saipos.io/v1/search_sales?${params.toString()}`,
            saiposToken!,
          );
          if (!apiRes.ok) {
            const errText = await apiRes.text();
            return new Response(
              JSON.stringify({ error: `Erro na API Saipos (backfill): ${apiRes.status}`, details: errText, backfilled: 0 }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const data = await apiRes.json().catch(() => null);
          const sales = Array.isArray(data) ? data : (data?.data || data?.results || []);
          const filtered = sales.filter(
            (s: any) => [2, 3, 4].includes(s.id_sale_type) && s.canceled !== "Y" && (s.total_amount || 0) !== 0
          );
          bfSales.push(...filtered);
          if (sales.length < bfLimit) break;
          bfOffset += bfLimit;
        }
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        return new Response(
          JSON.stringify({ error: `Saipos indisponível (backfill): ${msg}`, backfilled: 0 }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existingBf } = await supabaseAdmin
        .from("salon_orders")
        .select("id, sale_number, saipos_sale_id, payment_method")
        .eq("salon_closing_id", salon_closing_id);

      const bfBySaiposId = new Map<string, any>();
      const bfBySaleNumber = new Map<string, any>();
      for (const o of (existingBf || [])) {
        if (o.saipos_sale_id) bfBySaiposId.set(String(o.saipos_sale_id), o);
        if (o.sale_number) bfBySaleNumber.set(String(o.sale_number), o);
      }

      let backfilled = 0;
      for (const sale of bfSales) {
        const payments = sale.payments || [];
        if (payments.length === 0) continue;
        let order: any = null;
        if (sale.id_sale) order = bfBySaiposId.get(String(sale.id_sale)) || null;
        if (!order && sale.sale_number) order = bfBySaleNumber.get(String(sale.sale_number)) || null;
        if (!order) continue;
        if (order.payment_method && String(order.payment_method).trim() !== "") continue;

        const paymentMethodStr = payments.map((p: any) => p.desc_store_payment_type || "").join(", ");
        await supabaseAdmin
          .from("salon_orders")
          .update({ payment_method: paymentMethodStr })
          .eq("id", order.id);

        if (payments.length > 1) {
          await supabaseAdmin.from("salon_order_payments").delete().eq("salon_order_id", order.id);
          await supabaseAdmin.from("salon_order_payments").insert(
            payments.map((p: any) => ({
              salon_order_id: order.id,
              payment_method: p.desc_store_payment_type || "",
              amount: p.payment_amount || 0,
            }))
          );
        }
        backfilled++;
      }

      return new Response(
        JSON.stringify({ payment_backfill: true, total_sales: bfSales.length, backfilled }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // ====== FIM PAYMENT BACKFILL MODE ======

    // ====== REPLACE MODE (reimportação limpa "safe") ======
    // Só apaga os antigos DEPOIS de inserir todos os novos com sucesso.
    if (body.replace === true) {
      const replaceSales: any[] = [];
      let rOffset = 0;
      const rLimit = 1000;
      try {
        while (true) {
          const params = new URLSearchParams({
            p_date_column_filter: "shift_date",
            p_filter_date_start: `${closing_date}T00:00:00`,
            p_filter_date_end: `${closing_date}T23:59:59`,
            p_limit: String(rLimit),
            p_offset: String(rOffset),
          });
          const apiRes = await fetchSaiposWithRetry(
            `https://data.saipos.io/v1/search_sales?${params.toString()}`,
            saiposToken!,
          );
          if (!apiRes.ok) {
            const errText = await apiRes.text();
            console.error("[replace-salon] Saipos API falhou após retries:", apiRes.status, errText);
            return new Response(
              JSON.stringify({ error: `Erro na API Saipos (replace): ${apiRes.status}`, details: errText, replaced: false }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const data = await apiRes.json().catch(() => null);
          const sales = Array.isArray(data) ? data : (data?.data || data?.results || []);
          const filtered = sales.filter(
            (s: any) => [2, 3, 4].includes(s.id_sale_type) && s.canceled !== "Y" && (s.total_amount || 0) !== 0
          );
          replaceSales.push(...filtered);
          if (sales.length < rLimit) break;
          rOffset += rLimit;
        }
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error("[replace-salon] Erro definitivo ao buscar Saipos:", msg);
        return new Response(
          JSON.stringify({ error: `Saipos indisponível após retries: ${msg}`, replaced: false }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cria novo import ANTES de inserir
      const { data: newImport, error: newImpErr } = await supabaseAdmin
        .from("salon_imports")
        .insert({
          user_id: userId,
          file_name: `saipos-salon-api-replace-${closing_date}`,
          total_rows: replaceSales.length,
          new_rows: replaceSales.length,
          duplicate_rows: 0,
          skipped_cancelled: 0,
          salon_closing_id,
          status: "completed",
        })
        .select("id")
        .single();

      if (newImpErr || !newImport) {
        return new Response(
          JSON.stringify({ error: `Erro ao criar import (replace): ${newImpErr?.message}`, replaced: false }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insere TODOS os pedidos (sem dedup)
      if (replaceSales.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < replaceSales.length; i += batchSize) {
          const slice = replaceSales.slice(i, i + batchSize);
          const batch = slice.map((sale: any) => {
            const payments = sale.payments || [];
            const paymentMethodStr = payments.length > 0
              ? payments.map((p: any) => p.desc_store_payment_type || "").join(", ")
              : "";
            let saleTime: string | null = null;
            if (sale.created_at) {
              try {
                const dt = new Date(sale.created_at);
                saleTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
              } catch { saleTime = null; }
            }
            const ticket = sale.ticket || null;
            let tableNumber: string | null = null;
            if (sale.id_sale_type === 3 && sale.desc_sale) tableNumber = String(sale.desc_sale);
            else if (sale.id_sale_type === 2 && sale.sale_number) tableNumber = String(sale.sale_number);
            else if (sale.id_sale_type === 4 && ticket?.number) tableNumber = String(ticket.number);
            return {
              salon_import_id: newImport.id,
              salon_closing_id,
              order_type: mapSaleType(sale.id_sale_type),
              sale_date: sale.shift_date || closing_date,
              sale_time: saleTime,
              payment_method: paymentMethodStr,
              total_amount: sale.total_amount || 0,
              discount_amount: sale.total_discount || 0,
              is_confirmed: false,
              sale_number: sale.sale_number ? String(sale.sale_number) : null,
              saipos_sale_id: sale.id_sale ? String(sale.id_sale) : null,
              table_number: tableNumber,
              card_number: null,
              ticket_number: (sale.id_sale_type === 4 && ticket?.number) ? String(ticket.number) : null,
              customers_count: sale.table_order?.customers_on_table ?? null,
              service_charge_amount: sale.table_order?.total_service_charge_amount || 0,
            };
          });

          const { error: insErr } = await supabaseAdmin.from("salon_orders").insert(batch);
          if (insErr) {
            console.error("[replace-salon] insert error — preservando dados antigos:", insErr.message);
            await supabaseAdmin.from("salon_imports").delete().eq("id", newImport.id);
            return new Response(
              JSON.stringify({ error: `Erro ao inserir (replace): ${insErr.message}`, replaced: false }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Breakdowns multi-pagamento
          for (let j = 0; j < batch.length; j++) {
            const sale = slice[j];
            const payments = sale.payments || [];
            if (payments.length > 1) {
              const { data: orderData } = await supabaseAdmin
                .from("salon_orders")
                .select("id")
                .eq("salon_import_id", newImport.id)
                .eq("saipos_sale_id", batch[j].saipos_sale_id || "")
                .maybeSingle();
              if (orderData) {
                const breakdowns = payments.map((p: any) => ({
                  salon_order_id: orderData.id,
                  payment_method: p.desc_store_payment_type || "",
                  amount: p.payment_amount || 0,
                }));
                await supabaseAdmin.from("salon_order_payments").insert(breakdowns);
              }
            }
          }
        }
      }

      // Só agora remove os ANTIGOS:
      // (a) desvincular maquininhas do salão
      await supabaseAdmin
        .from("salon_card_transactions")
        .update({ matched_order_id: null, match_type: null, match_confidence: null })
        .eq("salon_closing_id", salon_closing_id)
        .not("matched_order_id", "is", null);

      // (b) apagar imports antigos (cascade remove salon_orders após migration)
      const { data: oldImports } = await supabaseAdmin
        .from("salon_imports")
        .select("id")
        .eq("salon_closing_id", salon_closing_id)
        .neq("id", newImport.id);
      const deletedOld = oldImports?.length || 0;
      if (deletedOld > 0) {
        await supabaseAdmin
          .from("salon_imports")
          .delete()
          .eq("salon_closing_id", salon_closing_id)
          .neq("id", newImport.id);
      }

      return new Response(
        JSON.stringify({
          replaced: true,
          total: replaceSales.length,
          new_orders: replaceSales.length,
          deleted_old_imports: deletedOld,
          import_id: newImport.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // ====== FIM REPLACE MODE ======

    // Fetch all pages from Saipos
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

      const apiRes = await fetchSaiposWithRetry(
        `https://data.saipos.io/v1/search_sales?${params.toString()}`,
        saiposToken!,
      );

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error("Saipos API error:", apiRes.status, errText);
        return new Response(
          JSON.stringify({ error: `Erro na API Saipos: ${apiRes.status} - ${errText}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await apiRes.json();
      const sales = Array.isArray(data) ? data : data.data || data.results || [];

      // Filter: salon types (2=Retirada, 3=Salão, 4=Ficha), not canceled, and non-zero amount
      const filtered = sales.filter(
        (s: any) => [2, 3, 4].includes(s.id_sale_type) && s.canceled !== "Y" && (s.total_amount || 0) !== 0
      );
      allSales.push(...filtered);

      if (sales.length < limit) break;
      offset += limit;
    }

    console.log(`[sync-saipos-salon] Total salon sales fetched: ${allSales.length}`);

    if (allSales.length === 0) {
      await supabaseAdmin.from("salon_imports").insert({
        user_id: userId,
        file_name: `saipos-salon-api-${closing_date}`,
        total_rows: 0,
        new_rows: 0,
        duplicate_rows: 0,
        skipped_cancelled: 0,
        salon_closing_id,
        status: "completed",
      });

      return new Response(
        JSON.stringify({ total: 0, new_orders: 0, duplicates: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check existing orders for dedup - now using saipos_sale_id as primary dedup key
    const { data: existingOrders } = await supabaseAdmin
      .from("salon_orders")
      .select("id, sale_number, saipos_sale_id, table_number, card_number, ticket_number, customers_count, service_charge_amount, total_amount, order_type, payment_method")
      .eq("salon_closing_id", salon_closing_id);

    // Build dedup maps
    const existingBySaiposId = new Map<string, any>();
    const existingBySaleNumber = new Map<string, any>();
    // Fallback map: key = "order_type|total_amount|payment_method_sorted"
    const existingByFingerprint = new Map<string, any[]>();
    for (const o of (existingOrders || [])) {
      if (o.saipos_sale_id) existingBySaiposId.set(String(o.saipos_sale_id), o);
      if (o.sale_number) existingBySaleNumber.set(String(o.sale_number), o);
      // Build fingerprint for fallback dedup (Excel imports without saipos_sale_id)
      const fp = `${o.order_type}|${o.total_amount}|${(o.payment_method || '').split(',').map((s: string) => s.trim()).sort().join(',')}`;
      if (!existingByFingerprint.has(fp)) existingByFingerprint.set(fp, []);
      existingByFingerprint.get(fp)!.push(o);
    }

    // Track which fingerprint entries have been consumed (to handle multiple orders with same fingerprint)
    const consumedFingerprints = new Set<string>();

    // Find existing order for a sale using the best dedup key
    function findExisting(sale: any): any | null {
      // Primary: saipos_sale_id (id_sale from API)
      if (sale.id_sale) {
        const found = existingBySaiposId.get(String(sale.id_sale));
        if (found) return found;
      }
      // Fallback: sale_number (works for Retirada)
      if (sale.sale_number) {
        const found = existingBySaleNumber.get(String(sale.sale_number));
        if (found) return found;
      }
      // Fallback: fingerprint match (for Excel-imported orders without saipos_sale_id/sale_number)
      const saleType = mapSaleType(sale.id_sale_type);
      const paymentMethods = (sale.payments || []).map((p: any) => p.desc_store_payment_type || "").sort().join(",");
      const fp = `${saleType}|${sale.total_amount || 0}|${paymentMethods}`;
      const candidates = existingByFingerprint.get(fp);
      if (candidates) {
        for (const c of candidates) {
          const cKey = `${c.id}`;
          if (!consumedFingerprints.has(cKey)) {
            consumedFingerprints.add(cKey);
            return c;
          }
        }
      }
      return null;
    }

    // Backfill null fields on existing orders
    let backfillCount = 0;
    for (const sale of allSales) {
      const existing = findExisting(sale);
      if (!existing) continue;

      const updates: Record<string, any> = {};
      const ticket = sale.ticket || null;

      // Backfill table_number with desc_sale for Salão
      if (!existing.table_number && sale.id_sale_type === 3 && sale.desc_sale) {
        updates.table_number = String(sale.desc_sale);
      }
      // Backfill ticket_number for Ficha
      if (!existing.ticket_number && sale.id_sale_type === 4 && ticket?.number) {
        updates.ticket_number = String(ticket.number);
      }
      if (existing.customers_count === null && sale.table_order?.customers_on_table != null) {
        updates.customers_count = sale.table_order.customers_on_table;
      }
      if ((existing.service_charge_amount === null || existing.service_charge_amount === 0) && sale.table_order?.total_service_charge_amount) {
        updates.service_charge_amount = sale.table_order.total_service_charge_amount;
      }
      // Backfill saipos_sale_id if missing
      if (!existing.saipos_sale_id && sale.id_sale) {
        updates.saipos_sale_id = String(sale.id_sale);
      }

      // Preenche a forma de pagamento quando o pedido foi importado antes de a mesa pagar
      const salePaymentsBf = sale.payments || [];
      if ((!existing.payment_method || String(existing.payment_method).trim() === "") && salePaymentsBf.length > 0) {
        updates.payment_method = salePaymentsBf.map((p: any) => p.desc_store_payment_type || "").join(", ");
        if (salePaymentsBf.length > 1) {
          await supabaseAdmin.from("salon_order_payments").delete().eq("salon_order_id", existing.id);
          await supabaseAdmin.from("salon_order_payments").insert(
            salePaymentsBf.map((p: any) => ({ salon_order_id: existing.id, payment_method: p.desc_store_payment_type || "", amount: p.payment_amount || 0 }))
          );
        }
      }

      if (Object.keys(updates).length > 0) {
        await supabaseAdmin.from("salon_orders").update(updates).eq("id", existing.id);
        backfillCount++;
      }
    }

    // Filter new sales - a sale is new if no existing order matches
    const newSales = allSales.filter((s) => !findExisting(s));
    const duplicateCount = allSales.length - newSales.length;

    // Create import record
    const { data: importRecord, error: importErr } = await supabaseAdmin
      .from("salon_imports")
      .insert({
        user_id: userId,
        file_name: `saipos-salon-api-${closing_date}`,
        total_rows: allSales.length,
        new_rows: newSales.length,
        duplicate_rows: duplicateCount,
        skipped_cancelled: 0,
        salon_closing_id,
        status: "completed",
      })
      .select("id")
      .single();

    if (importErr || !importRecord) {
      return new Response(
        JSON.stringify({ error: "Erro ao criar registro de importação" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map and insert new orders in batches
    if (newSales.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < newSales.length; i += batchSize) {
        const batch = newSales.slice(i, i + batchSize).map((sale: any) => {
          const payments = sale.payments || [];
          const paymentMethodStr = payments.length > 0
            ? payments.map((p: any) => p.desc_store_payment_type || "").join(", ")
            : "";

          // Parse time from created_at
          let saleTime: string | null = null;
          if (sale.created_at) {
            try {
              const dt = new Date(sale.created_at);
              saleTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
            } catch {
              saleTime = null;
            }
          }

          const ticket = sale.ticket || null;

          // table_number mapping:
          // Salão: desc_sale (e.g. "33.01", "Taila Verruck")
          // Retirada: sale_number (shown as "Pedido #N")
          // Ficha: ticket.number (shown as "Ficha N")
          let tableNumber: string | null = null;
          if (sale.id_sale_type === 3 && sale.desc_sale) {
            tableNumber = String(sale.desc_sale);
          } else if (sale.id_sale_type === 2 && sale.sale_number) {
            tableNumber = String(sale.sale_number);
          } else if (sale.id_sale_type === 4 && ticket?.number) {
            tableNumber = String(ticket.number);
          }

          return {
            salon_import_id: importRecord.id,
            salon_closing_id,
            order_type: mapSaleType(sale.id_sale_type),
            sale_date: sale.shift_date || closing_date,
            sale_time: saleTime,
            payment_method: paymentMethodStr,
            total_amount: sale.total_amount || 0,
            discount_amount: sale.total_discount || 0,
            is_confirmed: false,
            sale_number: sale.sale_number ? String(sale.sale_number) : null,
            saipos_sale_id: sale.id_sale ? String(sale.id_sale) : null,
            table_number: tableNumber,
            card_number: null,
            ticket_number: (sale.id_sale_type === 4 && ticket?.number) ? String(ticket.number) : null,
            customers_count: sale.table_order?.customers_on_table ?? null,
            service_charge_amount: sale.table_order?.total_service_charge_amount || 0,
          };
        });

        const { error: insertErr } = await supabaseAdmin
          .from("salon_orders")
          .insert(batch);

        if (insertErr) {
          console.error("Insert error:", insertErr);
          return new Response(
            JSON.stringify({ error: `Erro ao inserir pedidos: ${insertErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Handle multi-payment breakdowns
        for (let j = 0; j < batch.length; j++) {
          const sale = newSales[i + j];
          const payments = sale.payments || [];
          if (payments.length > 1) {
            const { data: orderData } = await supabaseAdmin
              .from("salon_orders")
              .select("id")
              .eq("salon_import_id", importRecord.id)
              .eq("saipos_sale_id", batch[j].saipos_sale_id || "")
              .maybeSingle();

            if (orderData) {
              const breakdowns = payments.map((p: any) => ({
                salon_order_id: orderData.id,
                payment_method: p.desc_store_payment_type || "",
                amount: p.payment_amount || 0,
              }));

              await supabaseAdmin
                .from("salon_order_payments")
                .insert(breakdowns);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        total: allSales.length,
        new_orders: newSales.length,
        duplicates: duplicateCount,
        backfilled: backfillCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-saipos-salon error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
