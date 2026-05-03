// @ts-nocheck
// Importa Relatório Pedidos iFood (XLSX, 20 colunas). Filtra status='CONCLUIDO'
// — outros status (CANCELADO, etc) são noise pra cross-check com Saipos.
//
// Headers (linha 1):
// A=ID COMPLETO DO PEDIDO (UUID = Saipos.order_id_parceiro), B=NOME DA LOJA,
// C=ID DA LOJA, D=DATA E HORA DO PEDIDO ("DD/MM/YYYY HH:MM:SS"), E=TURNO,
// F=ID CURTO DO PEDIDO (1001-format), G=STATUS FINAL DO PEDIDO,
// H=VALOR DOS ITENS, I=TOTAL PAGO PELO CLIENTE (bruto), J=TAXA ENTREGA CLIENTE,
// K=INCENTIVO IFOOD, L=INCENTIVO LOJA, M=INCENTIVO REDE,
// N=TAXA SERVIÇO, O=TAXAS E COMISSOES (negativo), P=VALOR LIQUIDO,
// Q=FORMA PAGAMENTO, R=TIPO ENTREGA, S=PRODUTO LOGISTICO, T=CANAL VENDA

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const STATUS_VALIDO = 'CONCLUIDO';

function normUpper(s: string): string {
  return (s || '').normalize('NFC').trim().toUpperCase();
}

function excelSerialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

