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
      .from('audit_periods').select('id').eq('id', audit_period_id).maybeSingle();
    if (!period) return jsonResponse({ error: 'Período não encontrado' }, 404);

    const TAXA_VR_AUXILIO = 0.063; // 6,3%
    const TAXA_VR_PAT = 0.036;     // 3,6%

    // ---- Detectar header NOVO (Relatório de Transação de Venda): 'Número Autorização' ----
    const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    let headerIdx = -1;
    const cols: Record<string, number> = {};
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const r = rows[i] || [];
      const lower = r.map(norm);
      if (lower.some(c => c.includes('numero autorizacao')) && lower.some(c => c === 'data')) {
        headerIdx = i;
        lower.forEach((c, j) => { if (c) cols[c] = j; });
        break;
      }
    }

    if (headerIdx < 0) {
      return jsonResponse({
        error: 'VR: cabeçalho não encontrado. Esperado linha com "Número Autorização" e "Data" (formato Relatório de Transação de Venda).',
      }, 400);
    }

    const findCol = (...needles: string[]): number => {
      for (const n of needles) {
        const nn = norm(n);
        const k = Object.keys(cols).find(c => c.includes(nn) || c === nn);
        if (k !== undefined) return cols[k];
      }
      return -1;
    };

    const cData = findCol('data');
    const cValor = findCol('valor');
    const cProduto = findCol('produto');
    const cAuth = findCol('numero autorizacao');
    const cCard = findCol('cartao');

    if (cData < 0 || cValor < 0) {
      return jsonResponse({ error: 'VR: colunas obrigatórias (Data, Valor) não encontradas.' }, 400);
    }

    type Item = { data_transacao: string; gross_amount: number; authorization_code?: string; card_number?: string; modalidade: string | null; };
    type Lot = {
      external_id: string;
      data_corte: string;
      data_pagamento: string;
      gross_amount: number;
      net_amount: number;
      fee_admin: number;
      fee_anticipation: number;
      modalidade: string | null;
      items: Item[];
    };

    const lotsByDia = new Map<string, Lot>();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const cnpj = String(r[0] ?? '').trim();
      // Filtra linha de transação por CNPJ numérico (14 dígitos sem pontuação)
      if (!cnpj.match(/^\d{14}$/)) {
        const c5 = String(r[5] ?? '').toLowerCase();
        if (c5.includes('valor total')) break;
        continue;
      }

      const dt = parseDateBR(r[cData]);
      const valor = parseMoney(r[cValor]);
      if (!dt || valor <= 0) continue;

      const produto = cProduto >= 0 ? String(r[cProduto] ?? '').trim() : '';
      const auth = cAuth >= 0 ? String(r[cAuth] ?? '').trim() : '';
      const card = cCard >= 0 ? String(r[cCard] ?? '').trim() : '';

      // Pagamento estimado: D+1
      const dtPag = new Date(dt + 'T00:00:00Z');
      dtPag.setUTCDate(dtPag.getUTCDate() + 1);
      const dataPag = dtPag.toISOString().substring(0, 10);

      const key = dt;
      if (!lotsByDia.has(key)) {
        lotsByDia.set(key, {
          external_id: `vr_${dt}`,
          data_corte: dt,
          data_pagamento: dataPag,
          gross_amount: 0,
          net_amount: 0,
          fee_admin: 0,
          fee_anticipation: 0,
          modalidade: null,
          items: [],
        });
      }
      const lot = lotsByDia.get(key)!;
      lot.items.push({
        data_transacao: dt,
        gross_amount: valor,
        authorization_code: auth || undefined,
        card_number: card || undefined,
        modalidade: produto || null,
      });
      lot.gross_amount += valor;
    }

    // Estimar net por lote: usa taxa de cada item conforme Auxílio/PAT
    for (const lot of lotsByDia.values()) {
      let netSum = 0;
      const mods = new Set<string>();
      for (const it of lot.items) {
        const mod = (it.modalidade || '').toLowerCase();
        const taxa = mod.includes('pat') ? TAXA_VR_PAT : TAXA_VR_AUXILIO;
        netSum += it.gross_amount * (1 - taxa);
        if (it.modalidade) mods.add(it.modalidade);
      }
      lot.net_amount = +netSum.toFixed(2);
      lot.fee_admin = +(lot.gross_amount - lot.net_amount).toFixed(2);
      lot.modalidade = mods.size === 0 ? null : mods.size === 1 ? [...mods][0] : 'MIX';
    }

    const validLots = Array.from(lotsByDia.values());

    if (rows.length > 5 && validLots.length === 0) {
      return jsonResponse({
        error: `VR: arquivo tem ${rows.length} linhas mas nenhum lote foi identificado. Verifique o formato (Relatório de Transação de Venda).`,
      }, 422);
    }

    let importedLots = 0;
    let importedItems = 0;

    for (const lot of validLots) {
      const { data: insertedLot, error: lotErr } = await supabase
        .from('voucher_lots')
        .upsert({
          audit_period_id,
          operadora: 'vr',
          external_id: lot.external_id,
          data_corte: lot.data_corte,
          data_pagamento: lot.data_pagamento,
          gross_amount: lot.gross_amount,
          net_amount: lot.net_amount,
          fee_admin: lot.fee_admin,
          fee_anticipation: 0,
          fee_management: 0,
          fee_other: 0,
          modalidade: lot.modalidade,
          status: 'imported',
          raw_data: { items_count: lot.items.length, estimated_net: true },
        }, { onConflict: 'audit_period_id,operadora,external_id' })
        .select('id').single();
      if (lotErr) {
        console.error('Erro upsert lote VR', lot.external_id, lotErr);
        continue;
      }
      importedLots++;

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
        if (!itemErr) importedItems += itemRows.length;
      }
    }

    await supabase.from('voucher_imports').insert({
      audit_period_id,
      operadora: 'vr',
      file_name: file_name || 'vr.xls',
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
    console.error('import-voucher-vr error', e);
    return jsonResponse({ error: e.message ?? 'Erro interno' }, 500);
  }
});
