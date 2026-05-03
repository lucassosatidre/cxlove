// @ts-nocheck
// Importa CSV "Auditoria iFood" (per-dia, pré-conciliado pelo iFood Portal).
// Formato ;-separado, 8 colunas:
// Data;Vendas;Bruto;Taxa iFood;Liq Esperado;Depositado;Diferença;Status
//
// O arquivo já vem com Depositado e Diferença calculados pelo iFood. Salvamos
// como `ifood_declarado_*` no audit_ifood_marketplace_daily — o match-ifood
// depois compara contra audit_bank_deposits (Cresol) e a agregação de
// audit_ifood_marketplace_orders pra cross-check completo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const brt = new Date(v.getTime() - 3 * 60 * 60 * 1000);
    return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNum(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[R$\s]/gi, '');
  if (!s) return 0;
  // Aceita "-32.04" (US), "-32,04" (BR), "1.385,00" (BR-thousands)
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot === -1 && lastComma === -1) return Number(s) || 0;
  const decimalSep = lastDot > lastComma ? '.' : ',';
  const thousandSep = decimalSep === '.' ? ',' : '.';
  s = s.split(thousandSep).join('').replace(decimalSep, '.');
  return Number(s) || 0;
}

function toStr(v: any): string | null {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

function toInt(v: any): number {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
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
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes' }), {
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
      return new Response(JSON.stringify({ error: 'Período fechado.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Header detection: Data + Bruto + Depositado nas primeiras 5 linhas
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => String(c ?? '').toLowerCase().trim());
      const hasData = cells.some(c => c === 'data' || c.includes('data'));
      const hasDepositado = cells.some(c => c.includes('depositado'));
      if (hasData && hasDepositado) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header iFood Auditoria não encontrado. Esperado: "Data" e "Depositado".',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const COL = {
      data: 0, vendas: 1, bruto: 2, taxa: 3, liq_esperado: 4,
      depositado: 5, diferenca: 6, status: 7,
    };

    const dataRows = rows.slice(headerIdx + 1).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
    const totalRows = dataRows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'ifood_daily',
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

    const dailies: any[] = [];
    let skippedNoDate = 0;

    for (const r of dataRows) {
      const saleDate = toIsoDate(r[COL.data]);
      if (!saleDate) { skippedNoDate++; continue; }

      dailies.push({
        audit_period_id,
        sale_date: saleDate,
        ifood_declarado_vendas: toInt(r[COL.vendas]),
        ifood_declarado_bruto: toNum(r[COL.bruto]),
        ifood_declarado_taxa: toNum(r[COL.taxa]),
        ifood_declarado_liq_esperado: toNum(r[COL.liq_esperado]),
        ifood_declarado_depositado: toNum(r[COL.depositado]),
        ifood_declarado_diferenca: toNum(r[COL.diferenca]),
        ifood_declarado_status: toStr(r[COL.status]),
      });
    }

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < dailies.length; i += CHUNK) {
      const chunk = dailies.slice(i, i + CHUNK);
      // Upsert preservando os campos calc/cresol já populados pelo match-ifood
      // (não sobrescreve liquido_calc/bruto_calc/cresol_received). Inserimos
      // só os campos ifood_declarado_*.
      const { error: insErr } = await supabase
        .from('audit_ifood_marketplace_daily')
        .upsert(chunk, {
          onConflict: 'audit_period_id,sale_date',
          ignoreDuplicates: false,
        });
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
      skipped_no_date: skippedNoDate,
      message: `${inserted} dias iFood Auditoria importados.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-ifood-daily error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
