// @ts-nocheck
// inter-webhook — recebe callbacks do Banco Inter e grava em cashflow_transactions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function toIsoDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

async function processEvent(supabase: any, accountId: string, ev: any) {
  const tipoOp = String(ev.tipoOperacao ?? '').toUpperCase();
  const rawValor = Number(ev.valor ?? ev.valorLancamento ?? 0);
  if (!isFinite(rawValor) || rawValor === 0) return { skipped: true, reason: 'valor inválido' };
  const tx_date =
    toIsoDate(ev.dataHora ?? ev.dataEntrada ?? ev.dataLancamento ?? ev.dataTransacao) ??
    new Date().toISOString().slice(0, 10);
  const description = String(ev.descricao ?? ev.tipoTransacao ?? ev.titulo ?? 'Movimentação Inter').trim();
  const detail = ev.detalhes ? String(ev.detalhes).trim() : null;
  let amount = Math.abs(rawValor);
  if (tipoOp === 'D') amount = -amount;
  else if (tipoOp !== 'C') amount = rawValor;

  const external_id = String(
    ev.idTransacao ?? ev.endToEnd ?? ev.codigoTransacao ?? ev.id ?? `${tx_date}-${rawValor}-${description}`,
  );
  const row_hash = `inter:${accountId}:${external_id}`;

  const { error } = await supabase
    .from('cashflow_transactions')
    .upsert(
      {
        account_id: accountId,
        tx_date,
        description,
        detail,
        amount,
        source: 'inter-webhook',
        external_id,
        row_hash,
      },
      { onConflict: 'account_id,external_id' },
    );
  if (error) return { error: error.message };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Responde 200 rapidamente, processa em background.
  const bodyText = await req.text().catch(() => '');
  let body: any = {};
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = {}; }

  (async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

      // Localiza (ou cria) conta Inter.
      let { data: acc } = await supabase
        .from('cashflow_accounts')
        .select('id')
        .eq('bank', 'inter')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      if (!acc) {
        const { data: created } = await supabase
          .from('cashflow_accounts')
          .insert({ name: 'Conta Inter', bank: 'inter', company: 'estrela', kind: 'checking', active: true })
          .select('id')
          .single();
        acc = created;
      }
      if (!acc?.id) {
        console.error('inter-webhook: sem conta Inter');
        return;
      }

      // Aceita 1 evento ou array de eventos.
      const events: any[] = Array.isArray(body) ? body : Array.isArray(body?.eventos) ? body.eventos : [body];
      for (const ev of events) {
        const r = await processEvent(supabase, acc.id, ev);
        if ((r as any)?.error) console.error('inter-webhook processEvent', r);
      }
    } catch (e) {
      console.error('inter-webhook bg error', e);
    }
  })();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