// iFood exporta DATA E HORA como string "DD/MM/YYYY HH:MM:SS" (BRT). Aceita
// também Date instance (caso o exporter mude) ou serial Excel.
function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const brt = new Date(v.getTime() - 3 * 60 * 60 * 1000);
    return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 100000) {
    return toIsoDate(excelSerialToDate(v));
  }
  const s = String(v).trim();
  // BR DD/MM/YYYY HH:MM:SS — wall-clock BRT, não precisa ajuste
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toIsoDateTime(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 100000) {
    return excelSerialToDate(v).toISOString();
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  // BR DD/MM/YYYY HH:MM[:SS]
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, dd, mm, yyyy, h, min, sec] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${sec ?? '00'}-03:00`;
  }
  return null;
}

function toNum(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[R$\s]/gi, '');
  if (!s) return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot === -1 && lastComma === -1) return Number(s) || 0;
  const decimalSep = lastDot > lastComma ? '.' : ',';
  const thousandSep = decimalSep === '.' ? ',' : '.';
  const digitsAfter = s.length - 1 - Math.max(lastDot, lastComma);
  if (decimalSep === '.' && digitsAfter === 3 && !s.includes(',') && s.length > 4) {
    return Number(s.replace(/\./g, '')) || 0;
  }
  s = s.split(thousandSep).join('').replace(decimalSep, '.');
  return Number(s) || 0;
}

function toStr(v: any): string | null {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
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
    const { audit_period_id, file_name, rows, clear_existing } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, rows)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (clear_existing === true) {
      const { error: delErr } = await supabase
        .from('audit_ifood_marketplace_orders')
        .delete()
        .eq('audit_period_id', audit_period_id);
      if (delErr) {
        return new Response(JSON.stringify({ error: `Erro ao limpar dados anteriores: ${delErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { data: period, error: periodErr } = await supabase
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (periodErr || !period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (period.status === 'fechado') {
      return new Response(JSON.stringify({ error: 'Período fechado. Reabra antes de adicionar imports.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Header detection: linha 0-4 com "ID COMPLETO DO PEDIDO" + "VALOR LIQUIDO"
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => String(c ?? '').toLowerCase().trim());
      const hasId = cells.some(c => c.includes('id completo do pedido'));
      const hasLiq = cells.some(c => c.includes('valor liquido') || c.includes('valor líquido'));
      if (hasId && hasLiq) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header iFood não encontrado. Esperado: "ID COMPLETO DO PEDIDO" e "VALOR LIQUIDO" na linha 1.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const COL = {
      order_id: 0, store_name: 1, store_id: 2, data_pedido: 3, turno: 4,
      short_id: 5, status: 6, valor_itens: 7, total_pago: 8, taxa_entrega: 9,
      inc_ifood: 10, inc_loja: 11, inc_rede: 12, taxa_servico: 13,
      taxas_comissoes: 14, valor_liquido: 15, forma_pagamento: 16,
      tipo_entrega: 17, produto_logistico: 18, canal_venda: 19,
    };

    const dataRows = rows.slice(headerIdx + 1).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
    const totalRows = dataRows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'ifood_orders',
        file_name,
        total_rows: totalRows,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar import: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const orders: any[] = [];
    const allDates: string[] = [];
    let ignoredStatus = 0;
    let skippedNoId = 0;
    let skippedNoDate = 0;
    const seenStatuses = new Map<string, number>();

    for (const r of dataRows) {
      const orderId = toStr(r[COL.order_id]);
      const status = toStr(r[COL.status]);
      const rawData = r[COL.data_pedido];

      if (status) seenStatuses.set(status, (seenStatuses.get(status) ?? 0) + 1);
      if (!orderId) { skippedNoId++; continue; }
      if (!status || normUpper(status) !== STATUS_VALIDO) { ignoredStatus++; continue; }

      const dataPedido = toIsoDateTime(rawData);
      const saleDate = toIsoDate(rawData);
      if (!saleDate) { skippedNoDate++; continue; }
      allDates.push(saleDate);

      orders.push({
        audit_period_id,
        import_id: importRec.id,
        order_id: orderId,
        short_order_id: toStr(r[COL.short_id]),
        data_pedido: dataPedido ?? saleDate,
        sale_date: saleDate,
        turno: toStr(r[COL.turno]),
        status_pedido: status,
        valor_itens: toNum(r[COL.valor_itens]),
        total_pago_cliente: toNum(r[COL.total_pago]),
        taxa_entrega_cliente: toNum(r[COL.taxa_entrega]),
        incentivo_ifood: toNum(r[COL.inc_ifood]),
        incentivo_loja: toNum(r[COL.inc_loja]),
        incentivo_rede: toNum(r[COL.inc_rede]),
        taxa_servico: toNum(r[COL.taxa_servico]),
        taxas_comissoes: toNum(r[COL.taxas_comissoes]),
        valor_liquido: toNum(r[COL.valor_liquido]),
        forma_pagamento: toStr(r[COL.forma_pagamento]),
        tipo_entrega: toStr(r[COL.tipo_entrega]),
        produto_logistico: toStr(r[COL.produto_logistico]),
        canal_venda: toStr(r[COL.canal_venda]),
      });
    }

    const breakdownByMonth: Record<string, number> = {};
    for (const d of allDates) {
      const ym = d?.slice(0, 7);
      if (ym) breakdownByMonth[ym] = (breakdownByMonth[ym] ?? 0) + 1;
    }

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < orders.length; i += CHUNK) {
      const chunk = orders.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_ifood_marketplace_orders')
        .upsert(chunk, { onConflict: 'audit_period_id,order_id' });
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: insErr.message, imported_rows: inserted,
        }).eq('id', importRec.id);
        return new Response(JSON.stringify({ error: `Erro ao inserir: ${insErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted += chunk.length;
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: inserted,
    }).eq('id', importRec.id);

    return new Response(JSON.stringify({
      success: true,
      total_rows: totalRows,
      imported_rows: inserted,
      ignored_status: ignoredStatus,
      skipped_no_id: skippedNoId,
      skipped_no_date: skippedNoDate,
      seen_statuses: Object.fromEntries(seenStatuses),
      breakdown_by_month: breakdownByMonth,
      message: `${inserted} pedidos iFood Marketplace importados (${ignoredStatus} status fora de escopo, ${skippedNoDate} sem data)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-ifood-orders error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
