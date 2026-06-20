import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Migra um pedido do caixa Tele (delivery) para o caixa Salão do MESMO dia.
// Caso de uso: cliente pediu por delivery mas decidiu vir buscar (vira Retirada).
// Cria/usa o fechamento de salão da data, insere o pedido como "Retirada",
// solta os vínculos de maquininha e marca o pedido tele como migrado.
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Carrega o pedido tele
    const { data: order, error: orderErr } = await supabase
      .from("imported_orders")
      .select("id, order_number, payment_method, total_amount, sale_date, sale_time, daily_closing_id, migrated_to_salon")
      .eq("id", order_id)
      .single();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.migrated_to_salon) {
      return new Response(JSON.stringify({ error: "Pedido já foi migrado para o salão" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Descobre a data do fechamento
    const { data: closing } = await supabase
      .from("daily_closings")
      .select("closing_date")
      .eq("id", order.daily_closing_id)
      .single();
    const closingDate = closing?.closing_date || order.sale_date;
    if (!closingDate) {
      return new Response(JSON.stringify({ error: "Não foi possível determinar a data do fechamento" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Acha ou cria o fechamento de salão da data
    let { data: salonClosing } = await supabase
      .from("salon_closings")
      .select("id")
      .eq("closing_date", closingDate)
      .maybeSingle();
    if (!salonClosing) {
      const { data: newSalon, error: e } = await supabase
        .from("salon_closings")
        .insert({ closing_date: closingDate, user_id: user.id, status: "pending" })
        .select("id")
        .single();
      if (e) throw e;
      salonClosing = newSalon;
    }

    // 4) Acha ou cria um registro de importação "migração" para esse fechamento
    const migrationFileName = `migracao-tele-${closingDate}`;
    let { data: salonImport } = await supabase
      .from("salon_imports")
      .select("id")
      .eq("salon_closing_id", salonClosing.id)
      .eq("file_name", migrationFileName)
      .maybeSingle();
    if (!salonImport) {
      const { data: newImport, error: e } = await supabase
        .from("salon_imports")
        .insert({
          user_id: user.id,
          file_name: migrationFileName,
          total_rows: 0,
          new_rows: 0,
          duplicate_rows: 0,
          skipped_cancelled: 0,
          salon_closing_id: salonClosing.id,
          status: "completed",
        })
        .select("id")
        .single();
      if (e) throw e;
      salonImport = newImport;
    }

    // 5) Insere o pedido como Retirada no salão
    const { data: salonOrder, error: insertErr } = await supabase
      .from("salon_orders")
      .insert({
        salon_import_id: salonImport.id,
        salon_closing_id: salonClosing.id,
        order_type: "Retirada",
        sale_date: order.sale_date || closingDate,
        sale_time: order.sale_time,
        payment_method: order.payment_method || "",
        total_amount: order.total_amount || 0,
        is_confirmed: false,
        sale_number: String(order.order_number),
        table_number: String(order.order_number),
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    // 6) Copia a quebra de pagamentos (se houver)
    const { data: breakdowns } = await supabase
      .from("order_payment_breakdowns")
      .select("payment_method_name, amount")
      .eq("imported_order_id", order.id);
    if (breakdowns && breakdowns.length > 0) {
      await supabase.from("salon_order_payments").insert(
        breakdowns.map((b: any) => ({
          salon_order_id: salonOrder.id,
          payment_method: b.payment_method_name || "",
          amount: b.amount || 0,
        }))
      );
    }

    // 7) Solta vínculos de maquininha que apontavam para esse pedido
    await supabase
      .from("card_transactions")
      .update({ matched_order_id: null, match_type: null, match_confidence: null })
      .eq("matched_order_id", order.id);

    // 8) Marca o pedido tele como migrado (sai do caixa tele, mantém histórico)
    await supabase
      .from("imported_orders")
      .update({ migrated_to_salon: true, migrated_at: new Date().toISOString() })
      .eq("id", order.id);

    return new Response(
      JSON.stringify({ ok: true, salon_order_id: salonOrder.id, salon_closing_id: salonClosing.id, closing_date: closingDate }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("migrate-order-to-salon error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
