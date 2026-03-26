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

    // Validate caller
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: callerUser }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !callerUser) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = callerUser.id;

    const { closing_date, salon_closing_id } = await req.json();
    if (!closing_date || !salon_closing_id) {
      return new Response(
        JSON.stringify({ error: "closing_date e salon_closing_id são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

      const apiRes = await fetch(
        `https://data.saipos.io/v1/search_sales?${params.toString()}`,
        { headers: { Authorization: `Bearer ${saiposToken}` } }
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

    // Check existing orders for dedup by sale_number
    const { data: existingOrders } = await supabaseAdmin
      .from("salon_orders")
      .select("id, sale_number, table_number, card_number, ticket_number, customers_count, service_charge_amount")
      .eq("salon_closing_id", salon_closing_id)
      .not("sale_number", "is", null);

    const existingMap = new Map<string, any>();
    for (const o of (existingOrders || [])) {
      if (o.sale_number) existingMap.set(String(o.sale_number), o);
    }

    // Backfill null fields on existing orders
    let backfillCount = 0;
    for (const sale of allSales) {
      const saleNum = String(sale.sale_number);
      const existing = existingMap.get(saleNum);
      if (!existing) continue;

      const updates: Record<string, any> = {};
      const tableOrder = sale.table_order || null;
      const ticket = sale.ticket || null;

      if (!existing.table_number && tableOrder?.id_store_table) {
        updates.table_number = String(tableOrder.id_store_table);
      }
      if (!existing.card_number && tableOrder?.id_store_order_card) {
        updates.card_number = String(tableOrder.id_store_order_card);
      }
      if (!existing.ticket_number && ticket?.number) {
        updates.ticket_number = String(ticket.number);
      }
      if (existing.customers_count === null && tableOrder?.customers_on_table != null) {
        updates.customers_count = tableOrder.customers_on_table;
      }
      if ((existing.service_charge_amount === null || existing.service_charge_amount === 0) && tableOrder?.total_service_charge_amount) {
        updates.service_charge_amount = tableOrder.total_service_charge_amount;
      }

      if (Object.keys(updates).length > 0) {
        await supabaseAdmin.from("salon_orders").update(updates).eq("id", existing.id);
        backfillCount++;
      }
    }

    // Filter new sales
    const newSales = allSales.filter(
      (s) => !existingMap.has(String(s.sale_number))
    );
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

          const tableOrder = sale.table_order || null;
          const ticket = sale.ticket || null;

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
            sale_number: String(sale.sale_number),
            table_number: (sale.id_sale_type === 3 && tableOrder?.id_store_table) ? String(tableOrder.id_store_table) : null,
            card_number: (sale.id_sale_type === 3 && tableOrder?.id_store_order_card) ? String(tableOrder.id_store_order_card) : null,
            ticket_number: (sale.id_sale_type === 4 && ticket?.number) ? String(ticket.number) : null,
            customers_count: tableOrder?.customers_on_table ?? null,
            service_charge_amount: tableOrder?.total_service_charge_amount || 0,
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
              .eq("sale_number", batch[j].sale_number)
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
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
