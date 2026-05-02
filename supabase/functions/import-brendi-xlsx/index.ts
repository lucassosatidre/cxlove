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
import { validatePeriodMatch } from '../_shared/period-validator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const FORMAS_AUDITAVEIS = new Set(['Pix Online', 'Crédito Online']);

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
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function toIsoDateTime(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  // ISO já vem
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
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

    for (const r of dataRows) {
      const orderId = toStr(r[COL.order_id]);
      const status = toStr(r[COL.status]);
      const forma = toStr(r[COL.forma_pagamento]);

      if (!orderId) { skippedNoId++; continue; }
      if (status !== 'Entregue') { ignoredStatus++; continue; }
      if (!forma || !FORMAS_AUDITAVEIS.has(forma)) { ignoredForma++; continue; }

      const createdAt = toIsoDateTime(r[COL.created_at]);
      const saleDate = toIsoDate(r[COL.created_at]);
      if (!saleDate) { skippedNoId++; continue; }
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

    // Validador competência (referência: sale_date)
    const periodCheck = validatePeriodMatch(allDates, { month: period.month, year: period.year }, 'Brendi');
    if (!periodCheck.ok) {
      await supabase.from('audit_imports').update({
        status: 'failed', error_message: periodCheck.error,
      }).eq('id', importRec.id);
      return new Response(JSON.stringify({
        error: periodCheck.error,
        breakdown_by_month: periodCheck.breakdown,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      message: `${inserted} pedidos online Brendi importados (${ignoredStatus} não-entregue, ${ignoredForma} forma fora de escopo)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-brendi-xlsx error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
