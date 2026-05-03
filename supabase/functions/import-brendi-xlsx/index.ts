// @ts-nocheck
// Importa report Brendi (XLSX). Aba "Resultado da consulta" com 16 colunas.
// Filtra status='Entregue' AND forma_pagamento IN ('Pix Online','Crédito Online').
// Outras formas viram noise (já cobertas em outros estágios).
//
// Headers (linha 1):
// A=Store ID, B=Order ID, C=Created At, D=Status, E=Nome, F=Telefone,
// G=Cupom, H=Payment Method, I=Plataforma, J=Motoboy, K=Forma de pagamento,
// L=Total (R$), M=Taxa de entrega, N=Desconto de entrega, O=Cashback usado,
// P=Endereço

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Normaliza pra NFC + lowercase pra evitar mismatch quando o XLSX grava acentos
// decompostos (NFD: "e" + combining acute) vs NFC ("é" um codepoint só).
function normForm(s: string): string {
  return (s || '').normalize('NFC').trim().toLowerCase();
}

const FORMAS_AUDITAVEIS_NORM = new Set([
  normForm('Pix Online'),
  normForm('Crédito Online'),
]);

const STATUS_VALIDO_NORM = normForm('Entregue');

// Excel serial date → JS Date (1900-based, com correção do bug de 1900)
function excelSerialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

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
  // Excel serial number (xlsx.js com cellDates=false retorna número)
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 100000) {
    return toIsoDate(excelSerialToDate(v));
  }
  const s = String(v).trim();
  // ISO YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // BR DD/MM/YYYY (com ou sem hora)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
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
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:${sec ?? '00'}-03:00`;
  }
  // Date-only sem hora — meia-noite BRT
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const [, dd, mm, yyyy] = m2;
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}T00:00:00-03:00`;
  }
  return null;
}

function toNum(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

function toStr(v: any): string | null {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'S' || s === '1';
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

    // Header detection: linha 1 com "order id" + "forma de pagamento"
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => String(c ?? '').toLowerCase().trim());
      const hasOrderId = cells.some(c => c.includes('order id'));
      const hasForma = cells.some(c => c.includes('forma de pagamento'));
      if (hasOrderId && hasForma) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header Brendi não encontrado. Esperado: "Order ID" e "Forma de pagamento" na linha 1.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const COL = {
      store_id: 0, order_id: 1, created_at: 2, status: 3,
      nome: 4, telefone: 5, cupom: 6, payment_method: 7,
      plataforma: 8, motoboy: 9, forma_pagamento: 10,
      total: 11, taxa_entrega: 12, desconto_entrega: 13,
      cashback: 14, endereco: 15,
    };

    const dataRows = rows.slice(headerIdx + 1).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
    const totalRows = dataRows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'brendi',
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
    let ignoredForma = 0;
    let skippedNoId = 0;
    let skippedNoDate = 0;
    const seenFormas = new Map<string, number>();
    const seenStatuses = new Map<string, number>();
    const sampleCreatedAt: Array<{ value: any; type: string }> = [];

    for (const r of dataRows) {
      const orderId = toStr(r[COL.order_id]);
      const status = toStr(r[COL.status]);
      const forma = toStr(r[COL.forma_pagamento]);
      const rawCreatedAt = r[COL.created_at];

      // Diagnóstico
      if (status) seenStatuses.set(status, (seenStatuses.get(status) ?? 0) + 1);
      if (forma) seenFormas.set(forma, (seenFormas.get(forma) ?? 0) + 1);
      if (sampleCreatedAt.length < 3) {
        sampleCreatedAt.push({
          value: rawCreatedAt instanceof Date ? rawCreatedAt.toISOString() : rawCreatedAt,
          type: rawCreatedAt instanceof Date ? 'Date' : typeof rawCreatedAt,
        });
      }

      if (!orderId) { skippedNoId++; continue; }
      if (!status || normForm(status) !== STATUS_VALIDO_NORM) { ignoredStatus++; continue; }
      if (!forma || !FORMAS_AUDITAVEIS_NORM.has(normForm(forma))) { ignoredForma++; continue; }

      const createdAt = toIsoDateTime(rawCreatedAt);
      const saleDate = toIsoDate(rawCreatedAt);
      if (!saleDate) { skippedNoDate++; continue; }
      allDates.push(saleDate);

      orders.push({
        audit_period_id,
        import_id: importRec.id,
        order_id: orderId,
        created_at_remote: createdAt ?? saleDate,
        sale_date: saleDate,
        forma_pagamento: forma,
        payment_method: toStr(r[COL.payment_method]),
        total: toNum(r[COL.total]),
        taxa_entrega: toNum(r[COL.taxa_entrega]),
        desconto_entrega: toNum(r[COL.desconto_entrega]),
        cashback_usado: toNum(r[COL.cashback]),
        cliente_nome: toStr(r[COL.nome]),
        cliente_telefone: toStr(r[COL.telefone]),
        endereco: toStr(r[COL.endereco]),
        cupom: toBool(r[COL.cupom]),
        status_remote: status,
      });
    }

    // Brendi precisa dos 3 meses (ant + comp + post) no mesmo período pra cobrir
    // D+1 entre meses (ex: vendas 28/02 caem em 02/03; vendas 31/01 caem em 02/02).
    // Não bloqueia por mês — confia no sale_date pra filtrar downstream.
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
        .from('audit_brendi_orders')
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
      ignored_forma: ignoredForma,
      skipped_no_id: skippedNoId,
      skipped_no_date: skippedNoDate,
      seen_statuses: Object.fromEntries(seenStatuses),
      seen_formas: Object.fromEntries(seenFormas),
      sample_created_at: sampleCreatedAt,
      breakdown_by_month: breakdownByMonth,
      message: `${inserted} pedidos online Brendi importados (${ignoredStatus} não-entregue, ${ignoredForma} forma fora de escopo, ${skippedNoDate} sem data)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-brendi-xlsx error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
