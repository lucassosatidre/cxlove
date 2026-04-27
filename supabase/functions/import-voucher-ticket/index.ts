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
      const XLSX = await import('https://esm.sh/xlsx@0.18.5');
      const binaryString = atob(file_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as any[][];
      console.log('[TICKET] parseado no backend, rows =', rows.length);
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

    // Limpar dados anteriores
    await supabase.from('voucher_lots').delete()
      .eq('audit_period_id', audit_period_id).eq('operadora', 'ticket');

    let importedLots = 0;
    let importedItems = 0;

    for (const lot of lots) {
      if (!lot.data_pagamento || lot.gross_amount === 0) continue;
      if (!isInPeriod(lot.data_pagamento)) continue;
      const { data: insertedLot, error: lotErr } = await supabase.from('voucher_lots').insert({
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
      }).select('id').single();

      if (lotErr) {
        console.error('Erro inserindo lote ticket', lot.external_id, lotErr);
        continue;
      }
      importedLots++;

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
