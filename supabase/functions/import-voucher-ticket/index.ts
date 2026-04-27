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

    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i] ?? [];
      if (r.some((c: any) => String(c ?? '').includes('Número do reembolso') || String(c ?? '').includes('Numero do reembolso'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return jsonResponse({ error: 'Ticket: cabeçalho não encontrado' }, 400);

    type Item = {
      data_transacao: string | null;
      gross_amount: number;
      authorization_code?: string;
      card_number?: string;
      modalidade?: string;
    };
    type Lot = {
      external_id: string;
      modalidade: string;
      data_corte: string | null;
      data_pagamento: string | null;
      gross_amount: number;
      fee_management: number;
      fee_admin: number;
      fee_other: number;
      net_amount: number;
      items: Item[];
    };

    const lots: Lot[] = [];
    let current: Lot | null = null;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = (rows[i] ?? []).map((c: any) => (c == null ? '' : c));
      const c0 = String(row[0] ?? '').trim();
      const c2 = String(row[2] ?? '').trim();
      const c11 = String(row[11] ?? '').trim();

      // Linha de transação: c0 = numero_reembolso (numérico), c10 = "TEF", c11 = "COMPRA"
      if (/^\d+$/.test(c0) && c11.toUpperCase() === 'COMPRA') {
        const externalId = `ticket_${c0}`;
        if (!current || current.external_id !== externalId) {
          if (current) lots.push(current);
          current = {
            external_id: externalId,
            modalidade: c2, // TAE / TRE / TF
            data_corte: parseDateBR(row[3]),
            data_pagamento: parseDateBR(row[4]),
            gross_amount: 0,
            fee_management: 0,
            fee_admin: 0,
            fee_other: 0,
            net_amount: 0,
            items: [],
          };
        }
        const dataTrans = parseDateBR(row[7]);
        const gross = parseMoney(row[13]);
        if (dataTrans && gross > 0) {
          current.items.push({
            data_transacao: dataTrans,
            gross_amount: gross,
            authorization_code: String(row[9] ?? '').trim(),
            card_number: String(row[12] ?? '').trim(),
            modalidade: c2,
          });
        }
        continue;
      }

      if (!current) continue;

      // Subtotal de Vendas (descrição em c11, valor em c13)
      if (/subtotal\s+de\s+vendas/i.test(c11)) {
        current.gross_amount = parseMoney(row[13]);
        continue;
      }
      // Tarifa de gestão de pagamento (c11), valor c13
      if (/tarifa\s+de\s+gest/i.test(c11)) {
        current.fee_management += parseMoney(row[13]);
        continue;
      }
      // Taxa TPE (c11), valor c13
      if (/taxa\s+tpe/i.test(c11)) {
        current.fee_admin += parseMoney(row[13]);
        continue;
      }
      // Mensalidade / anuidade
      if (/mensalidade|anuidade/i.test(c11)) {
        current.fee_other += parseMoney(row[13]);
        continue;
      }
      // Total de Descontos — ignora (=fee_management+fee_admin+fee_other)
      if (/total\s+de\s+descontos/i.test(c11)) continue;
      // Valor Líquido — fecha o lote
      if (/valor\s+l[ií]quido/i.test(c11)) {
        current.net_amount = parseMoney(row[13]);
        lots.push(current);
        current = null;
        continue;
      }
    }
    if (current) lots.push(current);

    console.log('[TICKET] lots parseados =', lots.length, 'rows totais =', rows.length);

    // Validação anti-falso-sucesso: arquivo com conteúdo mas zero lotes parseados
    if (rows.length > 5 && lots.length === 0) {
      return jsonResponse({
        error: `Arquivo tem ${rows.length} linhas mas nenhum lote foi identificado. Verifique o formato (Extrato de Reembolso DETALHADO da Ticket).`,
      }, 422);
    }

    // UPSERT (sem DELETE prévio)
    let importedLots = 0;
    let importedItems = 0;

    for (const lot of lots) {
      if (!lot.data_pagamento || lot.gross_amount === 0) continue;
      if (!isInPeriod(lot.data_pagamento)) continue;
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
          fee_management: lot.fee_management,
          fee_other: lot.fee_other,
          modalidade: lot.modalidade || null,
          status: 'imported',
          raw_data: { item_count: lot.items.length },
        }, { onConflict: 'audit_period_id,operadora,external_id' })
        .select('id')
        .single();

      if (lotErr) {
        console.error('Erro upsert lote ticket', lot.external_id, lotErr);
        continue;
      }
      importedLots++;

      // Substitui os items do lote
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
        if (itemErr) console.error('Erro inserindo items ticket', itemErr);
        else importedItems += itemRows.length;
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
