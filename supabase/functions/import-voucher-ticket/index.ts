// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, parseMoney, parseDateBR, jsonResponse } from '../_shared/voucher-utils.ts';

// rows = array de arrays. Procura header "Número do reembolso".
// Estado-máquina: percorre linhas, acumula transações até "Subtotal de Vendas",
// então lê tarifas até "Valor Líquido".
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { audit_period_id, file_name, rows: rowsInput, file_base64 } = await req.json();
    if (!audit_period_id) {
      return jsonResponse({ error: 'audit_period_id é obrigatório' }, 400);
    }

    let rows: any[][] = [];
    if (file_base64) {
      // Parser XML manual: SheetJS quebra com prefixo XML "x:" usado pelo portal Ticket.
      // Lê o XLSX como ZIP via fflate, extrai sharedStrings.xml + sheet1.xml, parseia com regex
      // que aceita tags com OU sem prefixo (x:row, x:c, x:v, x:t, x:si).
      const binaryString = atob(file_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

      const fflate = await import('https://esm.sh/fflate@0.8.2');
      const unzipped = fflate.unzipSync(bytes);

      const decoder = new TextDecoder('utf-8');
      const sharedStringsXml = unzipped['xl/sharedStrings.xml']
        ? decoder.decode(unzipped['xl/sharedStrings.xml'])
        : '';
      const sheet1Xml = unzipped['xl/worksheets/sheet1.xml']
        ? decoder.decode(unzipped['xl/worksheets/sheet1.xml'])
        : '';

      if (!sheet1Xml) {
        return jsonResponse({ error: 'Ticket: arquivo XLSX inválido (sheet1.xml não encontrado)' }, 422);
      }

      // Shared strings (aceita prefixo x:)
      const ssTable: string[] = [];
      const siRegex = /<(?:x:)?si[^>]*>([\s\S]*?)<\/(?:x:)?si>/g;
      const tRegex = /<(?:x:)?t[^>]*>([\s\S]*?)<\/(?:x:)?t>/g;
      let siMatch: RegExpExecArray | null;
      while ((siMatch = siRegex.exec(sharedStringsXml)) !== null) {
        const inner = siMatch[1];
        const texts: string[] = [];
        let tMatch: RegExpExecArray | null;
        tRegex.lastIndex = 0;
        while ((tMatch = tRegex.exec(inner)) !== null) {
          texts.push(tMatch[1]);
        }
        ssTable.push(texts.join(''));
      }
      console.log('[TICKET] shared strings carregadas:', ssTable.length);

      const colToIdx = (col: string): number => {
        let idx = 0;
        for (const c of col) idx = idx * 26 + (c.charCodeAt(0) - 64);
        return idx - 1;
      };

      const decodeXmlEntities = (s: string): string =>
        s.replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"')
         .replace(/&apos;/g, "'");

      const rowsByNum: Map<number, any[]> = new Map();
      let maxRow = 0;
      let maxCol = 0;

      const rowRegex = /<(?:x:)?row\s+r="(\d+)"[^>]*>([\s\S]*?)<\/(?:x:)?row>/g;
      const cellRegex = /<(?:x:)?c\s+([^>]*?)\/?>(?:<(?:x:)?v[^>]*>([^<]*)<\/(?:x:)?v>)?/g;
      const refAttrRegex = /r="([A-Z]+)(\d+)"/;
      const typeAttrRegex = /t="([^"]+)"/;

      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(sheet1Xml)) !== null) {
        const rowNum = parseInt(rowMatch[1], 10);
        const rowContent = rowMatch[2];
        const cellsByCol: Map<number, any> = new Map();

        let cellMatch: RegExpExecArray | null;
        cellRegex.lastIndex = 0;
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const attrs = cellMatch[1];
          const value = cellMatch[2];
          if (value === undefined || value === '') continue;

          const refMatch = refAttrRegex.exec(attrs);
          if (!refMatch) continue;
          const colIdx = colToIdx(refMatch[1]);

          const typeMatch = typeAttrRegex.exec(attrs);
          const cellType = typeMatch ? typeMatch[1] : null;

          let finalValue: any;
          if (cellType === 's') {
            const ssIdx = parseInt(value, 10);
            finalValue = ssTable[ssIdx] !== undefined ? decodeXmlEntities(ssTable[ssIdx]) : '';
          } else {
            finalValue = decodeXmlEntities(value);
          }

          cellsByCol.set(colIdx, finalValue);
          if (colIdx > maxCol) maxCol = colIdx;
        }

        if (cellsByCol.size > 0) {
          rowsByNum.set(rowNum, Array.from(cellsByCol.entries()) as any);
          if (rowNum > maxRow) maxRow = rowNum;
        }
      }

      // Montar array final na ordem (rowNum começa em 1)
      rows = [];
      for (let n = 1; n <= maxRow; n++) {
        const entries = rowsByNum.get(n) as unknown as Array<[number, any]> | undefined;
        const row: any[] = new Array(maxCol + 1).fill(null);
        if (entries) {
          for (const [idx, val] of entries) row[idx] = val;
        }
        rows.push(row);
      }

      console.log('[TICKET] parseado via XML manual, rows =', rows.length, 'maxCol =', maxCol);
    } else if (Array.isArray(rowsInput)) {
      rows = rowsInput;
      console.log('[TICKET] rows recebido do frontend =', rows.length);
    } else {
      return jsonResponse({ error: 'É necessário enviar rows ou file_base64' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: period } = await supabase
      .from('audit_periods')
      .select('id')
      .eq('id', audit_period_id)
      .maybeSingle();
    if (!period) return jsonResponse({ error: 'Período não encontrado' }, 404);

    const TAXA_TICKET_ESTIMADA = 0.12;

    const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // ---- Detectar header NOVO: 'Data da Transação' + 'Nº Reembolso' ----
    let headerIdx = -1;
    let cDataTrans = -1, cNumTrans = -1, cProduto = -1, cValor = -1, cReembolso = -1;
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const r = rows[i] || [];
      const lower = r.map(norm);
      const hasDataTrans = lower.some(c => c.includes('data da transacao'));
      const hasReembolso = lower.some(c => c.includes('reembolso'));
      if (hasDataTrans && hasReembolso) {
        headerIdx = i;
        lower.forEach((c, j) => {
          if (c.includes('data da transacao')) cDataTrans = j;
          else if (c.includes('no transacao') || c.includes('n transacao')) cNumTrans = j;
          else if (c === 'produto') cProduto = j;
          else if (c.includes('vl transacao') || c.includes('valor')) cValor = j;
          else if (c.includes('reembolso')) cReembolso = j;
        });
        break;
      }
    }

    if (headerIdx < 0) {
      return jsonResponse({
        error: 'Ticket: cabeçalho não encontrado. Esperado linha com "Data da Transação" e "Nº Reembolso".',
      }, 400);
    }

    if (cDataTrans < 0 || cValor < 0 || cReembolso < 0) {
      return jsonResponse({
        error: `Ticket: colunas obrigatórias não encontradas (DataTransação=${cDataTrans}, Valor=${cValor}, Reembolso=${cReembolso}).`,
      }, 400);
    }

    type Item = { data_transacao: string; gross_amount: number; authorization_code?: string; modalidade: string | null; };
    type Lot = {
      external_id: string;
      data_corte: string;
      data_pagamento: string;
      gross_amount: number;
      net_amount: number;
      fee_admin: number;
      modalidade: string | null;
      items: Item[];
    };

    const lotsByReemb = new Map<string, Lot>();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const dataTransRaw = r[cDataTrans];
      const numReemb = r[cReembolso];
      if (!dataTransRaw || !numReemb) continue;

      const dt = parseDateBR(String(dataTransRaw).split(' ')[0]);
      const bruto = parseMoney(r[cValor]);
      if (!dt || bruto <= 0) continue;

      const reemb = String(numReemb).trim();
      const numTrans = cNumTrans >= 0 ? String(r[cNumTrans] ?? '').trim() : '';
      const produto = cProduto >= 0 ? String(r[cProduto] ?? '').trim() : null;

      if (!lotsByReemb.has(reemb)) {
        lotsByReemb.set(reemb, {
          external_id: `ticket_${reemb}`,
          data_corte: dt,
          data_pagamento: dt,
          gross_amount: 0,
          net_amount: 0,
          fee_admin: 0,
          modalidade: null,
          items: [],
        });
      }
      const lot = lotsByReemb.get(reemb)!;
      lot.items.push({
        data_transacao: dt,
        gross_amount: bruto,
        authorization_code: numTrans || undefined,
        modalidade: produto,
      });
      lot.gross_amount += bruto;
      if (dt < lot.data_corte) lot.data_corte = dt;
    }

    for (const lot of lotsByReemb.values()) {
      lot.net_amount = +(lot.gross_amount * (1 - TAXA_TICKET_ESTIMADA)).toFixed(2);
      lot.fee_admin = +(lot.gross_amount - lot.net_amount).toFixed(2);
      const dtPag = new Date(lot.data_corte + 'T00:00:00Z');
      dtPag.setUTCDate(dtPag.getUTCDate() + 21);
      lot.data_pagamento = dtPag.toISOString().substring(0, 10);
      const mods = lot.items.map(i => i.modalidade).filter(Boolean) as string[];
      const set = new Set(mods);
      lot.modalidade = set.size === 0 ? null : set.size === 1 ? mods[0] : 'MIX';
    }

    const validLots = Array.from(lotsByReemb.values());

    if (rows.length > 5 && validLots.length === 0) {
      return jsonResponse({
        error: `Ticket: arquivo tem ${rows.length} linhas mas nenhum lote foi identificado. Verifique o formato (extrato com colunas "Data da Transação" e "Nº Reembolso").`,
      }, 422);
    }

    let importedLots = 0;
    let importedItems = 0;

    for (const lot of validLots) {
      const { data: insertedLot, error: lotErr } = await supabase
        .from('voucher_lots')
        .upsert({
          audit_period_id,
          operadora: 'ticket',
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
          raw_data: { items_count: lot.items.length, num_reembolso: lot.external_id.replace('ticket_', ''), estimated_net: true },
        }, { onConflict: 'audit_period_id,operadora,external_id' })
        .select('id').single();
      if (lotErr) {
        console.error('Erro upsert lote Ticket', lot.external_id, lotErr);
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
          card_number: null,
          modalidade: it.modalidade || null,
          match_status: 'pending',
        }));
        const { error: itemErr } = await supabase.from('voucher_lot_items').insert(itemRows);
        if (!itemErr) importedItems += itemRows.length;
      }
    }

    await supabase.from('voucher_imports').insert({
      audit_period_id,
      operadora: 'ticket',
      file_name: file_name || 'ticket.xlsx',
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
    console.error('import-voucher-ticket error', e);
    return jsonResponse({ error: e.message ?? 'Erro interno' }, 500);
  }
});
