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

    // Validação básica do período
    const { data: period } = await supabase
      .from('audit_periods').select('id').eq('id', audit_period_id).maybeSingle();
    if (!period) return jsonResponse({ error: 'Período não encontrado' }, 404);

    type Item = {
      data_transacao: string;
      gross_amount: number;
      authorization_code?: string;
      card_number?: string;
      modalidade?: string | null;
    };
    type Lot = {
      external_id: string;
      data_pagamento: string;
      data_corte: string;
      gross_amount: number;
      net_amount: number;
      fee_admin: number;
      fee_anticipation: number;
      modalidade: string | null;
      raw_status?: string | null;
      items: Item[];
    };

    const TAXA_PLUXEE_ESTIMADA = 0.10; // 10% — usado pra estimar net_amount; BB corrige depois

    // ---- Detectar header do formato NOVO (1 linha = 1 transação, com 'Data de Pagamento') ----
    const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    let headerIdx = -1;
    const cols: Record<string, number> = {};
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const r = rows[i] || [];
      const lower = r.map(norm);
      if (lower.includes('cnpj') && lower.some(c => c.includes('data de pagamento'))) {
        headerIdx = i;
        lower.forEach((c, j) => { if (c) cols[c] = j; });
        break;
      }
    }

    if (headerIdx < 0) {
      return jsonResponse({
        error: 'Pluxee: cabeçalho não encontrado. Esperado linha com "CNPJ" e "Data de Pagamento". Verifique o arquivo (formato esperado: CSV exportado do portal Pluxee em janeiro/2026 ou posterior).',
      }, 400);
    }

    const findCol = (...needles: string[]): number => {
      for (const n of needles) {
        const nn = norm(n);
        const k = Object.keys(cols).find(c => c.includes(nn));
        if (k !== undefined) return cols[k];
      }
      return -1;
    };

    const cDataTrans = findCol('data da transacao');
    const cBruto = findCol('valor bruto');
    const cAuth = findCol('autorizacao', 'autorizaca');
    const cCard = findCol('numero do cartao', 'cartao');
    const cDataPag = findCol('data de pagamento');
    const cOrigem = findCol('origem');

    if (cDataTrans < 0 || cBruto < 0 || cDataPag < 0) {
      return jsonResponse({
        error: `Pluxee: colunas obrigatórias não encontradas (DataTransação=${cDataTrans}, ValorBruto=${cBruto}, DataPagamento=${cDataPag}).`,
      }, 400);
    }

    // ---- Agrupar transações por Data de Pagamento (cada grupo vira 1 lote) ----
    const lotsByPagto = new Map<string, Lot>();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const cnpj = String(r[0] ?? '').trim();
      // Filtra linhas de transação: CNPJ formatado XX.XXX.XXX/XXXX-XX
      if (!cnpj.match(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)) continue;

      const dtTrans = parseDateBR(r[cDataTrans]);
      const dtPag = parseDateBR(r[cDataPag]);
      const bruto = parseMoney(r[cBruto]);
      if (!dtTrans || !dtPag || bruto <= 0) continue;

      const auth = cAuth >= 0 ? String(r[cAuth] ?? '').trim() : '';
      const card = cCard >= 0 ? String(r[cCard] ?? '').trim() : '';
      const origem = cOrigem >= 0 ? String(r[cOrigem] ?? '').trim() : null;

      if (!lotsByPagto.has(dtPag)) {
        lotsByPagto.set(dtPag, {
          external_id: `pluxee_${dtPag}`,
          data_pagamento: dtPag,
          data_corte: dtTrans,
          gross_amount: 0,
          net_amount: 0,
          fee_admin: 0,
          fee_anticipation: 0,
          modalidade: null,
          items: [],
        });
      }
      const lot = lotsByPagto.get(dtPag)!;
      lot.items.push({
        data_transacao: dtTrans,
        gross_amount: bruto,
        authorization_code: auth || undefined,
        card_number: card || undefined,
        modalidade: origem,
      });
      lot.gross_amount += bruto;
      if (dtTrans < lot.data_corte) lot.data_corte = dtTrans;
    }

    // Estimar net + atribuir modalidade dominante
    for (const lot of lotsByPagto.values()) {
      lot.net_amount = +(lot.gross_amount * (1 - TAXA_PLUXEE_ESTIMADA)).toFixed(2);
      lot.fee_admin = +(lot.gross_amount - lot.net_amount).toFixed(2);
      const mods = lot.items.map(i => i.modalidade).filter(Boolean) as string[];
      const set = new Set(mods);
      lot.modalidade = set.size === 0 ? null : set.size === 1 ? mods[0] : 'MIX';
    }

    // Aceita todos os lotes (sem filtro por período — competência fica na auditoria)
    const validLots = Array.from(lotsByPagto.values());

    // Validação anti-falso-sucesso
    if (rows.length > 5 && validLots.length === 0) {
      return jsonResponse({
        error: `Pluxee: arquivo tem ${rows.length} linhas mas nenhum lote foi identificado. Verifique se o formato corresponde ao novo extrato (com colunas "CNPJ" e "Data de Pagamento").`,
      }, 422);
    }

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
          data_corte: lot.data_corte,
          gross_amount: lot.gross_amount,
          net_amount: lot.net_amount,
          fee_admin: lot.fee_admin,
          fee_anticipation: lot.fee_anticipation,
          fee_management: 0,
          fee_other: 0,
          modalidade: lot.modalidade,
          status: 'imported',
          raw_data: { status: lot.raw_status ?? null, items_count: lot.items.length, estimated_net: true },
        }, { onConflict: 'audit_period_id,operadora,external_id' })
        .select('id')
        .single();

      if (lotErr) {
        console.error('Erro upsert lote pluxee', lot.external_id, lotErr);
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
