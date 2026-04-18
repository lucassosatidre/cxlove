// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EXPECTED_HEADERS = [
  'Data da venda', 'Hora da venda', 'Canal de captura', 'Metodo de pagamento',
  'Bandeira', 'Numero do cartao', 'Nome do pagador Pix', 'Valor bruto da venda',
  'Taxa de transacao', 'Valor da taxa de transacao', 'Incentivo iFood',
  'Valor liquido', 'ID da transacao', 'Serial da Maquinona', 'Nome do estabelecimento',
  'CNPJ', 'Previsao de recebimento', 'NSU', 'AuthCode', 'PixEndToEndId',
];

function normalizeHeader(s: any): string {
  if (s == null) return '';
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

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
  const s = String(v).replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
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

    // Verifica role admin
    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Acesso restrito a admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { audit_period_id, file_base64, file_name } = body || {};
    if (!audit_period_id || !file_base64 || !file_name) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verifica período
    const { data: period, error: periodErr } = await supabase
      .from('audit_periods').select('id,status').eq('id', audit_period_id).maybeSingle();
    if (periodErr || !period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!['aberto', 'importado'].includes(period.status)) {
      return new Response(JSON.stringify({ error: `Período está '${period.status}' e não permite importação` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decodifica arquivo
    const bin = atob(file_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    let workbook: any;
    try {
      workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Não foi possível ler o arquivo .xlsx' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Procura aba "Transações" (com tolerância a acento/case)
    const sheetName = workbook.SheetNames.find(
      (n: string) => normalizeHeader(n) === 'transacoes',
    );
    if (!sheetName) {
      return new Response(JSON.stringify({
        error: 'Aba "Transações" não encontrada. Exporte novamente do Portal iFood em Financeiro > Relatório de Transações.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'Aba "Transações" está vazia' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = (rows[0] || []).map(normalizeHeader);
    const expectedNorm = EXPECTED_HEADERS.map(normalizeHeader);

    // Valida cabeçalhos
    const missing = expectedNorm.filter((h, i) => headers[i] !== h);
    if (missing.length) {
      return new Response(JSON.stringify({
        error: 'Formato inválido. Exporte novamente do Portal iFood em Financeiro > Relatório de Transações.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const dataRows = rows.slice(1).filter(r => r && r.some(c => c != null && c !== ''));
    const totalRows = dataRows.length;

    // Cria registro de import (pending)
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

    // Monta transações
    const txs: any[] = [];
    const seen = new Set<string>();
    for (const r of dataRows) {
      const transactionId = r[12] != null ? String(r[12]).trim() : '';
      if (!transactionId) continue;
      if (seen.has(transactionId)) continue;
      seen.add(transactionId);

      const payment = String(r[3] ?? '').trim();
      const brand = String(r[4] ?? '').trim().toUpperCase();

      txs.push({
        audit_period_id,
        sale_date: parseDateBR(r[0]) ?? new Date().toISOString().slice(0, 10),
        sale_time: parseTime(r[1]),
        payment_method: payment,
        brand: brand || null,
        gross_amount: parseNumber(r[7]),
        tax_rate: parseTaxRate(r[8]),
        tax_amount: parseNumber(r[9]),
        promotion_amount: parseNumber(r[10]),
        net_amount: parseNumber(r[11]),
        transaction_id: transactionId,
        machine_serial: r[13] ? String(r[13]).trim() : null,
        expected_deposit_date: parseDateBR(r[16]),
        nsu: r[17] ? String(r[17]).trim() : null,
        deposit_group: calcDepositGroup(payment, brand),
      });
    }

    // Insere em chunks com onConflict no transaction_id
    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < txs.length; i += CHUNK) {
      const chunk = txs.slice(i, i + CHUNK);
      // Verifica existentes
      const ids = chunk.map(t => t.transaction_id);
      const { data: existing } = await supabase
        .from('audit_card_transactions')
        .select('transaction_id')
        .in('transaction_id', ids);
      const existingSet = new Set((existing ?? []).map((e: any) => e.transaction_id));
      const toInsert = chunk.filter(t => !existingSet.has(t.transaction_id));
      if (toInsert.length) {
        const { error: insErr } = await supabase.from('audit_card_transactions').insert(toInsert);
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
