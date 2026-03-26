import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ONLINE_KEYWORDS = ["online", "voucher parceiro", "anotaai"];

function isOnlinePayment(method: string): boolean {
  const lower = method.toLowerCase().trim();
  return ONLINE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isAllOnline(paymentMethod: string): boolean {
  const methods = paymentMethod
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return methods.length >= 1 && methods.every((m) => isOnlinePayment(m));
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
    // Strip "Bearer " prefix if user accidentally included it
    if (saiposToken?.startsWith("Bearer ")) {
      saiposToken = saiposToken.slice(7);
    }
    console.log("Saipos token length:", saiposToken?.length, "starts with:", saiposToken?.substring(0, 10));

    if (!saiposToken) {
      return new Response(
        JSON.stringify({ error: "Token da API Saipos não configurado" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use service role key for all DB operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Validate caller using getUser
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: callerUser }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !callerUser) {
      console.error("Auth error:", userErr?.message);
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = callerUser.id;

    const { closing_date, daily_closing_id } = await req.json();
    if (!closing_date || !daily_closing_id) {
      return new Response(
        JSON.stringify({ error: "closing_date e daily_closing_id são obrigatórios" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // supabaseAdmin already created above with service role key

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
        {
          headers: { Authorization: `Bearer ${saiposToken}` },
        }
      );

      console.log("Saipos API response status:", apiRes.status);
      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error("Saipos API error:", apiRes.status, errText);
        return new Response(
          JSON.stringify({ error: `Erro na API Saipos: ${apiRes.status} - ${errText}` }),
          {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const data = await apiRes.json();
      const sales = Array.isArray(data) ? data : data.data || data.results || [];

      // Filter: delivery only (id_sale_type = 1) and not canceled
      const filtered = sales.filter(
        (s: any) => s.id_sale_type === 1 && s.canceled !== "Y"
      );
      allSales.push(...filtered);

      if (allSales.length > 0 && offset === 0) {
        console.log("====== DIAGNÓSTICO DELIVERY_MAN ======");
        const diagSample = allSales.slice(0, 5);
        diagSample.forEach((s: any, idx: number) => {
          console.log(`Pedido ${idx + 1} - sale_number: ${s.sale_number}`);
          console.log(`  delivery_man:`, JSON.stringify(s.delivery_man));
          console.log(`  delivery:`, JSON.stringify(s.delivery));
          console.log(`  partner_sale:`, JSON.stringify(s.partner_sale));
          console.log(`  partner_delivery:`, JSON.stringify(s.partner_delivery));
        });
        console.log("====== FIM DIAGNÓSTICO ======");
      }

      if (sales.length < limit) break;
      offset += limit;
    }

    // Debug: log first 3 sales for delivery person mapping
    const sample = allSales.slice(0, 3);
    sample.forEach((s: any, i: number) => {
      console.log(`Pedido ${i + 1} - sale_number: ${s.sale_number}`);
      console.log(`  delivery_man:`, JSON.stringify(s.delivery_man));
      console.log(`  partner_sale:`, JSON.stringify(s.partner_sale));
      console.log(`  partner_delivery:`, JSON.stringify(s.partner_delivery));
      console.log(`  id_sale_type:`, s.id_sale_type);
    });

    if (allSales.length === 0) {
      // Create import record with zero
      await supabaseAdmin.from("imports").insert({
        user_id: userId,
        file_name: `saipos-api-${closing_date}`,
        total_rows: 0,
        new_rows: 0,
        duplicate_rows: 0,
        daily_closing_id,
        status: "completed",
      });

      return new Response(
        JSON.stringify({ total: 0, new_orders: 0, duplicates: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check existing orders for dedup
    const { data: existingOrders } = await supabaseAdmin
      .from("imported_orders")
      .select("id, order_number, delivery_person")
      .eq("daily_closing_id", daily_closing_id);

    const existingSet = new Set(
      (existingOrders || []).map((o: any) => String(o.order_number))
    );

    // Resync delivery_person for ALL existing orders
    const existingMap = new Map<string, string>();
    for (const o of (existingOrders || [])) {
      existingMap.set(String(o.order_number), o.id);
    }

    if (existingMap.size > 0) {
      let updatedCount = 0;
      for (const sale of allSales) {
        const orderNum = String(sale.sale_number);
        const orderId = existingMap.get(orderNum);
        if (!orderId) continue;

        let dp: string | null = null;
        if (sale.delivery_man?.delivery_man_name) {
          dp = sale.delivery_man.delivery_man_name;
        } else if (sale.partner_delivery?.partner_order_id) {
          dp = 'Entrega Parceiro';
        }

        if (dp !== null) {
          await supabaseAdmin
            .from("imported_orders")
            .update({ delivery_person: dp })
            .eq("id", orderId);
          updatedCount++;
        }
      }
      if (updatedCount > 0) {
        console.log(`Resync: updated delivery_person for ${updatedCount} existing orders`);
      }
    }

    // Create import record
    const newSales = allSales.filter(
      (s) => !existingSet.has(String(s.sale_number))
    );
    const duplicateCount = allSales.length - newSales.length;

    const { data: importRecord, error: importErr } = await supabaseAdmin
      .from("imports")
      .insert({
        user_id: userId,
        file_name: `saipos-api-${closing_date}`,
        total_rows: allSales.length,
        new_rows: newSales.length,
        duplicate_rows: duplicateCount,
        daily_closing_id,
        status: "completed",
      })
      .select("id")
      .single();

    if (importErr || !importRecord) {
      return new Response(
        JSON.stringify({ error: "Erro ao criar registro de importação" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Map and insert orders in batches
    if (newSales.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < newSales.length; i += batchSize) {
        const batch = newSales.slice(i, i + batchSize).map((sale: any) => {
          const payments = sale.payments || [];
          const primaryPayment =
            payments.length > 0
              ? payments[0].desc_store_payment_type || ""
              : "";

          // Build combined payment method string if multiple
          const paymentMethodStr =
            payments.length > 1
              ? payments.map((p: any) => p.desc_store_payment_type || "").join(", ")
              : primaryPayment;

          const allOnline = isAllOnline(paymentMethodStr);

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

          const partnerSale = sale.partner_sale || null;

          // Determine sales channel using desc_partner_sale (direct name from Saipos)
          let salesChannel: string | null = null;
          if (partnerSale && partnerSale.desc_partner_sale) {
            salesChannel = partnerSale.desc_partner_sale; // "iFood", "Brendi", etc.
          } else {
            salesChannel = "Telefone";
          }
          // Determine delivery person
          let deliveryPerson: string | null = null;
          if (sale.delivery_man?.delivery_man_name) {
            deliveryPerson = sale.delivery_man.delivery_man_name;
          } else if (sale.delivery?.delivery_by === "PARTNER" || sale.partner_delivery?.partner_order_id) {
            deliveryPerson = 'Entrega Parceiro';
          } else {
            deliveryPerson = null;
          }

          return {
            import_id: importRecord.id,
            daily_closing_id,
            order_number: String(sale.sale_number),
            payment_method: paymentMethodStr,
            total_amount: sale.total_amount || 0,
            delivery_person: deliveryPerson,
            sale_date: sale.shift_date || closing_date,
            sale_time: saleTime,
            sales_channel: salesChannel,
            partner_order_number: partnerSale?.cod_sale2 || null,
            is_confirmed: allOnline,
            confirmed_at: allOnline ? new Date().toISOString() : null,
            confirmed_by: allOnline ? userId : null,
          };
        });

        const { error: insertErr } = await supabaseAdmin
          .from("imported_orders")
          .insert(batch);
        if (insertErr) {
          console.error("Insert error:", insertErr);
          return new Response(
            JSON.stringify({ error: `Erro ao inserir pedidos: ${insertErr.message}` }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Handle multi-payment breakdowns
        for (let j = 0; j < batch.length; j++) {
          const sale = newSales[i + j];
          const payments = sale.payments || [];
          if (payments.length > 1) {
            // Need the order ID - fetch it
            const { data: orderData } = await supabaseAdmin
              .from("imported_orders")
              .select("id")
              .eq("import_id", importRecord.id)
              .eq("order_number", batch[j].order_number)
              .maybeSingle();

            if (orderData) {
              const breakdowns = payments.map((p: any) => ({
                imported_order_id: orderData.id,
                payment_method_name: p.desc_store_payment_type || "",
                amount: p.payment_amount || 0,
                payment_type: isOnlinePayment(p.desc_store_payment_type || "")
                  ? "online"
                  : "fisico",
                is_auto_calculated: false,
              }));

              await supabaseAdmin
                .from("order_payment_breakdowns")
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-saipos-sales error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
