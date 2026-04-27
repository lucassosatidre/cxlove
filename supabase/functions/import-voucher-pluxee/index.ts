// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, parseMoney, parseDateBR, jsonResponse } from '../_shared/voucher-utils.ts';

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

    type Item = {
      data_transacao: string | null;
      gross_amount: number;
      authorization_code?: string;
      card_number?: string;
      modalidade?: string;
    };
    type Lot = {
      external_id: string;
      data_pagamento: string | null;
      gross_amount: number;
      net_amount: number;
      fee_admin: number;
      fee_anticipation: number;
      modalidade: string | null;
      raw_status?: string;
      items: Item[];
    };

    const lots: Lot[] = [];
    let current: Lot | null = null;
    let headerSeen = false;

    for (const rawRow of rows) {
      const row = (rawRow ?? []).map((c: any) => (c == null ? '' : String(c)));
      const c0 = (row[0] || '').trim();
      const c6 = (row[6] || '').trim();
      const c7 = (row[7] || '').trim();
      const c8 = (row[8] || '').trim();

      // Início de novo lote
      if (c0.startsWith('Data de Pagamento:')) {
        if (current) lots.push(current);
        const dataPag = parseDateBR(c0.replace('Data de Pagamento:', '').trim());
        const bruto = parseMoney(c8);
        // Nem todo lote tem gross na linha de início; se vazio, vai aparecer abaixo
        current = {
          external_id: '', // gerado depois
          data_pagamento: dataPag,
          gross_amount: bruto,
          net_amount: 0,
          fee_admin: 0,
          fee_anticipation: 0,
          modalidade: null,
          items: [],
        };
        headerSeen = false;
        continue;
      }
      if (!current) continue;

      if (c0.startsWith('Status:')) {
        current.raw_status = c0.replace('Status:', '').trim();
        continue;
      }

      // TOTAL BRUTO appears in c6 = "TOTAL BRUTO" with value in c8
      if (/total\s+bruto/i.test(c6) && current.gross_amount === 0) {
        current.gross_amount = parseMoney(c8);
        continue;
      }
      // VALOR DEDUZIDO | REEMBOLSO (admin)
      if (/valor\s+deduzido/i.test(c6) && /^reembolso$/i.test(c7)) {
        current.fee_admin = parseMoney(c8);
        continue;
      }
      // REEMBOLSO EXPRESSO (antecipação) — c7
      if (/reembolso\s+expresso/i.test(c7)) {
        current.fee_anticipation = parseMoney(c8);
        continue;
      }
      // TOTAL LÍQUIDO
      if (/total\s+l[ií]quido/i.test(c6)) {
        if (current.net_amount === 0) current.net_amount = parseMoney(c8);
        continue;
      }
      // Cabeçalho de transações
      if (/^cnpj$/i.test(c0) && /raz/i.test(row[1] || '')) {
        headerSeen = true;
        continue;
      }
      // Linha de transação: CNPJ no c0, Origem no c9 (PAT/AUXILIO)
      if (headerSeen && /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(c0)) {
        const dataTrans = parseDateBR(row[2] || '');
        const gross = parseMoney(row[8] || '');
        if (dataTrans && gross > 0) {
          current.items.push({
            data_transacao: dataTrans,
            gross_amount: gross,
            authorization_code: (row[7] || '').trim(),
            card_number: (row[6] || '').trim(),
            modalidade: (row[9] || '').trim(),
          });
        }
      }
    }
    if (current) lots.push(current);

    // Deduplicar por (data_pagamento, gross, net) — Pluxee repete o cabeçalho do lote no fim
    const seen = new Set<string>();
    const uniqueLots: Lot[] = [];
    let idx = 0;
    for (const lot of lots) {
      const key = `${lot.data_pagamento}|${lot.gross_amount.toFixed(2)}|${lot.net_amount.toFixed(2)}|${lot.items.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lot.external_id = `pluxee_${lot.data_pagamento}_${idx}`;
      const mods = lot.items.map(i => i.modalidade).filter(Boolean) as string[];
      const set = new Set(mods);
      lot.modalidade = set.size === 0 ? null : set.size === 1 ? mods[0] : 'MIX';
      uniqueLots.push(lot);
      idx++;
    }

    // Filtrar lotes sem data de pagamento ou fora do período de competência
    const validLots = uniqueLots.filter(l => l.data_pagamento && isInPeriod(l.data_pagamento));

    // UPSERT por (audit_period_id, operadora, external_id). Mantém o ID do lote
    // — preserva bb_deposit_id e qualquer match anterior que aponte pro lote.
    let importedLots = 0;
    let importedItems = 0;

    for (const lot of validLots) {
      const { data: insertedLot, error: lotErr } = await supabase
        .from('voucher_lots')
        .upsert({
          audit_period_id,
          operadora: 'pluxee',
          external_id: lot.external_id,
          data_pagamento: lot.data_pagamento,
          gross_amount: lot.gross_amount,
          net_amount: lot.net_amount,
          fee_admin: lot.fee_admin,
          fee_anticipation: lot.fee_anticipation,
          fee_management: 0,
          fee_other: 0,
          modalidade: lot.modalidade,
          status: 'imported',
          raw_data: { status: lot.raw_status ?? null },
        }, { onConflict: 'audit_period_id,operadora,external_id' })
        .select('id')
        .single();

      if (lotErr) {
        console.error('Erro upsert lote pluxee', lot.external_id, lotErr);
        continue;
      }
      importedLots++;

      // Substitui os items do lote (delete + insert) — items não têm cross-ref
      // crítica; serão recriados pelo próximo match_voucher_lots_v2.
      await supabase.from('voucher_lot_items').delete().eq('lot_id', insertedLot.id);

      if (lot.items.length > 0) {
        const itemRows = lot.items.map(it => ({
          lot_id: insertedLot.id,
          data_transacao: it.data_transacao,
          gross_amount: it.gross_amount,
          authorization_code: it.authorization_code || null,
          card_number: it.card_number || null,
          modalidade: it.modalidade || null,
          match_status: 'pending',
        }));
        const { error: itemErr } = await supabase.from('voucher_lot_items').insert(itemRows);
        if (itemErr) console.error('Erro inserindo items pluxee', itemErr);
        else importedItems += itemRows.length;
      }
    }

    await supabase.from('voucher_imports').insert({
      audit_period_id,
      operadora: 'pluxee',
      file_name: file_name || 'pluxee.csv',
      imported_lots: importedLots,
      imported_items: importedItems,
      imported_adjustments: 0,
      status: 'completed',
    });

    return jsonResponse({
      success: true,
      imported_lots: importedLots,
      imported_items: importedItems,
      imported_adjustments: 0,
    });
  } catch (e: any) {
    console.error('import-voucher-pluxee error', e);
    return jsonResponse({ error: e.message ?? 'Erro interno' }, 500);
  }
});
