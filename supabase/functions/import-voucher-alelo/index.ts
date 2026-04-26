// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, parseMoney, parseDateBR, jsonResponse } from '../_shared/voucher-utils.ts';

// Recebe { audit_period_id, file_name, recebimentos: [{...obj}], outras: [{...obj}] }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { audit_period_id, file_name, recebimentos = [], outras = [] } = await req.json();
    if (!audit_period_id) return jsonResponse({ error: 'audit_period_id obrigatório' }, 400);

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

    // Limpar dados anteriores
    await supabase.from('voucher_lots').delete()
      .eq('audit_period_id', audit_period_id).eq('operadora', 'alelo');
    await supabase.from('voucher_adjustments').delete()
      .eq('audit_period_id', audit_period_id).eq('operadora', 'alelo');

    let importedLots = 0;
    let importedItems = 0;

    for (const row of recebimentos) {
      if (String(row['Status'] || '').trim() !== 'Aprovada') continue;
      const numTrans = String(row['Nº da Transação'] || row['N° da Transação'] || row['No da Transação'] || '').trim();
      if (!numTrans) continue;
      const bruto = parseMoney(row['Valor Bruto']);
      const liquido = parseMoney(row['Valor Líquido'] ?? row['Valor Liquido']);
      const dataVenda = parseDateBR(row['Data da Venda']);
      const dataPag = parseDateBR(row['Data de Pagamento']);
      if (!dataPag) continue;
      if (!isInPeriod(dataPag)) continue;

      const externalId = `alelo_${numTrans}`;
      const modalidade = String(row['Tipo Cartão'] || row['Tipo Cartao'] || '').trim() || null;

      const { data: insertedLot, error: lotErr } = await supabase.from('voucher_lots').insert({
        audit_period_id,
        operadora: 'alelo',
        external_id: externalId,
        data_corte: dataVenda,
        data_pagamento: dataPag,
        gross_amount: bruto,
        net_amount: liquido,
        fee_admin: Math.max(bruto - liquido, 0),
        fee_anticipation: 0,
        fee_management: 0,
        fee_other: 0,
        modalidade,
        status: 'imported',
        raw_data: { status: row['Status'] ?? null, autorizacao: row['Nº da Autorização'] ?? null },
      }).select('id').single();

      if (lotErr) {
        console.error('Erro inserindo lote alelo', externalId, lotErr);
        continue;
      }
      importedLots++;

      const dataTrans = parseDateBR(row['Data da Venda']);
      if (dataTrans && bruto > 0) {
        const { error: itemErr } = await supabase.from('voucher_lot_items').insert({
          lot_id: insertedLot.id,
          data_transacao: dataTrans,
          gross_amount: bruto,
          net_amount: liquido,
          authorization_code: String(row['Nº da Autorização'] || '').trim() || null,
          card_number: String(row['Nº Cartão'] || row['No Cartão'] || '').trim() || null,
          modalidade,
          match_status: 'pending',
        });
        if (itemErr) console.error('Erro inserindo item alelo', itemErr);
        else importedItems++;
      }
    }

    // ---- Adjustments com detecção de pares simétricos (compensacao_neutra) ----
    type AdjRaw = {
      data: string | null;
      ec: string;
      descricao: string;
      valor: number;
      modalidade: string;
      tipo: string;
    };
    const adjs: AdjRaw[] = [];
    for (const row of outras) {
      const data = parseDateBR(row['Data do Débito'] ?? row['Data do Debito'] ?? row['Data de Pagamento']);
      if (!data) continue;
      if (!isInPeriod(data)) continue;
      const desc = String(row['Descrição'] || row['Descricao'] || '').trim();
      const valor = parseMoney(row['Valor']);
      const ec = String(row['EC da Transação'] || row['EC da Transacao'] || row['N° Do EC'] || row['No Do EC'] || '').trim();
      const modalidade = String(row['Tipo Cartão'] || row['Tipo Cartao'] || '').trim();
      const dl = desc.toLowerCase();
      let tipo = 'outro';
      if (dl.includes('anuidade')) tipo = 'anuidade';
      else if (dl.includes('mensalidade')) tipo = 'mensalidade';
      else if (dl.includes('tor')) tipo = 'tor';
      else if (dl.includes('compensa')) tipo = 'compensacao';
      else if (dl.includes('tarifa')) tipo = 'tarifa';
      adjs.push({ data, ec, descricao: desc, valor, modalidade, tipo });
    }

    // Detectar pares simétricos para compensações
    const used = new Set<number>();
    for (let i = 0; i < adjs.length; i++) {
      if (used.has(i)) continue;
      const a = adjs[i];
      if (a.tipo !== 'compensacao') continue;
      for (let j = i + 1; j < adjs.length; j++) {
        if (used.has(j)) continue;
        const b = adjs[j];
        if (b.tipo !== 'compensacao') continue;
        if (a.data === b.data
            && a.ec === b.ec
            && Math.abs(a.valor + b.valor) < 0.01
            && a.modalidade !== b.modalidade) {
          a.tipo = 'compensacao_neutra';
          b.tipo = 'compensacao_neutra';
          used.add(i);
          used.add(j);
          break;
        }
      }
    }

    let importedAdjs = 0;
    if (adjs.length > 0) {
      const adjRows = adjs.map(a => ({
        audit_period_id,
        operadora: 'alelo',
        data: a.data,
        descricao: a.descricao,
        valor: a.valor,
        tipo: a.tipo,
      }));
      const { error: adjErr } = await supabase.from('voucher_adjustments').insert(adjRows);
      if (adjErr) console.error('Erro inserindo adjustments alelo', adjErr);
      else importedAdjs = adjRows.length;
    }

    await supabase.from('voucher_imports').insert({
      audit_period_id,
      operadora: 'alelo',
      file_name: file_name || 'alelo.xlsx',
      imported_lots: importedLots,
      imported_items: importedItems,
      imported_adjustments: importedAdjs,
      status: 'completed',
    });

    return jsonResponse({
      success: true,
      imported_lots: importedLots,
      imported_items: importedItems,
      imported_adjustments: importedAdjs,
    });
  } catch (e: any) {
    console.error('import-voucher-alelo error', e);
    return jsonResponse({ error: e.message ?? 'Erro interno' }, 500);
  }
});
