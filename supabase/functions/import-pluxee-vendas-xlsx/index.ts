// @ts-nocheck
// Importa o XLSX "extrato_vendas" da Pluxee (formato novo, mai/2026 em diante).
// Cobre 1 mês de competência. Mostra TODAS as vendas do mês com a data esperada
// de pagamento (que pode cair no mês seguinte).
//
// Layout esperado:
// - sheet "extrato_vendas" (ou primeira)
// - header em alguma row contendo "Data da transação" + "Data de pagamento"
// - colunas: Data do processamento, Data da transação, Rede de captura,
//   Descrição, Número do cartão, Número da autorização, Valor bruto, Origem,
//   Data de pagamento
// - encerra em "TOTAL VALOR BRUTO"
//
// Estratégia: 1 lote por data_pagamento. Itens com status_remote=NULL — o
// status (PAGO / ERRO NO PAGAMENTO) é preenchido pelo importer de pagamentos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { validatePeriodMatch, filterToPeriod } from '../_shared/period-validator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function toIso(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function findHeaderRow(rows: any[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const joined = r.map(c => String(c ?? '').toLowerCase()).join('|');
    if (joined.includes('data da transação') && joined.includes('data de pagamento')) return i;
    if (joined.includes('data da transacao') && joined.includes('data de pagamento')) return i;
  }
  return -1;
}

