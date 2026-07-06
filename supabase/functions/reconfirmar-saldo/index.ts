// reconfirmar-saldo — reseta a âncora de saldo de uma conta cashflow
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

function todayISO(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Método não permitido' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => null);
    const account_id = body?.account_id;
    const balance = Number(body?.balance);

    if (typeof account_id !== 'string' || !account_id) {
      return new Response(JSON.stringify({ error: 'account_id é obrigatório.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!Number.isFinite(balance)) {
      return new Response(JSON.stringify({ error: 'balance deve ser um número válido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: acc, error: accErr } = await supabase
      .from('cashflow_accounts')
      .select('id, name')
      .eq('id', account_id)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!acc) {
      return new Response(JSON.stringify({ error: 'Conta não encontrada.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anchor_date = todayISO();

    const { error: updErr } = await supabase
      .from('cashflow_accounts')
      .update({ balance_anchor: balance, balance_anchor_date: anchor_date })
      .eq('id', account_id);
    if (updErr) throw updErr;

    const { error: balErr } = await supabase
      .from('cashflow_balances')
      .upsert(
        { account_id, as_of: anchor_date, own_balance: balance },
        { onConflict: 'account_id,as_of' },
      );
    if (balErr) throw balErr;

    return new Response(
      JSON.stringify({ ok: true, account_id, balance, anchor_date }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: `Erro ao reconfirmar saldo: ${msg}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
