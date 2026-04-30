// @ts-nocheck
// Recebe texto bruto extraído do PDF "Extrato de Reembolsos Detalhado" Ticket Edenred
// (frontend usa pdfjs-dist pra extrair via getDocument().getTextContent()).
//
// Estrutura do PDF — cada lote (Nº Reembolso) tem:
//   linhas de venda: <num_reembolso> <num_contrato> <produto> <data_corte> <data_credito> <cod_estab> PIZZARIA ESTRELA <data_transacao> <data_postagem> <num_doc> TEF COMPRA <num_cartao_mascarado> R$<valor> <cnpj>
//   linha subtotal: <num_reembolso> Subtotal de Vendas R$<x>
//   linhas de descontos: <num_contrato> <data_credito> <descrição> R$<x>
//     descrições: "Tarifa de gestão de pagamento", "Tarifa por transação", "Taxa TPE", "Anuidade Cartao Tre Ref."
//   linha total descontos: Total de Descontos R$<x>
//   linha valor líquido: Valor Líquido R$<x>
//
// Um lote = um crédito BB. Persistimos audit_voucher_lots (1 row) + audit_voucher_lot_items (N rows).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function parseDateBR(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseValor(s: string): number | null {
  // "R$104,90" / "R$1.234,56"
  const cleaned = s.replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

// ============================================================
// Pré-processamento: junta linhas de continuação do extract_text.
// O pdfjs quebra textos longos em múltiplas linhas. Estratégias:
//   - "PIZZARIA\nESTRELA" → "PIZZARIA ESTRELA" (cabeçalho do estabelecimento na linha de venda)
//   - "Tarifa de gestão\nde pagamento R$8,70" → uma linha
//   - "Tarifa por\ntransação R$0,87" → uma linha
//   - "Anuidade Cartao\nTre Ref. R$341,92" → uma linha
//   - "Subtotal de\nVendas R$X" → uma linha
//   - "Total de\nDescontos R$X" → uma linha
//   - Cabeçalhos multi-linha "Número do\nReembolso", etc — descartar antes do data
//   - "Página X de Y" — remover
// ============================================================
function preprocessRawText(raw: string): string[] {
  // 1) Une quebras de linha "soltas" — heurística: se a próxima linha não começa
  //    com um padrão de início de registro (Nº Reembolso 8-9 dígitos, ou Nº Contrato
  //    12 dígitos seguido de data, ou "Total de", "Valor Líquido", "Subtotal de"),
  //    ela é continuação da anterior.
  const lines = raw.split(/\r?\n/);
  const merged: string[] = [];
  let buf = '';

  const isNewRecordStart = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    // Linha de venda: começa com "<reembolso 8-9 dígitos> <contrato 11-12 dígitos> <produto>"
    if (/^\d{8,9}\s+\d{10,12}\s+(TRE|TAE|TF)\s/.test(t)) return true;
    // Linha de subtotal: "<reembolso 8-9 dígitos> Subtotal de"
    if (/^\d{8,9}\s+Subtotal\s+de/.test(t)) return true;
    // Linha de desconto: "<contrato 11-12 dígitos> <data DD/MM/YYYY>"
    if (/^\d{10,12}\s+\d{2}\/\d{2}\/\d{4}/.test(t)) return true;
    // Linhas finais
    if (/^Total\s+de\s+Descontos/.test(t)) return true;
    if (/^Total\s+de$/.test(t)) return true;
    if (/^Valor\s+Líquido/.test(t)) return true;
    // Página X de Y
    if (/^Página\s+\d+\s+de\s+\d+/.test(t)) return true;
    return false;
  };

  for (const line of lines) {
    if (isNewRecordStart(line)) {
      if (buf) merged.push(buf);
      buf = line.trim();
    } else {
      // Continuação — concatena com espaço
      buf = buf ? buf + ' ' + line.trim() : line.trim();
    }
  }
  if (buf) merged.push(buf);

  // 2) Normaliza fragmentação de "Tarifa por transação" entre páginas. O PDF
  //    quebra em duas linhas: "<C> <D> Tarifa por R$X" + "<C> <D> transação R$X"
  //    (com Página N de Y entre elas), e o merge agrupa cada uma como discount
  //    separado. Solução: descarta a continuação "<C> <D> transação R$X" pra não
  //    duplicar, e a categorizacão de "Tarifa por" sozinho fica como tarifa_transacao
  //    em normalizeDiscountKey.
  const dedupedContinuation = merged.filter(l => {
    return !/^\d{10,12}\s+\d{2}\/\d{2}\/\d{4}\s+transação\s+R\$/.test(l);
  });

  // 3) Remove cabeçalhos das páginas (header da tabela, dados da empresa, "Página X de Y").
  return dedupedContinuation.filter(l => {
    if (!l) return false;
    if (/^Página\s+\d+\s+de\s+\d+/.test(l)) return false;
    if (/^Empresa:\s/.test(l)) return false;
    if (/^CNPJ:\s/.test(l)) return false;
    if (/^Emissão:\s/.test(l)) return false;
    if (/^Extrato\s+de\s+Reembolsos/.test(l)) return false;
    if (/^Contrato:\s/.test(l)) return false;
    if (/^Frequência:\s/.test(l)) return false;
    if (/^Lançamentos\s+Efetuados/.test(l)) return false;
    // Cabeçalho da tabela
    if (/^Número\s+do/.test(l)) return false;
    if (/^Reembolso/.test(l)) return false;
    if (/^Contrato\s+Produto/.test(l)) return false;
    if (/^Data\s+de\s+corte/.test(l)) return false;
    if (/^Cód\.\s+Estabelecimento/.test(l)) return false;
    if (/^Estabelecimento/.test(l)) return false;
    if (/^Data\s+da/.test(l)) return false;
    if (/^transação\s*$/.test(l)) return false;
    if (/^postagem\s*$/.test(l)) return false;
    if (/^documento\s*$/.test(l)) return false;
    if (/^Tipo\s+de/.test(l)) return false;
    if (/^Descrição\s+do/.test(l)) return false;
    if (/^lançamento/.test(l)) return false;
    if (/^Valor\s+da\s*$/.test(l)) return false;
    if (/^CNPJ\s+da\s+transação/.test(l)) return false;
    return true;
  });
}

