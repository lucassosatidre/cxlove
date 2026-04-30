// @ts-nocheck
// Recebe texto bruto extraído do PDF "Extrato de Reembolsos Detalhado" Ticket Edenred.
// O frontend (pdfjs-dist) envia tudo concatenado por espaço (ordenado por Y desc, X asc),
// sem tentar reconstruir linhas — colunas tabulares têm Y ligeiramente diferente que
// rompiam agrupamento por Y. Aqui usamos regex globais sobre a string contínua e ordenamos
// os matches por posição pra reconstruir a sequência lógica.

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

function normalizeDiscountKey(descricao: string): string {
  const d = descricao.toLowerCase().trim();
  if (d.includes('tarifa de gestão') || d.includes('tarifa de gestao')) return 'tarifa_gestao';
  if (d.includes('tarifa por transação') || d.includes('tarifa por transacao')) return 'tarifa_transacao';
  if (d === 'tarifa por') return 'tarifa_transacao'; // fragmento da quebra de página (raro)
  if (d.includes('taxa tpe')) return 'taxa_tpe';
  if (d.includes('anuidade')) return 'anuidade';
  return 'outros';
}

// ============================================================
// Parser por eventos posicionais.
// Regex globais detectam cada padrão na string contínua. Eventos são ordenados
// por posição (m.index) e processados como estado-máquina.
// ============================================================
type ParsedItem = {
  data_transacao: string;
  data_postagem: string | null;
  numero_documento: string | null;
  numero_cartao_mascarado: string | null;
  valor: number;
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

// Padrões — `g` flag pra matchAll. Vários campos opcionais/flexíveis pq o pdfjs
// pode extrair tokens em ordem diferente da visual ou separar números.
//
// Estrutura visual de uma linha de venda:
//   <reembolso 8-9d> <contrato 10-12d> <TRE|TAE|TF> <data_corte> <data_credito>
//   <cod_estab> [PIZZARIA ESTRELA] <data_tx> <data_post> <num_doc> [TEF COMPRA]
//   <****cartao> R$<valor> <cnpj>
//
// Ancoramos pelo cartão (`\*+\d+`) que é a âncora mais específica do registro.
// Entre data_postagem e o cartão pode ter num_doc fragmentado e/ou "TEF COMPRA"
// — capturamos como bloco "miolo" não-greedy de até 40 chars.
const SALE_RE =
  /(\d{8,9})\s+(\d{10,12})\s+(TRE|TAE|TF)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(?:PIZZARIA\s+ESTRELA\s+)?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([\S\s]{1,60}?)\s+(\*+\d+)\s+(R\$[\d.,]+)\s+(\d+\.\d{3}\.\d+\/\d+-\d+)/g;

// Subtotal: "<reembolso> Subtotal de Vendas R$X". O pdfjs pode reordenar
// "Subtotal de", "Vendas" e "R$X" em qualquer ordem (Y diferentes nas células).
// Aceitamos QUALQUER coisa entre "Subtotal" e o R$X (até 40 chars).
const SUBTOTAL_RE = /(\d{8,9})\s+Subtotal[\s\S]{0,40}?(R\$[\d.,]+)/g;

// Descontos: "<contrato> <data> <descrição até "R$"> R$X"
const DISCOUNT_RE = /(\d{10,12})\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.]+?)\s+(R\$[\d.,]+)/g;

// Total Descontos — flexível também (pdfjs pode separar "Total de" de "Descontos")
const TOTAL_DESC_RE = /Total[\s\S]{0,20}?Descontos[\s\S]{0,30}?(R\$[\d.,]+)/g;

// Valor Líquido — flexível
const VALOR_LIQ_RE = /Valor[\s\S]{0,15}?Líquido[\s\S]{0,30}?(R\$[\d.,]+)/g;

type Event =
  | { kind: 'sale'; pos: number; numReembolso: string; numContrato: string; produto: string;
      dataCorte: string | null; dataCredito: string; codEstab: string;
      dataTx: string; dataPost: string | null; numDoc: string | null;
      numCartao: string; valor: number; cnpj: string }
  | { kind: 'subtotal'; pos: number; numReembolso: string; valor: number }
  | { kind: 'discount'; pos: number; numContrato: string; descricao: string; valor: number }
  | { kind: 'total_desc'; pos: number; valor: number }
  | { kind: 'valor_liq'; pos: number; valor: number };

