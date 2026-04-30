// @ts-nocheck
// Recebe rows pré-parseadas do XLS "Guias de Reembolso" da VR (frontend usa
// xlsx.js pra extrair). Cada GUIA é um lote (= 1 crédito BB esperado).
//
// Layout aba "Guias de Reembolso" (validado em
// extrato_reembolsos_vr_2026-02-01_a_2026-03-31.xls):
//   Header em linha que tem "Número Guia" + "Valor Bruto"
//   Col 0=Número Guia  1=Produto  2=Contrato  3=Status  4=Corte  5=Pagamento
//   6=Valor Bruto  7=Valor Líquido
//
// Diferenças vs Ticket/Alelo:
//   - Não há item-level breakdown no XLS de reembolsos (cada lote é 1 linha
//     sem detalhes das vendas individuais). Criamos 1 lot_item sintético
//     "agregado" com data_transacao = data_corte e valor = bruto pra manter
//     integridade do schema e permitir cross-check no nível agregado.
//   - Filtra status que comecem com "Pago" (Pago Antecipado, Pago, etc).

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
    const adjusted = new Date(v.getTime() - 3 * 3600 * 1000);
    return `${adjusted.getUTCFullYear()}-${String(adjusted.getUTCMonth() + 1).padStart(2, '0')}-${String(adjusted.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const isoDt = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDt) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const adjusted = new Date(d.getTime() - 3 * 3600 * 1000);
      return `${adjusted.getUTCFullYear()}-${String(adjusted.getUTCMonth() + 1).padStart(2, '0')}-${String(adjusted.getUTCDate()).padStart(2, '0')}`;
    }
  }
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function toNumber(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
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
      .from('audit_periods').select('id,status').eq('id', audit_period_id).maybeSingle();
    if (periodErr || !period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (period.status === 'fechado') {
      return new Response(JSON.stringify({ error: 'Período fechado. Reabra antes de adicionar extratos.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const wasConciliado = period.status === 'conciliado';

    // Detecta linha de header (procura "Número Guia" + "Valor Bruto" em até 25 linhas)
    let headerIdx = -1;
    let colMap: Record<string, number> = {};
    function normalizeKey(s: string): string {
      return String(s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
    }
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i];
      if (!Array.isArray(r)) continue;
      const norm = r.map(normalizeKey);
      const hasGuia = norm.some(c => c.includes('numero guia') || c.includes('número guia') || c === 'guia' || c.startsWith('numero g'));
      const hasBruto = norm.some(c => c.includes('valor bruto'));
      if (hasGuia && hasBruto) {
        headerIdx = i;
        for (let j = 0; j < r.length; j++) {
          const k = normalizeKey(r[j]);
          if (k.includes('numero guia') || k === 'guia') colMap.guia = j;
          else if (k === 'produto') colMap.produto = j;
          else if (k === 'contrato') colMap.contrato = j;
          else if (k === 'status') colMap.status = j;
          else if (k === 'corte' || k.startsWith('corte')) colMap.corte = j;
          else if (k === 'pagamento' || k.startsWith('pagamento')) colMap.pagamento = j;
          else if (k === 'valor bruto') colMap.bruto = j;
          else if (k === 'valor liquido' || k === 'valor líquido') colMap.liquido = j;
        }
        break;
      }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header não encontrado. Esperado linhas com "Número Guia" e "Valor Bruto" entre as 25 primeiras.',
        diagnostic: { total_rows: rows.length, first_5_rows: rows.slice(0, 5) },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (colMap.guia == null || colMap.bruto == null || colMap.liquido == null || colMap.pagamento == null) {
      return new Response(JSON.stringify({
        error: `Colunas obrigatórias faltando. Encontrei: ${JSON.stringify(colMap)}. Header: ${JSON.stringify(rows[headerIdx])}`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    type RawLot = {
      guia: string; produto: string; contrato: string;
      data_corte: string | null; data_pagamento: string;
      bruto: number; liquido: number;
    };
    const lots: RawLot[] = [];
    let skippedNonPago = 0;
    let skippedInvalid = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r) || r.every((c: any) => c == null || c === '')) continue;
      // Pula linha "Valor Total" (rodapé)
      const c5 = String(r[5] ?? '').toLowerCase().trim();
      if (c5.includes('valor total') || String(r[colMap.guia] ?? '').toLowerCase().includes('total')) continue;

      const status = String(r[colMap.status] ?? '').trim();
      // Aceita "Pago", "Pago (Antecipado)", "Pago Antecipado", etc
      if (!status.toLowerCase().startsWith('pago')) {
        skippedNonPago++;
        continue;
      }

      const guia = String(r[colMap.guia] ?? '').trim();
      const dataPag = toIsoDate(r[colMap.pagamento]);
      const bruto = toNumber(r[colMap.bruto]);
      const liquido = toNumber(r[colMap.liquido]);
      if (!guia || !dataPag || bruto == null || liquido == null) {
        skippedInvalid++;
        continue;
      }
      lots.push({
        guia,
        produto: String(r[colMap.produto] ?? '').trim() || 'VR',
        contrato: String(r[colMap.contrato] ?? '').trim(),
        data_corte: colMap.corte != null ? toIsoDate(r[colMap.corte]) : null,
        data_pagamento: dataPag,
        bruto, liquido,
      });
    }

    if (lots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote VR pago encontrado no arquivo.',
        diagnostic: { skipped_non_pago: skippedNonPago, skipped_invalid: skippedInvalid },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'vr', file_name,
        total_rows: lots.length, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar importação: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let insertedLots = 0;
    let updatedLots = 0;
    const insertedItems = 0;

    for (const lot of lots) {
      const totalDesc = Math.round((lot.bruto - lot.liquido) * 100) / 100;
      const { data: existing } = await supabase
        .from('audit_voucher_lots')
        .select('id')
        .eq('audit_period_id', audit_period_id)
        .eq('operadora', 'vr')
        .eq('numero_reembolso', lot.guia)
        .maybeSingle();

      const lotPayload = {
        audit_period_id, operadora: 'vr',
        numero_reembolso: lot.guia,
        numero_contrato: lot.contrato || null,
        produto: lot.produto,
        data_corte: lot.data_corte,
        data_credito: lot.data_pagamento,
        subtotal_vendas: Math.round(lot.bruto * 100) / 100,
        total_descontos: totalDesc,
        valor_liquido: Math.round(lot.liquido * 100) / 100,
        descontos: { taxa_vr: totalDesc },
        import_id: importRec.id,
      };

      let lotId: string;
      if (existing) {
        const { error: updErr } = await supabase
          .from('audit_voucher_lots').update(lotPayload).eq('id', existing.id);
        if (updErr) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao atualizar lote ${lot.guia}: ${updErr.message}`,
          }).eq('id', importRec.id);
          throw updErr;
        }
        await supabase.from('audit_voucher_lot_items').delete().eq('lot_id', existing.id);
        lotId = existing.id;
        updatedLots++;
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('audit_voucher_lots').insert(lotPayload).select('id').single();
        if (insErr || !ins) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao inserir lote ${lot.guia}: ${insErr?.message ?? 'sem dado'}`,
          }).eq('id', importRec.id);
          throw insErr ?? new Error('falha insert lote');
        }
        lotId = ins.id;
        insertedLots++;
      }

      // Não criamos mais item agregado sintético. Vendas individuais virão
      // pelo upload do extrato_vendas_vr (edge import-vr-vendas-xls), que
      // vincula cada venda real ao lote correto baseado em produto+data_corte.
      // Lote sem items vinculados é normal até o user importar o vendas.xls.
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: insertedItems, duplicate_rows: 0,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    } else if (wasConciliado) {
      await supabase.from('audit_periods')
        .update({ status: 'importado', updated_at: new Date().toISOString() })
        .eq('id', audit_period_id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_lots: lots.length,
      inserted_lots: insertedLots,
      updated_lots: updatedLots,
      inserted_items: insertedItems,
      skipped_non_pago: skippedNonPago,
      skipped_invalid: skippedInvalid,
      message: `${insertedLots} lotes novos + ${updatedLots} atualizados`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-vr-xls error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
