// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, parseMoney, parseDateBR, jsonResponse } from '../_shared/voucher-utils.ts';

// Recebe rows como array de arrays (header já incluído).
// Procura header "Número Guia" e processa linhas até "Valor Total".
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { audit_period_id, file_name, rows } = await req.json();
    if (!audit_period_id || !Array.isArray(rows)) {
      return jsonResponse({ error: 'audit_period_id e rows são obrigatórios' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: period } = await supabase
      .from('audit_periods')
      .select('month, year')
      .eq('id', audit_period_id)
      .maybeSingle();
    if (!period) return jsonResponse({ error: 'Período não encontrado' }, 404);
    const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1));
    const periodEnd = new Date(Date.UTC(period.year, period.month, 1));
    const isInPeriod = (d: string | null): boolean => {
      if (!d) return false;
      const dt = new Date(d + 'T00:00:00Z');
      return dt >= periodStart && dt < periodEnd;
    };

    // Encontrar header
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i] ?? [];
      if (r.some((c: any) => String(c ?? '').includes('Número Guia') || String(c ?? '').includes('Numero Guia'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return jsonResponse({ error: 'VR: cabeçalho "Número Guia" não encontrado' }, 400);

    // VR não tem voucher_lot_items — apenas lotes. Faremos UPSERT por external_id.
    let importedLots = 0;
    const lotsToInsert: any[] = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const numero = String(row[0] ?? '').trim();
      if (!numero) continue;
      if (numero.startsWith('Valor Total')) break;

      const modalidade = String(row[1] ?? '').trim() || null;
      const status = String(row[3] ?? '').trim();
      const dataCorte = parseDateBR(row[4]);
      const dataPag = parseDateBR(row[5]);
      const bruto = parseMoney(row[6]);
      const liquido = parseMoney(row[7]);
      if (!dataPag || bruto <= 0) continue;
      if (!isInPeriod(dataPag)) continue;

      const isAntecipado = status.includes('Antecipado');
      let feeAdmin = 0;
      let feeAntecip = 0;

      if (isAntecipado) {
        const m = (modalidade || '').toLowerCase();
        let pct = 0.063;
        if (m.includes('refeição pat') || m.includes('refeicao pat')) pct = 0.036;
        else if (m.includes('alimentação pat') || m.includes('alimentacao pat')) pct = 0.036;
        else if (m.includes('auxílio refeição') || m.includes('auxilio refeicao')) pct = 0.063;
        else if (m.includes('auxílio alimentação') || m.includes('auxilio alimentacao')) pct = 0.063;
        feeAdmin = bruto * pct;
        feeAntecip = (bruto - liquido) - feeAdmin;
        if (feeAntecip < 0) {
          feeAntecip = 0;
          feeAdmin = bruto - liquido;
        }
      } else {
        feeAdmin = bruto - liquido;
        feeAntecip = 0;
      }

      lotsToInsert.push({
        audit_period_id,
        operadora: 'vr',
        external_id: `vr_${numero}`,
        data_corte: dataCorte,
        data_pagamento: dataPag,
        gross_amount: bruto,
        net_amount: liquido,
        fee_admin: Math.max(feeAdmin, 0),
        fee_anticipation: Math.max(feeAntecip, 0),
        fee_management: 0,
        fee_other: 0,
        modalidade,
        status: 'imported',
        raw_data: { status_original: status, contrato: row[2] ?? null },
      });
    }

    if (lotsToInsert.length > 0) {
      // UPSERT em batches por (audit_period_id, operadora, external_id)
      const batchSize = 200;
      for (let i = 0; i < lotsToInsert.length; i += batchSize) {
        const batch = lotsToInsert.slice(i, i + batchSize);
        const { error } = await supabase
          .from('voucher_lots')
          .upsert(batch, { onConflict: 'audit_period_id,operadora,external_id' });
        if (error) {
          console.error('Erro upsert batch VR', error);
        } else {
          importedLots += batch.length;
        }
      }
    }

    await supabase.from('voucher_imports').insert({
      audit_period_id,
      operadora: 'vr',
      file_name: file_name || 'vr.xls',
      imported_lots: importedLots,
      imported_items: 0,
      imported_adjustments: 0,
      status: 'completed',
    });

    return jsonResponse({
      success: true,
      imported_lots: importedLots,
      imported_items: 0,
      imported_adjustments: 0,
    });
  } catch (e: any) {
    console.error('import-voucher-vr error', e);
    return jsonResponse({ error: e.message ?? 'Erro interno' }, 500);
  }
});
