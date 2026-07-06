// @ts-nocheck
// import-bb-openfinance — puxa os créditos do BB já sincronizados pelo Pluggy
// (cashflow_transactions, source='pluggy') para a auditoria (audit_bank_deposits),
// criando um registro em audit_imports igual a um upload manual de extrato.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// mapeia o "bank" da auditoria (minúsculo) para cashflow_accounts.bank
const BANK_MAP: Record<string, string> = { bb: 'BB', cresol: 'Cresol' };

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

// Mesma categorização do import-bb (alelo/ticket/pluxee/vr/brendi/outro)
function categorizeBB(text: string): string {
  const d = norm(text);
  if (/ALELO/.test(d) || /04\.?740\.?876/.test(d)) return 'alelo';
  if (/TICKET|EDENRED/.test(d) || /47\.?866\.?934/.test(d)) return 'ticket';
  if (/TOPAZIO/.test(d) || /07\.?679\.?404/.test(d)) return 'ticket';
  if (/PLUXEE|SODEXO/.test(d)) return 'pluxee';
  if (/78626983|BANCO\s*VR|VR\s+BENEFICIOS?|VR\s+REFEICAO/.test(d)) return 'vr';
  if (/BRENDI/.test(d)) return 'brendi';
  return 'outro';
}

// Transferências internas do grupo (não são depósitos de cartão/voucher).
// No Pluggy o pagador vem na DESCRIÇÃO (não no detalhe), então checamos os dois.
function isInternalGroup(description: string, detail: string, flag: boolean): boolean {
  if (flag) return true;
  const d = norm(`${description} ${detail}`);
  // CNPJs próprios do grupo: pizzaria(00939190) / prover(58084072) / propósito(58483608)
  if (/00939190|58084072|58483608/.test(d)) return true;
  if (/(PIX|TED|TRANSFER)/.test(d) && /(PIZZARIA|PROVER|PROPOSITO|5 ESTRELAS|LUCAS SOSA|LUANA)/.test(d)) return true;
  return false;
}

function lastDayOfMonth(y: number, m1: number): string {
  return new Date(Date.UTC(y, m1, 0)).toISOString().slice(0, 10);
}
function fmtBR(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Não autenticado' }, 401);
    const userId = userData.user.id;

    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) return json({ error: 'Acesso restrito a admin' }, 403);

    const body = await req.json().catch(() => ({}));
    const audit_period_id = body?.audit_period_id;
    const bankKey = String(body?.bank ?? 'bb').toLowerCase();
    const cashflowBank = BANK_MAP[bankKey];
    if (!audit_period_id) return json({ error: 'audit_period_id obrigatório' }, 400);
    if (!cashflowBank) return json({ error: `Banco não suportado: ${bankKey}` }, 400);

    const { data: period, error: pErr } = await supabase
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (pErr || !period) return json({ error: 'Período não encontrado' }, 404);
    if (period.status === 'fechado') return json({ error: 'Período fechado. Reabra antes de puxar extratos.' }, 400);
    const wasConciliado = period.status === 'conciliado';

    const { data: acc, error: accErr } = await supabase
      .from('cashflow_accounts').select('id,name').eq('bank', cashflowBank).eq('active', true).limit(1).maybeSingle();
    if (accErr || !acc) return json({ error: `Conta ${cashflowBank} não encontrada no Fluxo de Caixa` }, 404);

    const fromStr = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const nextM = period.month === 12 ? 1 : period.month + 1;
    const nextY = period.month === 12 ? period.year + 1 : period.year;
    const toStr = lastDayOfMonth(nextY, nextM);

    const { data: txs, error: txErr } = await supabase
      .from('cashflow_transactions')
      .select('tx_date, description, detail, amount, is_internal_transfer, external_id')
      .eq('account_id', acc.id)
      .eq('source', 'pluggy')
      .gt('amount', 0)
      .gte('tx_date', fromStr)
      .lte('tx_date', toStr);
    if (txErr) return json({ error: `Erro ao ler transações: ${txErr.message}` }, 500);
    const rows = txs ?? [];

    const importFile = `Open Finance — ${acc.name} (${fmtBR(fromStr)} a ${fmtBR(toStr)})`;
    const { data: importRec, error: impErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: bankKey, file_name: importFile,
        total_rows: rows.length, status: 'pending', created_by: userId,
      }).select().single();
    if (impErr) return json({ error: `Erro ao registrar importação: ${impErr.message}` }, 500);

    const deposits: any[] = [];
    let skippedInternal = 0;
    const breakdown: Record<string, number> = { alelo: 0, ticket: 0, pluxee: 0, vr: 0, brendi: 0, outro: 0 };

    for (const t of rows) {
      const description = (t.description ?? '').toString().trim();
      const detail = (t.detail ?? '').toString().trim();
      if (!t.tx_date || !description) continue;
      if (/saldo anterior|saldo do dia|^saldo$/i.test(description)) continue;
      if (isInternalGroup(description, detail, !!t.is_internal_transfer)) { skippedInternal++; continue; }
      const amount = Math.abs(Number(t.amount) || 0);
      if (amount <= 0) continue;
      const category = categorizeBB(`${description} ${detail}`);
      breakdown[category] = (breakdown[category] ?? 0) + 1;
      deposits.push({
        audit_period_id,
        import_id: importRec.id,
        bank: bankKey,
        deposit_date: String(t.tx_date).slice(0, 10),
        description,
        detail: detail || null,
        amount,
        category,
        auto_categorized: true,
        doc_number: t.external_id ? String(t.external_id) : null,
      });
    }

    const CHUNK = 200;
    const { count: beforeCount } = await supabase
      .from('audit_bank_deposits').select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id).eq('bank', bankKey);

    for (let i = 0; i < deposits.length; i += CHUNK) {
      const chunk = deposits.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_bank_deposits').upsert(chunk, { onConflict: 'audit_period_id,bank,row_hash' });
      if (insErr) {
        await supabase.from('audit_imports').update({ status: 'failed', error_message: insErr.message }).eq('id', importRec.id);
        return json({ error: `Erro ao inserir: ${insErr.message}` }, 500);
      }
    }

    const { count: afterCount } = await supabase
      .from('audit_bank_deposits').select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id).eq('bank', bankKey);
    const inserted = (afterCount ?? 0) - (beforeCount ?? 0);
    const duplicates = deposits.length - inserted;

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: inserted, duplicate_rows: duplicates,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    } else if (wasConciliado) {
      await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_periods').update({ status: 'importado', updated_at: new Date().toISOString() }).eq('id', audit_period_id);
    }

    return json({
      success: true,
      window: { from: fromStr, to: toStr },
      total_credits: rows.length,
      imported_rows: inserted,
      duplicate_rows: duplicates,
      skipped_internal: skippedInternal,
      breakdown_by_category: breakdown,
      message: `${inserted} créditos importados do Open Finance`,
    });
  } catch (e: any) {
    console.error('import-bb-openfinance error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