function parseTicketRefund(text: string): { lots: ParsedLot[]; warnings: string[] } {
  const warnings: string[] = [];
  const events: Event[] = [];

  // Coleta vendas
  for (const m of text.matchAll(SALE_RE)) {
    const valor = parseValor(m[11]);
    const dataTx = parseDateBR(m[7]);
    const dataCredito = parseDateBR(m[5]);
    if (valor == null || !dataTx || !dataCredito) continue;
    // Extrai num_doc do "miolo" (m[9]) que pode conter "TEF COMPRA" e números
    // fragmentados. Junta tokens não-letra (números) que provavelmente são
    // continuação do mesmo número de documento.
    const miolo = m[9].replace(/TEF/gi, '').replace(/COMPRA/gi, '').trim();
    const mioloTokens = miolo.split(/\s+/).filter(t => t.length > 0);
    // Concatena tokens numéricos consecutivos (caso "35926" tenha virado "359" "26")
    const numericTokens: string[] = [];
    for (const t of mioloTokens) {
      if (/^\d+$/.test(t)) numericTokens.push(t);
    }
    const numDoc = numericTokens.length > 0 ? numericTokens.join('') : (mioloTokens[0] ?? null);
    events.push({
      kind: 'sale',
      pos: m.index!,
      numReembolso: m[1],
      numContrato: m[2],
      produto: m[3],
      dataCorte: parseDateBR(m[4]),
      dataCredito,
      codEstab: m[6],
      dataTx,
      dataPost: parseDateBR(m[8]),
      numDoc,
      numCartao: m[10],
      valor,
      cnpj: m[12],
    });
  }

  // Coleta subtotais (cada lote tem 1)
  for (const m of text.matchAll(SUBTOTAL_RE)) {
    const valor = parseValor(m[2]);
    if (valor == null) continue;
    events.push({ kind: 'subtotal', pos: m.index!, numReembolso: m[1], valor });
  }

  // Coleta descontos. Cuidado: o regex pode "casar" trechos dentro de uma venda
  // (porque vendas têm "<contrato> <data>" no meio). Pra evitar, descartamos
  // discounts cujo (m.index, m.index + m[0].length) caia dentro de qualquer
  // intervalo de venda já capturado.
  const saleSpans: Array<[number, number]> = events
    .filter(e => e.kind === 'sale')
    .map(e => {
      // m[0] da venda — não temos guardado. Mas a venda vai do reembolso até o CNPJ.
      // O CNPJ aparece logo no fim, então estimamos um span generoso usando o
      // próximo evento. Pra simplificar: span = [pos, pos + 250] (tamanho típico de uma linha de venda).
      return [(e as any).pos, (e as any).pos + 250] as [number, number];
    });

  function isInsideSale(start: number): boolean {
    return saleSpans.some(([s, e]) => start >= s && start <= e);
  }

  for (const m of text.matchAll(DISCOUNT_RE)) {
    if (isInsideSale(m.index!)) continue;
    const descricao = m[3].trim();
    const valor = parseValor(m[4]);
    if (valor == null) continue;
    // Filtra descrições muito curtas ou que parecem números (false positives)
    if (descricao.length < 3) continue;
    events.push({ kind: 'discount', pos: m.index!, numContrato: m[1], descricao, valor });
  }

  for (const m of text.matchAll(TOTAL_DESC_RE)) {
    const valor = parseValor(m[1]);
    if (valor == null) continue;
    events.push({ kind: 'total_desc', pos: m.index!, valor });
  }

  for (const m of text.matchAll(VALOR_LIQ_RE)) {
    const valor = parseValor(m[1]);
    if (valor == null) continue;
    events.push({ kind: 'valor_liq', pos: m.index!, valor });
  }

  // Ordena por posição e processa estado-máquina
  events.sort((a, b) => a.pos - b.pos);

  const lots: ParsedLot[] = [];
  let current: ParsedLot | null = null;

  const closeLot = () => {
    if (current) {
      lots.push(current);
      current = null;
    }
  };

  for (const ev of events) {
    if (ev.kind === 'sale') {
      // Se mudou Nº Reembolso, fecha o anterior e abre novo
      if (current && current.numero_reembolso !== ev.numReembolso) closeLot();
      if (!current) {
        current = {
          numero_reembolso: ev.numReembolso,
          numero_contrato: ev.numContrato,
          produto: ev.produto,
          data_corte: ev.dataCorte,
          data_credito: ev.dataCredito,
          cod_estabelecimento: ev.codEstab,
          items: [],
          subtotal_vendas: 0,
          descontos: {},
          total_descontos: 0,
          valor_liquido: 0,
        };
      }
      current.items.push({
        data_transacao: ev.dataTx,
        data_postagem: ev.dataPost,
        numero_documento: ev.numDoc,
        numero_cartao_mascarado: ev.numCartao,
        valor: ev.valor,
        cnpj: ev.cnpj,
      });
    } else if (ev.kind === 'subtotal') {
      if (current && current.numero_reembolso === ev.numReembolso) {
        current.subtotal_vendas = ev.valor;
      }
    } else if (ev.kind === 'discount') {
      if (current) {
        const key = normalizeDiscountKey(ev.descricao);
        current.descontos[key] = (current.descontos[key] ?? 0) + ev.valor;
      }
    } else if (ev.kind === 'total_desc') {
      if (current) current.total_descontos = ev.valor;
    } else if (ev.kind === 'valor_liq') {
      if (current) {
        current.valor_liquido = ev.valor;
        closeLot(); // valor líquido = fim do lote
      }
    }
  }

  closeLot();

  // Fallback computacional: pdfjs as vezes reordena tokens e não casamos
  // subtotal/total_descontos/valor_liquido. Calcula a partir das outras
  // grandezas se possível, e registra warning pra rastreio.
  let inferredCount = 0;
  for (const l of lots) {
    const sumItems = l.items.reduce((s, i) => s + i.valor, 0);
    if (l.subtotal_vendas === 0 && sumItems > 0) {
      l.subtotal_vendas = Math.round(sumItems * 100) / 100;
      warnings.push(`Lote ${l.numero_reembolso}: subtotal inferido pela soma de items (R$${l.subtotal_vendas.toFixed(2)})`);
      inferredCount++;
    }
    if (l.total_descontos === 0 && l.subtotal_vendas > 0 && l.valor_liquido > 0) {
      const calc = l.subtotal_vendas - l.valor_liquido;
      if (calc > 0) {
        l.total_descontos = Math.round(calc * 100) / 100;
        warnings.push(`Lote ${l.numero_reembolso}: total_descontos inferido (subtotal - liquido = R$${l.total_descontos.toFixed(2)})`);
        inferredCount++;
      }
    }
    if (l.valor_liquido === 0 && l.subtotal_vendas > 0 && l.total_descontos > 0) {
      l.valor_liquido = Math.round((l.subtotal_vendas - l.total_descontos) * 100) / 100;
      warnings.push(`Lote ${l.numero_reembolso}: valor_liquido inferido (subtotal - desc = R$${l.valor_liquido.toFixed(2)})`);
      inferredCount++;
    }
  }
  if (inferredCount > 0) {
    warnings.unshift(`${inferredCount} valor(es) inferidos por fallback (regex flexível não casou direto).`);
  }

  // Diagnóstico se o parser não pegou nada de estrutura conhecida
  if (lots.length === 0) {
    const sampleSale = text.match(SALE_RE);
    const sampleSubtotal = text.match(/Subtotal/);
    const sampleLiq = text.match(/Líquido/);
    warnings.push(`Diagnóstico: SALE matches=${[...text.matchAll(SALE_RE)].length}, sample Subtotal=${!!sampleSubtotal}, sample Líquido=${!!sampleLiq}`);
    if (sampleSale) warnings.push(`Primeiro match venda: ${sampleSale[0].substring(0, 200)}`);
    warnings.push(`Texto recebido (primeiros 500 chars): ${text.substring(0, 500)}`);
  }

  return { lots, warnings };
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

    const { lots, warnings } = parseTicketRefund(raw_text);

    if (lots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote reconhecido no PDF. Verifique se o arquivo é o "Extrato de Reembolsos Detalhado" da Ticket.',
        warnings,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanity: subtotal_vendas == soma items, e (subtotal - total_descontos) == valor_liquido.
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

    let insertedLots = 0;
    let updatedLots = 0;
    let insertedItems = 0;

    for (const l of lots) {
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
        estabelecimento: 'PIZZARIA ESTRELA',
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