function colIndex(header: any[], ...needles: string[]): number {
  const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (let i = 0; i < header.length; i++) {
    const h = norm(header[i]);
    if (needles.every(n => h.includes(norm(n)))) return i;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const userId = userData.user.id;
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) return new Response(JSON.stringify({ error: 'Acesso restrito a admin' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { audit_period_id, file_name, rows } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, rows)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: period } = await supabase.from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (!period) return new Response(JSON.stringify({ error: 'Período não encontrado' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (period.status === 'fechado') return new Response(JSON.stringify({ error: 'Período fechado.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const headerIdx = findHeaderRow(rows);
    if (headerIdx < 0) {
      return new Response(JSON.stringify({ error: 'Header não encontrado. Esperado linha com "Data da transação" + "Data de pagamento".' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const header = rows[headerIdx] as any[];
    const cDataProc = colIndex(header, 'data', 'processamento');
    const cDataTrans = colIndex(header, 'data', 'transa');
    const cRede = colIndex(header, 'rede');
    const cDesc = colIndex(header, 'descri');
    const cCartao = colIndex(header, 'cart');
    const cAuth = colIndex(header, 'autoriza');
    const cValor = colIndex(header, 'valor', 'bruto');
    const cOrigem = colIndex(header, 'origem');
    const cDataPag = colIndex(header, 'data', 'pagamento');

    if (cDataTrans < 0 || cDataPag < 0 || cValor < 0) {
      return new Response(JSON.stringify({ error: 'Colunas essenciais ausentes (Data da transação / Data de pagamento / Valor bruto).', header }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    type Item = { data_transacao: string; data_processamento: string | null; data_pagamento: string; numero_autorizacao: string | null; numero_cartao: string | null; valor: number; origem: string | null };
    const items: Item[] = [];
    const warnings: string[] = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      // Detecta linha total/encerramento
      const joined = r.map(c => String(c ?? '')).join('|').toLowerCase();
      if (joined.includes('total valor bruto') || joined.includes('total bruto')) break;
      const dataTrans = toIso(r[cDataTrans]);
      const dataPag = toIso(r[cDataPag]);
      if (!dataTrans || !dataPag) continue;
      const valor = toNum(r[cValor]);
      if (valor == null) continue;
      items.push({
        data_transacao: dataTrans,
        data_processamento: cDataProc >= 0 ? toIso(r[cDataProc]) : null,
        data_pagamento: dataPag,
        numero_autorizacao: cAuth >= 0 ? (r[cAuth] != null ? String(r[cAuth]).trim() : null) : null,
        numero_cartao: cCartao >= 0 ? (r[cCartao] != null ? String(r[cCartao]).trim() : null) : null,
        valor,
        origem: cOrigem >= 0 ? (r[cOrigem] != null ? String(r[cOrigem]).trim() : null) : null,
      });
    }

    if (items.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhuma venda encontrada no extrato_vendas.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const periodCheck = validatePeriodMatch(items.map(it => it.data_transacao), { month: period.month, year: period.year }, 'Pluxee Vendas', [0]);
    if (!periodCheck.ok) {
      return new Response(JSON.stringify({ error: periodCheck.error, breakdown_by_month: periodCheck.breakdown }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Filtra items pelo mês alvo (data_transacao). Arquivo cobrindo mais de
    // um mês não deve criar items fora do period — competência é a venda.
    const periodFilter = filterToPeriod(
      items,
      (it) => it.data_transacao,
      { month: period.month, year: period.year },
      [0],
    );
    const itemsKept = periodFilter.kept;

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'pluxee_vendas', file_name,
        total_rows: itemsKept.length, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar: ${importErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Apaga TODOS os lotes pluxee EXCETO os 'PLUXEE-PAG-*' (que pertencem ao
    // importer de pagamentos). Inclui formato antigo PLUXEE-YYYYMMDD-N do CSV
    // legacy e o atual PLUXEE-VENDAS-*. Cascade não existe — apaga items manualmente.
    const { data: oldLots } = await supabase
      .from('audit_voucher_lots').select('id,numero_reembolso')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', 'pluxee');
    const toDelete = (oldLots ?? []).filter(l => !String(l.numero_reembolso ?? '').startsWith('PLUXEE-PAG-'));
    if (toDelete.length > 0) {
      const ids = toDelete.map(l => l.id);
      await supabase.from('audit_voucher_lot_items').delete().in('lot_id', ids);
      const { error: delErr } = await supabase.from('audit_voucher_lots').delete().in('id', ids);
      if (delErr) console.warn('cleanup pluxee vendas:', delErr.message);
    }

    // Agrupa por data_pagamento
    const byPag = new Map<string, Item[]>();
    for (const it of itemsKept) {
      const arr = byPag.get(it.data_pagamento) ?? [];
      arr.push(it);
      byPag.set(it.data_pagamento, arr);
    }

    let insertedLots = 0;
    let insertedItems = 0;

    for (const [dataPag, group] of byPag.entries()) {
      const subtotal = Math.round(group.reduce((s, x) => s + x.valor, 0) * 100) / 100;
      const numReembolso = `PLUXEE-VENDAS-${dataPag.replaceAll('-', '')}`;
      const lotPayload = {
        audit_period_id, operadora: 'pluxee',
        numero_reembolso: numReembolso, numero_contrato: null,
        produto: 'PLUXEE',
        data_corte: dataPag,
        data_credito: dataPag,
        subtotal_vendas: subtotal,
        total_descontos: 0,
        valor_liquido: subtotal,
        descontos: null,
        import_id: importRec.id,
        status: 'pending',
      };
      const { data: ins, error: insErr } = await supabase
        .from('audit_voucher_lots').insert(lotPayload).select('id').single();
      if (insErr || !ins) {
        await supabase.from('audit_imports').update({
          status: 'error', error_message: `Erro ao inserir lote ${numReembolso}: ${insErr?.message ?? 'sem dado'}`,
        }).eq('id', importRec.id);
        throw insErr ?? new Error('falha insert lote');
      }
      insertedLots++;
      const lotId = ins.id;
      const itemsPayload = group.map(it => ({
        lot_id: lotId,
        data_transacao: it.data_transacao,
        data_postagem: it.data_processamento,
        numero_documento: it.numero_autorizacao,
        numero_cartao_mascarado: it.numero_cartao,
        valor: Math.round(it.valor * 100) / 100,
        estabelecimento: 'PIZZARIA ESTRELA',
        cnpj: null,
        status_remote: null,
      }));
      if (itemsPayload.length) {
        const { error: itErr } = await supabase.from('audit_voucher_lot_items').insert(itemsPayload);
        if (itErr) {
          await supabase.from('audit_imports').update({
            status: 'error', error_message: `Erro ao inserir items do lote ${numReembolso}: ${itErr.message}`,
          }).eq('id', importRec.id);
          throw itErr;
        }
        insertedItems += itemsPayload.length;
      }
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: insertedItems, duplicate_rows: 0,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_lots: insertedLots,
      inserted_lots: insertedLots,
      inserted_items: insertedItems,
      total_items: items.length,
      kept_in_period: itemsKept.length,
      skipped_outside_period: periodFilter.skipped,
      skipped_outside_period_by_month: periodFilter.skippedByMonth,
      warnings,
      message: `${insertedLots} lotes (por data_pagamento) com ${insertedItems} vendas${periodFilter.skipped > 0 ? ` (${periodFilter.skipped} fora do mês)` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-pluxee-vendas-xlsx error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
