// @ts-nocheck
// Importa export do Saipos "Vendas por período" (XLSX). Tabela canal-agnóstica
// — recebe pedidos de qualquer canal (Brendi, iFood, balcão, etc) com 26 colunas.
// Frontend manda rows pre-parsed (header=1 array of arrays).
//
// Headers esperadas (linha 1):
// A=Pedido, B=Código loja, C=Nome loja, D=Tipo pedido, E=Turno,
// F=Canal de venda, G=Id pedido parceiro, H=Número pedido parceiro,
// I=Data da venda, J=Consumidor, K=Tem cupom, L=Pagamento,
// M=Está cancelado, N=Motivo cancelamento, O=Itens, P=Entrega,
// Q=Valor Entregador, R=Entregador, S=Bairro, T=CEP,
// U=Acréscimo, V=Motivo acréscimo, W=Desconto, X=Motivo desconto,
// Y=Total, Z=Total taxa de serviço

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Aplica offset BRT (-3h) antes de extrair year/month/day. Saipos exporta
// datetime no fuso BRT como string "DD/MM/YYYY HH:MM"; quando vira Date no
// XLSX.js do browser, vira Date local que ao serializar pra JSON pode virar
// UTC do dia seguinte se >= 21h BRT.
function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const utc = v.getTime();
    const brt = new Date(utc - 3 * 60 * 60 * 1000);
    const y = brt.getUTCFullYear();
    const m = String(brt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(brt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // "DD/MM/YYYY HH:MM" ou "DD/MM/YYYY"
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // ISO YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function toIsoDateTime(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  // "DD/MM/YYYY HH:MM"
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, dd, mm, yyyy, h, min, sec] = m;
    // Trata como BRT: -3h
    return `${yyyy}-${mm}-${dd}T${h}:${min}:${sec ?? '00'}-03:00`;
  }
  // "DD/MM/YYYY"
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}T00:00:00-03:00`;
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

function toBool(v: any): boolean {
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === 'S' || s === 'SIM' || s === 'TRUE' || s === '1';
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
      return new Response(JSON.stringify({ error: 'Período fechado. Reabra antes de adicionar imports.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Header detection: linha 1 fixa, mas faz validação tolerante. Procura
    // header com "canal de venda" + "id do pedido no parceiro".
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => String(c ?? '').toLowerCase().trim());
      const hasCanal = cells.some(c => c.includes('canal'));
      const hasIdParceiro = cells.some(c => c.includes('id do pedido'));
      if (hasCanal && hasIdParceiro) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header Saipos não encontrado. Esperado: "Canal de venda" e "Id do pedido no parceiro" na linha 1.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const COL = {
      pedido: 0, codigo_loja: 1, nome_loja: 2, tipo_pedido: 3, turno: 4,
      canal_venda: 5, id_parceiro: 6, num_parceiro: 7, data_venda: 8,
      consumidor: 9, tem_cupom: 10, pagamento: 11, cancelado: 12,
      motivo_cancelamento: 13, itens: 14, entrega: 15, valor_entregador: 16,
      entregador: 17, bairro: 18, cep: 19, acrescimo: 20, motivo_acrescimo: 21,
      desconto: 22, motivo_desconto: 23, total: 24, total_taxa_servico: 25,
    };

    const dataRows = rows.slice(headerIdx + 1).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
    const totalRows = dataRows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'saipos',
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
    const byCanal: Record<string, number> = {};
    const byPagamento: Record<string, number> = {};
    let skippedNoId = 0;

    for (const r of dataRows) {
      const idParceiro = toStr(r[COL.id_parceiro]);
      if (!idParceiro) { skippedNoId++; continue; }

      const dataVendaIso = toIsoDateTime(r[COL.data_venda]);
      const saleDate = toIsoDate(r[COL.data_venda]);
      if (!dataVendaIso || !saleDate) { skippedNoId++; continue; }
      allDates.push(saleDate);

      const canal = toStr(r[COL.canal_venda]) ?? 'desconhecido';
      const pagamento = toStr(r[COL.pagamento]) ?? 'desconhecido';
      byCanal[canal] = (byCanal[canal] ?? 0) + 1;
      byPagamento[pagamento] = (byPagamento[pagamento] ?? 0) + 1;

      orders.push({
        audit_period_id,
        import_id: importRec.id,
        order_id_parceiro: idParceiro,
        saipos_pedido: typeof r[COL.pedido] === 'number' ? r[COL.pedido] : (r[COL.pedido] ? Number(r[COL.pedido]) || null : null),
        saipos_pedido_parceiro_num: toStr(r[COL.num_parceiro]),
        canal_venda: canal,
        data_venda: dataVendaIso,
        sale_date: saleDate,
        turno: toStr(r[COL.turno]),
        tipo_pedido: toStr(r[COL.tipo_pedido]),
        pagamento,
        cancelado: toBool(r[COL.cancelado]),
        motivo_cancelamento: toStr(r[COL.motivo_cancelamento]),
        total: toNum(r[COL.total]),
        acrescimo: toNum(r[COL.acrescimo]),
        motivo_acrescimo: toStr(r[COL.motivo_acrescimo]),
        desconto: toNum(r[COL.desconto]),
        motivo_desconto: toStr(r[COL.motivo_desconto]),
        total_taxa_servico: toNum(r[COL.total_taxa_servico]),
        consumidor: toStr(r[COL.consumidor]),
        bairro: toStr(r[COL.bairro]),
        cep: toStr(r[COL.cep]),
        itens: toStr(r[COL.itens]),
        entrega: r[COL.entrega] != null && r[COL.entrega] !== '' ? toNum(r[COL.entrega]) : null,
        valor_entregador: r[COL.valor_entregador] != null && r[COL.valor_entregador] !== '' ? toNum(r[COL.valor_entregador]) : null,
        entregador: toStr(r[COL.entregador]),
      });
    }

    // Saipos é canal-agnóstica e cobre 3 meses (ant + comp + post) no mesmo período
    // pra suportar D+1 entre meses no Brendi e janelas longas no iFood Marketplace.
    // Não bloqueia por mês — sale_date é a chave de filtro downstream.
    const breakdownByMonth: Record<string, number> = {};
    for (const d of allDates) {
      const ym = d?.slice(0, 7);
      if (ym) breakdownByMonth[ym] = (breakdownByMonth[ym] ?? 0) + 1;
    }

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < orders.length; i += CHUNK) {
      const chunk = orders.slice(i, i + CHUNK);
      const { error: insErr, count } = await supabase
        .from('audit_saipos_orders')
        .upsert(chunk, { onConflict: 'audit_period_id,order_id_parceiro', count: 'exact' });
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
      skipped_no_id: skippedNoId,
      by_canal: byCanal,
      by_pagamento: byPagamento,
      breakdown_by_month: breakdownByMonth,
      message: `${inserted} pedidos Saipos importados`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-saipos-xlsx error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