// ============================================================
// Parser: estado-máquina sobre as linhas pré-processadas.
// Retorna lotes parseados.
// ============================================================
type ParsedItem = {
  data_transacao: string;
  data_postagem: string | null;
  numero_documento: string | null;
  numero_cartao_mascarado: string | null;
  valor: number;
  estabelecimento: string | null;
  cnpj: string | null;
};

type ParsedLot = {
  numero_reembolso: string;
  numero_contrato: string;
  produto: string;
  data_corte: string | null;
  data_credito: string;
  cod_estabelecimento: string | null;
  items: ParsedItem[];
  subtotal_vendas: number;
  descontos: Record<string, number>;
  total_descontos: number;
  valor_liquido: number;
};

function parseTicketRefundLines(lines: string[]): { lots: ParsedLot[]; warnings: string[] } {
  const lots: ParsedLot[] = [];
  const warnings: string[] = [];
  let current: ParsedLot | null = null;

  // Linha de venda completa (depois do merge):
  // "<reembolso> <contrato> <produto> <data_corte DD/MM/YYYY> <data_credito DD/MM/YYYY> <cod_estab> PIZZARIA ESTRELA <data_transacao DD/MM/YYYY> <data_postagem DD/MM/YYYY> <num_doc> TEF COMPRA <num_cartao> R$<valor> <cnpj>"
  const SALE_RE =
    /^(\d{8,9})\s+(\d{10,12})\s+(TRE|TAE|TF)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+PIZZARIA\s+ESTRELA\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+TEF\s+COMPRA\s+(\*+\d+)\s+(R\$[\d.,]+)\s+([\d./-]+)/;

  // Subtotal: "<reembolso> Subtotal de Vendas R$X"
  const SUBTOTAL_RE = /^(\d{8,9})\s+Subtotal\s+de\s+Vendas\s+(R\$[\d.,]+)/;

  // Desconto: "<contrato> <data> <descrição> R$X"
  const DISCOUNT_RE = /^(\d{10,12})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(R\$[\d.,]+)$/;

  // Total descontos
  const TOTAL_DESC_RE = /^Total\s+de\s+Descontos\s+(R\$[\d.,]+)/;

  // Valor líquido
  const VALOR_LIQ_RE = /^Valor\s+Líquido\s+(R\$[\d.,]+)/;

  const closeLot = () => {
    if (current) {
      lots.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    let m: RegExpMatchArray | null;

    if ((m = line.match(SALE_RE))) {
      const [, numReembolso, numContrato, produto, dataCorteRaw, dataCreditoRaw, codEstab,
        dataTxRaw, dataPostRaw, numDoc, numCartao, valorRaw, cnpj] = m;

      // Se mudou Nº Reembolso, fecha o anterior e abre novo
      if (current && current.numero_reembolso !== numReembolso) {
        closeLot();
      }

      if (!current) {
        current = {
          numero_reembolso: numReembolso,
          numero_contrato: numContrato,
          produto,
          data_corte: parseDateBR(dataCorteRaw),
          data_credito: parseDateBR(dataCreditoRaw)!,
          cod_estabelecimento: codEstab,
          items: [],
          subtotal_vendas: 0,
          descontos: {},
          total_descontos: 0,
          valor_liquido: 0,
        };
      }

      current.items.push({
        data_transacao: parseDateBR(dataTxRaw)!,
        data_postagem: parseDateBR(dataPostRaw),
        numero_documento: numDoc,
        numero_cartao_mascarado: numCartao,
        valor: parseValor(valorRaw)!,
        estabelecimento: 'PIZZARIA ESTRELA',
        cnpj,
      });
      continue;
    }

    if ((m = line.match(SUBTOTAL_RE))) {
      const [, numReembolso, valorRaw] = m;
      if (current && current.numero_reembolso === numReembolso) {
        current.subtotal_vendas = parseValor(valorRaw)!;
      }
      continue;
    }

    if ((m = line.match(DISCOUNT_RE))) {
      const [, , , descricao, valorRaw] = m;
      if (current) {
        const valor = parseValor(valorRaw)!;
        const key = normalizeDiscountKey(descricao);
        current.descontos[key] = (current.descontos[key] ?? 0) + valor;
      }
      continue;
    }

    if ((m = line.match(TOTAL_DESC_RE))) {
      if (current) current.total_descontos = parseValor(m[1])!;
      continue;
    }

    if ((m = line.match(VALOR_LIQ_RE))) {
      if (current) {
        current.valor_liquido = parseValor(m[1])!;
        closeLot(); // valor líquido = fim do lote
      }
      continue;
    }

    // Linha não reconhecida — guarda warning se não for vazia
    if (line.trim()) {
      warnings.push(`Linha ignorada: ${line.substring(0, 100)}`);
    }
  }

  closeLot(); // fecha último se sobrou

  return { lots, warnings };
}

function normalizeDiscountKey(descricao: string): string {
  const d = descricao.toLowerCase().trim();
  if (d.includes('tarifa de gestão') || d.includes('tarifa de gestao')) return 'tarifa_gestao';
  if (d.includes('tarifa por transação') || d.includes('tarifa por transacao')) return 'tarifa_transacao';
  if (d === 'tarifa por') return 'tarifa_transacao'; // fragmento da quebra de página
  if (d.includes('taxa tpe')) return 'taxa_tpe';
  if (d.includes('anuidade')) return 'anuidade';
  return 'outros';
}

// ============================================================
// Handler
// ============================================================
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
    const { audit_period_id, file_name, raw_text } = body || {};
    if (!audit_period_id || !file_name || !raw_text) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, raw_text)' }), {
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

    const lines = preprocessRawText(raw_text);
    const { lots, warnings } = parseTicketRefundLines(lines);

    if (lots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote reconhecido no PDF. Verifique se o arquivo é o "Extrato de Reembolsos Detalhado" da Ticket.',
        warnings: warnings.slice(0, 10),
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanity: subtotal_vendas deve bater com soma dos items, e (subtotal - total_descontos) com valor_liquido.
    const integrityErrors: string[] = [];
    for (const l of lots) {
      const sumItems = l.items.reduce((s, i) => s + i.valor, 0);
      if (Math.abs(sumItems - l.subtotal_vendas) > 0.05) {
        integrityErrors.push(`Lote ${l.numero_reembolso}: soma items R$${sumItems.toFixed(2)} ≠ subtotal R$${l.subtotal_vendas.toFixed(2)}`);
      }
      const calcLiq = l.subtotal_vendas - l.total_descontos;
      if (Math.abs(calcLiq - l.valor_liquido) > 0.05) {
        integrityErrors.push(`Lote ${l.numero_reembolso}: subtotal-descontos R$${calcLiq.toFixed(2)} ≠ líquido R$${l.valor_liquido.toFixed(2)}`);
      }
    }

    const totalItems = lots.reduce((s, l) => s + l.items.length, 0);

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'ticket',
        file_name,
        total_rows: totalItems,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar importação: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert lotes
    let insertedLots = 0;
    let updatedLots = 0;
    let insertedItems = 0;

    for (const l of lots) {
      // upsert por (period, operadora='ticket', numero_reembolso)
      const { data: existing } = await supabase
        .from('audit_voucher_lots')
        .select('id')
        .eq('audit_period_id', audit_period_id)
        .eq('operadora', 'ticket')
        .eq('numero_reembolso', l.numero_reembolso)
        .maybeSingle();

      const lotPayload = {
        audit_period_id,
        operadora: 'ticket',
        numero_reembolso: l.numero_reembolso,
        numero_contrato: l.numero_contrato,
        produto: l.produto,
        data_corte: l.data_corte,
        data_credito: l.data_credito,
        subtotal_vendas: l.subtotal_vendas,
        total_descontos: l.total_descontos,
        valor_liquido: l.valor_liquido,
        descontos: l.descontos,
        import_id: importRec.id,
      };

      let lotId: string;

      if (existing) {
        const { error: updErr } = await supabase
          .from('audit_voucher_lots')
          .update(lotPayload)
          .eq('id', existing.id);
        if (updErr) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao atualizar lote ${l.numero_reembolso}: ${updErr.message}`,
          }).eq('id', importRec.id);
          throw updErr;
        }
        // Apaga items pra repopular
        await supabase.from('audit_voucher_lot_items').delete().eq('lot_id', existing.id);
        lotId = existing.id;
        updatedLots++;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('audit_voucher_lots')
          .insert(lotPayload)
          .select('id')
          .single();
        if (insErr || !inserted) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao inserir lote ${l.numero_reembolso}: ${insErr?.message ?? 'sem dado'}`,
          }).eq('id', importRec.id);
          throw insErr ?? new Error('falha insert lote');
        }
        lotId = inserted.id;
        insertedLots++;
      }

      const itemsPayload = l.items.map(it => ({
        lot_id: lotId,
        data_transacao: it.data_transacao,
        data_postagem: it.data_postagem,
        numero_documento: it.numero_documento,
        numero_cartao_mascarado: it.numero_cartao_mascarado,
        valor: it.valor,
        estabelecimento: it.estabelecimento,
        cnpj: it.cnpj,
      }));

      if (itemsPayload.length) {
        const { error: itErr } = await supabase
          .from('audit_voucher_lot_items')
          .insert(itemsPayload);
        if (itErr) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao inserir items do lote ${l.numero_reembolso}: ${itErr.message}`,
          }).eq('id', importRec.id);
          throw itErr;
        }
        insertedItems += itemsPayload.length;
      }
    }

    await supabase.from('audit_imports').update({
      status: 'completed',
      imported_rows: insertedItems,
      duplicate_rows: 0,
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
      total_items: totalItems,
      inserted_items: insertedItems,
      integrity_errors: integrityErrors,
      warnings: warnings.slice(0, 20),
      message: `${insertedLots} lotes novos + ${updatedLots} atualizados (${insertedItems} vendas)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-ticket-pdf error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
