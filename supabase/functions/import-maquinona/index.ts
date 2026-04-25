// @ts-nocheck
// Receives pre-parsed JSON rows from the frontend. Avoids large base64 payloads
// and edge-runtime XLSX parsing timeouts on big files.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function parseDateBR(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parseTime(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const totalSec = Math.round(v * 86400);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${(m[3] ?? '00').padStart(2, '0')}`;
  return null;
}

function parseNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[R$\s%]/g, '').trim();
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // BR clássico: 1.234,56
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Só vírgula → decimal BR
    s = s.replace(',', '.');
  } else if (hasDot) {
    // Só ponto → US-like se exatamente 1 ponto e ≤2 casas (924.30)
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      // já é decimal US, mantém
    } else {
      // múltiplos pontos = milhar BR (1.234.567)
      s = s.replace(/\./g, '');
    }
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function parseTaxRate(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  const s = String(v).trim();
  const hasPct = s.includes('%');
  const n = parseNumber(s);
  if (!isFinite(n)) return null;
  return hasPct ? n / 100 : (n > 1 ? n / 100 : n);
}

function calcDepositGroup(method: string, brand: string): string {
  const m = (method || '').toUpperCase();
  const b = (brand || '').toUpperCase();
  if (m === 'CREDITO' || m === 'DEBITO' || m === 'PIX') return 'ifood';
  if (m === 'VOUCHER') {
    if (b === 'ALELO') return 'alelo';
    if (b === 'TICKET') return 'ticket';
    if (b === 'SODEXO' || b === 'PLUXEE') return 'pluxee';
    if (b === 'VR') return 'vr';
  }
  return 'ifood';
}

function pick(row: any, ...keys: string[]): any {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Acesso restrito a admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { audit_period_id, file_name, rows } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, rows)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period, error: periodErr } = await supabase
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (periodErr || !period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (period.status === 'fechado') {
      return new Response(JSON.stringify({ error: `Período está 'fechado' e não permite importação. Reabra antes.` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Se o período já foi conciliado, limpar matches anteriores e voltar para 'importado'
    if (period.status === 'conciliado') {
      await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_voucher_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    }

    const totalRows = rows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'maquinona',
        file_name,
        total_rows: totalRows,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar importação: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map JSON rows → DB shape, dedup by transaction_id
    const seen = new Set<string>();
    const txs: any[] = [];
    for (const r of rows) {
      const transactionId = String(pick(r, 'ID da transacao', 'ID da transação') ?? '').trim();
      if (!transactionId) continue;
      if (seen.has(transactionId)) continue;
      seen.add(transactionId);

      const payment = String(pick(r, 'Metodo de pagamento', 'Método de pagamento') ?? '').trim();
      const brand = String(pick(r, 'Bandeira') ?? '').trim().toUpperCase();

      const saleDateStr = parseDateBR(pick(r, 'Data da venda')) ?? new Date().toISOString().slice(0, 10);
      // Calcula se a venda pertence ao mês de competência do período
      const [yStr, mStr] = saleDateStr.split('-');
      const isCompetencia = Number(mStr) === period.month && Number(yStr) === period.year;

      txs.push({
        audit_period_id,
        sale_date: saleDateStr,
        sale_time: parseTime(pick(r, 'Hora da venda')),
        payment_method: payment,
        brand: brand || null,
        gross_amount: parseNumber(pick(r, 'Valor bruto da venda')),
        tax_rate: parseTaxRate(pick(r, 'Taxa de transacao', 'Taxa de transação')),
        tax_amount: parseNumber(pick(r, 'Valor da taxa de transacao', 'Valor da taxa de transação')),
        promotion_amount: parseNumber(pick(r, 'Incentivo iFood')),
        net_amount: parseNumber(pick(r, 'Valor liquido', 'Valor líquido')),
        transaction_id: transactionId,
        machine_serial: pick(r, 'Serial da Maquinona') ? String(pick(r, 'Serial da Maquinona')).trim() : null,
        expected_deposit_date: parseDateBR(pick(r, 'Previsao de recebimento', 'Previsão de recebimento')),
        nsu: pick(r, 'NSU') ? String(pick(r, 'NSU')).trim() : null,
        deposit_group: calcDepositGroup(payment, brand),
        is_competencia: isCompetencia,
      });
    }

    // UPSERT in batches with global existence check (transaction_id is globally unique)
    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < txs.length; i += CHUNK) {
      const chunk = txs.slice(i, i + CHUNK);
      const ids = chunk.map(t => t.transaction_id);
      const { data: existingGlobal } = await supabase
        .from('audit_card_transactions')
        .select('transaction_id')
        .in('transaction_id', ids);
      const globalSet = new Set((existingGlobal ?? []).map((e: any) => e.transaction_id));
      const toInsert = chunk.filter(t => !globalSet.has(t.transaction_id));

      if (toInsert.length) {
        const { error: insErr } = await supabase
          .from('audit_card_transactions')
          .upsert(toInsert, { onConflict: 'transaction_id', ignoreDuplicates: true });
        if (insErr) {
          await supabase.from('audit_imports').update({
            status: 'failed', error_message: insErr.message,
            imported_rows: inserted, duplicate_rows: txs.length - inserted - toInsert.length,
          }).eq('id', importRec.id);
          return new Response(JSON.stringify({ error: `Erro ao inserir: ${insErr.message}` }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        inserted += toInsert.length;
      }
      console.log(`[import-maquinona] batch ${Math.floor(i / CHUNK) + 1}: ${toInsert.length} new, ${chunk.length - toInsert.length} dup`);
    }

    const duplicates = txs.length - inserted;

    await supabase.from('audit_imports').update({
      status: 'completed',
      imported_rows: inserted,
      duplicate_rows: duplicates,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_rows: totalRows,
      imported_rows: inserted,
      duplicate_rows: duplicates,
      message: `${inserted} transações importadas, ${duplicates} duplicadas ignoradas`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-maquinona error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
