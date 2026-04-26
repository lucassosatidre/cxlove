// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, parseMoney, parseDateBR, jsonResponse } from '../_shared/voucher-utils.ts';

// Recebe { audit_period_id, file_name, recebimentos_rows: any[][], outras_rows: any[][] }
// Faz busca dinâmica do header em cada aba (linhas de título/branding antes do header real).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { audit_period_id, file_name } = body;
    const recebimentosRows: any[][] = body.recebimentos_rows ?? [];
    const outrasRows: any[][] = body.outras_rows ?? [];

    console.log('[ALELO] recebimentos_rows.length =', recebimentosRows.length);
    console.log('[ALELO] outras_rows.length =', outrasRows.length);
    console.log('[ALELO] primeiras 3 linhas recebimentos =', JSON.stringify(recebimentosRows.slice(0, 3)));

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
    console.log('[ALELO] period =', JSON.stringify(period));

    const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1));
    const periodEnd = new Date(Date.UTC(period.year, period.month, 1));
    const isInPeriod = (d: string | null): boolean => {
      if (!d) return false;
      const dt = new Date(d + 'T00:00:00Z');
      return dt >= periodStart && dt < periodEnd;
    };

    // ---- Localiza header dinamicamente ----
    const norm = (s: any) =>
      String(s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const findHeader = (rows: any[][], required: string[]): { headerIdx: number; idx: Record<string, number> } | null => {
      for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const r = rows[i] ?? [];
        const cells = r.map(norm);
        const hasAll = required.every(req => cells.some(c => c.includes(req)));
        if (hasAll) {
          const idx: Record<string, number> = {};
          cells.forEach((c, j) => { if (c) idx[c] = j; });
          return { headerIdx: i, idx };
        }
      }
      return null;
    };

    const findCol = (idx: Record<string, number>, ...needles: string[]): number => {
      for (const n of needles) {
        const nn = norm(n);
        for (const k of Object.keys(idx)) {
          if (k.includes(nn)) return idx[k];
        }
      }
      return -1;
    };

    // ---- Recebimentos ----
    // O XLSX da Alelo pode vir SEM cabeçalho (dados puros desde a linha 0)
    // OU com cabeçalho. Tentamos os dois caminhos.
    const recHeader = findHeader(recebimentosRows, ['status', 'valor bruto', 'transacao']);

    // Layout posicional fixo do Alelo (sem header):
    // 0:CNPJ 1:NºEC 2:RazãoSocial 3:NºEC 4:DataVenda 5:HoraVenda
    // 6:NºAutorização 7:NºTransação 8:TipoCartão 9:NºCartão 10:Adquirente
    // 11:ValorBruto 12:ValorLíquido 13:Status 14:DataPagamento
    const POS = {
      dataVenda: 4, numAutorizacao: 6, numTrans: 7, tipoCartao: 8,
      numCartao: 9, bruto: 11, liquido: 12, status: 13, dataPag: 14,
    };

    // Detecta se uma linha "parece" um registro Alelo posicional (status válido + datas).
    const looksLikePositional = (row: any[]): boolean => {
      if (!row || row.length < 15) return false;
      const status = String(row[POS.status] ?? '').trim();
      if (status !== 'Aprovada' && status !== 'Rejeitada' && status !== 'Cancelada') return false;
      const dv = parseDateBR(row[POS.dataVenda]);
      const dp = parseDateBR(row[POS.dataPag]);
      return !!(dv && dp);
    };

    const usePositional = !recHeader && recebimentosRows.length > 0 && looksLikePositional(recebimentosRows[0]);

    if (recebimentosRows.length > 0 && !recHeader && !usePositional) {
      console.error('[ALELO] header não encontrado E layout posicional não reconhecido');
      return jsonResponse({
        error: 'Não consegui identificar o formato da aba Recebimentos (nem header com "Status/Valor Bruto", nem layout posicional padrão da Alelo). Verifique o arquivo.',
      }, 422);
    }

    let importedLots = 0;
    let importedItems = 0;
    let skipStatus = 0, skipNumTrans = 0, skipDataPag = 0, skipPeriodo = 0;

    // Define mapeamento e linha de início conforme o modo
    let cStatus: number, cNumTrans: number, cBruto: number, cLiquido: number;
    let cDataVenda: number, cDataPag: number, cTipoCartao: number, cAuth: number, cCard: number;
    let startRow: number;

    if (usePositional) {
      console.log('[ALELO] usando layout POSICIONAL (sem header)');
      cStatus = POS.status; cNumTrans = POS.numTrans; cBruto = POS.bruto; cLiquido = POS.liquido;
      cDataVenda = POS.dataVenda; cDataPag = POS.dataPag; cTipoCartao = POS.tipoCartao;
      cAuth = POS.numAutorizacao; cCard = POS.numCartao;
      startRow = 0;
    } else {
      console.log('[ALELO] header recebimentos linha =', recHeader!.headerIdx, 'colunas =', JSON.stringify(recHeader!.idx));
      cStatus = findCol(recHeader!.idx, 'status');
      cNumTrans = findCol(recHeader!.idx, 'no da transacao', 'n da transacao', 'numero da transacao');
      cBruto = findCol(recHeader!.idx, 'valor bruto');
      cLiquido = findCol(recHeader!.idx, 'valor liquido');
      cDataVenda = findCol(recHeader!.idx, 'data da venda');
      cDataPag = findCol(recHeader!.idx, 'data de pagamento', 'data do pagamento');
      cTipoCartao = findCol(recHeader!.idx, 'tipo cartao', 'tipo do cartao');
      cAuth = findCol(recHeader!.idx, 'no da autorizacao', 'autorizacao');
      cCard = findCol(recHeader!.idx, 'no cartao', 'numero cartao', 'cartao');
      startRow = recHeader!.headerIdx + 1;
    }

    console.log('[ALELO] cols mapeadas =', { cStatus, cNumTrans, cBruto, cLiquido, cDataVenda, cDataPag, cTipoCartao });

    // Limpar dados anteriores
    await supabase.from('voucher_lots').delete()
      .eq('audit_period_id', audit_period_id).eq('operadora', 'alelo');

    for (let i = startRow; i < recebimentosRows.length; i++) {
      const row = recebimentosRows[i] ?? [];
      if (row.every(c => c == null || String(c).trim() === '')) continue;

        const status = cStatus >= 0 ? String(row[cStatus] ?? '').trim() : '';
        if (status !== 'Aprovada') { skipStatus++; continue; }

        const numTrans = cNumTrans >= 0 ? String(row[cNumTrans] ?? '').trim() : '';
        if (!numTrans) { skipNumTrans++; continue; }

        const bruto = cBruto >= 0 ? parseMoney(row[cBruto]) : 0;
        const liquido = cLiquido >= 0 ? parseMoney(row[cLiquido]) : 0;
        const dataVenda = cDataVenda >= 0 ? parseDateBR(row[cDataVenda]) : null;
        const dataPag = cDataPag >= 0 ? parseDateBR(row[cDataPag]) : null;
        if (!dataPag) { skipDataPag++; continue; }
        if (!isInPeriod(dataPag)) { skipPeriodo++; continue; }

        const externalId = `alelo_${numTrans}`;
        const modalidade = cTipoCartao >= 0 ? (String(row[cTipoCartao] ?? '').trim() || null) : null;

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
          raw_data: { status, autorizacao: cAuth >= 0 ? row[cAuth] : null },
        }).select('id').single();

        if (lotErr) {
          console.error('Erro inserindo lote alelo', externalId, lotErr);
          continue;
        }
        importedLots++;

        if (dataVenda && bruto > 0) {
          const { error: itemErr } = await supabase.from('voucher_lot_items').insert({
            lot_id: insertedLot.id,
            data_transacao: dataVenda,
            gross_amount: bruto,
            net_amount: liquido,
            authorization_code: cAuth >= 0 ? (String(row[cAuth] ?? '').trim() || null) : null,
            card_number: cCard >= 0 ? (String(row[cCard] ?? '').trim() || null) : null,
            modalidade,
            match_status: 'pending',
          });
          if (itemErr) console.error('Erro inserindo item alelo', itemErr);
          else importedItems++;
        }
      }

    console.log('[ALELO] descartados:', { skipStatus, skipNumTrans, skipDataPag, skipPeriodo, importedLots });

    // ---- Validação anti-falso-sucesso ----
    if (recebimentosRows.length > 5 && importedLots === 0) {
      return jsonResponse({
        error: `Arquivo tem ${recebimentosRows.length} linhas mas nenhum lote foi importado (descartados: status=${skipStatus}, semNumTrans=${skipNumTrans}, semDataPag=${skipDataPag}, foraPeriodo=${skipPeriodo}). Verifique o período selecionado e o conteúdo do arquivo.`,
      }, 422);
    }

    // ---- Outras Transações (busca dinâmica também) ----
    const outrasHeader = findHeader(outrasRows, ['descricao', 'valor', 'data do debito']);
    if (outrasRows.length > 0 && !outrasHeader) {
      console.warn('[ALELO] header de Outras Transações não encontrado — ignorando aba');
    }

    // Limpar adjustments anteriores
    await supabase.from('voucher_adjustments').delete()
      .eq('audit_period_id', audit_period_id).eq('operadora', 'alelo');

    type AdjRaw = {
      data: string | null;
      ec: string;
      descricao: string;
      valor: number;
      modalidade: string;
      tipo: string;
    };
    const adjs: AdjRaw[] = [];

    if (outrasHeader) {
      console.log('[ALELO] header outras linha =', outrasHeader.headerIdx, 'colunas =', JSON.stringify(outrasHeader.idx));
      const oData = findCol(outrasHeader.idx, 'data do debito', 'data de pagamento');
      const oDesc = findCol(outrasHeader.idx, 'descricao');
      const oValor = findCol(outrasHeader.idx, 'valor');
      const oEc = findCol(outrasHeader.idx, 'ec da transacao', 'no do ec', 'numero do ec');
      const oTipo = findCol(outrasHeader.idx, 'tipo cartao', 'tipo do cartao');

      for (let i = outrasHeader.headerIdx + 1; i < outrasRows.length; i++) {
        const row = outrasRows[i] ?? [];
        if (row.every(c => c == null || String(c).trim() === '')) continue;
        const data = oData >= 0 ? parseDateBR(row[oData]) : null;
        if (!data) continue;
        if (!isInPeriod(data)) continue;
        const desc = oDesc >= 0 ? String(row[oDesc] ?? '').trim() : '';
        const valor = oValor >= 0 ? parseMoney(row[oValor]) : 0;
        const ec = oEc >= 0 ? String(row[oEc] ?? '').trim() : '';
        const modalidade = oTipo >= 0 ? String(row[oTipo] ?? '').trim() : '';
        const dl = desc.toLowerCase();
        let tipo = 'outro';
        if (dl.includes('anuidade')) tipo = 'anuidade';
        else if (dl.includes('mensalidade')) tipo = 'mensalidade';
        else if (dl.includes('tor')) tipo = 'tor';
        else if (dl.includes('compensa')) tipo = 'compensacao';
        else if (dl.includes('tarifa')) tipo = 'tarifa';
        adjs.push({ data, ec, descricao: desc, valor, modalidade, tipo });
      }
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
