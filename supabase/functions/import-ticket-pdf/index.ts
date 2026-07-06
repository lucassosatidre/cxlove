// @ts-nocheck
// Recebe texto bruto extraído do PDF "Extrato de Reembolsos Detalhado" Ticket Edenred.
// O frontend (pdfjs-dist) envia tudo concatenado por espaço (ordenado por Y desc, X asc),
// sem tentar reconstruir linhas — colunas tabulares têm Y ligeiramente diferente que
// rompiam agrupamento por Y. Aqui usamos regex globais sobre a string contínua e ordenamos
// os matches por posição pra reconstruir a sequência lógica.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { validatePeriodMatch, filterToPeriod } from '../_shared/period-validator.ts';

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
  // Normalize: lowercase + remove accents.
  const d = descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  // Matches por fragmento — robusto contra reordering de pdfjs que pode comer
  // primeira letra ou separar palavras (ex: "axa Manutencao" sem o T).
  if (/manuten/.test(d)) return 'taxa_manutencao';
  if (/tpe/.test(d)) return 'taxa_tpe';
  if (/gestao|gestão/.test(d)) return 'tarifa_gestao';
  if (/transa/.test(d)) return 'tarifa_transacao';
  if (/anuid/.test(d)) return 'anuidade';
  if (/adiantamento/.test(d) || /serpar/.test(d)) return 'tarifa_adiantamento';
  return 'outros';
}

// Descrições que NÃO são descontos — são lançamentos informativos sobre
// antecipação. "Valor Antecipado" é o valor PAGO antecipadamente (igual ao
// líquido em lotes antecipados), não custo.
function isInformationalNotDiscount(descricao: string): boolean {
  const d = descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return /^valor\s+antecipado/.test(d);
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
// MUDANÇA (mai/2026): pdfjs em PDFs longos pode reordenar tokens. Em vez
// de regex restrito do início ao fim do registro, usamos:
//   1. SALE_START_RE — captura o INÍCIO (reembolso + contrato + produto)
//   2. Pra cada match, navegamos até 350 chars buscando o cartão (\*+\d+)
//      e o R$<valor>. Datas e num_doc são extraídos do miolo via regex
//      independentes. Mais resiliente a reordenação de tokens.
const SALE_START_RE = /(\d{8,9})\s+(\d{10,12})\s+(TRE|TAE|TF)\b/g;
const CARD_RE = /\*+\d{4,}/;
const VALOR_RE = /R\$\s*([\d.]+,\d{2}|[\d.,]+)/;
const ALL_DATES_RE = /(\d{2}\/\d{2}\/\d{4})/g;
const CNPJ_RE = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;

// Subtotal: "<reembolso> Subtotal de Vendas R$X". O pdfjs pode reordenar
// "Subtotal de", "Vendas" e "R$X" em qualquer ordem (Y diferentes nas células).
// Aceitamos QUALQUER coisa entre "Subtotal" e o R$X (até 40 chars).
const SUBTOTAL_RE = /(\d{8,9})\s+Subtotal[\s\S]{0,40}?(R\$[\d.,]+)/g;

// Descontos: "<contrato> <data> <descrição até "R$"> R$X"
// Bound o miolo da descrição em até 60 chars pra prevenir ReDoS
// (catastrophic backtracking em PDFs grandes com muitos R$ na string).
// Aceita também "-", ".", "(", ")", dígitos pra cobrir descrições como
// "Anuidade Cartao Tre Ref.", "Taxa Manutencao Mensal - Tre" e
// "Tarifa Sobre Adiantamento (Serpar)".
const DISCOUNT_RE = /(\d{10,12})\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s.\-()]{0,60}?)\s+(R\$[\d.,]+)/g;

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

  // Coleta vendas — abordagem ancorada: pra cada início de venda
  // (reembolso + contrato + produto), navega até 350 chars buscando cartão
  // e R$ valor; datas extraídas do miolo (qualquer ordem).
  for (const m of text.matchAll(SALE_START_RE)) {
    const startPos = m.index!;
    const numReembolso = m[1];
    const numContrato = m[2];
    const produto = m[3];

    // Slice do registro: do início até 350 chars depois (cobre toda venda)
    const slice = text.substring(startPos, startPos + 350);

    // Cartão obrigatório
    const cardMatch = slice.match(CARD_RE);
    if (!cardMatch) continue;

    // Valor APÓS o cartão
    const afterCardOffsetInSlice = (cardMatch.index ?? 0) + cardMatch[0].length;
    const afterCard = slice.substring(afterCardOffsetInSlice);
    const valorMatch = afterCard.match(VALOR_RE);
    if (!valorMatch) continue;
    const valor = parseValor('R$' + valorMatch[1]);
    if (valor == null) continue;

    // CNPJ (opcional, só pra registro)
    const cnpjMatch = afterCard.match(CNPJ_RE);
    const cnpj = cnpjMatch ? cnpjMatch[1] : null;

    // Fim REAL da venda (posição absoluta no text): se temos CNPJ, fim é
    // o fim do CNPJ; senão, fim é o fim do R$valor. Sem isso, o span da
    // venda usava +250 chars fixo, que engolia o 1º desconto em lotes com
    // 1 só venda (caso real abr/26: lotes 430184475 e 431352611 perderam
    // a linha "Taxa Manutenção Mensal" → total_descontos viraram 0).
    const valorEndInAfterCard = (valorMatch.index ?? 0) + valorMatch[0].length;
    const cnpjEndInAfterCard = cnpjMatch ? (cnpjMatch.index ?? 0) + cnpjMatch[0].length : valorEndInAfterCard;
    const saleEndPos = startPos + afterCardOffsetInSlice + cnpjEndInAfterCard;

    // Datas: até 4 esperadas (corte, credito, transacao, postagem)
    // Usa só as que aparecem ANTES do cartão pra evitar capturar datas
    // de outros registros que vieram depois.
    const beforeCard = slice.substring(0, cardMatch.index ?? slice.length);
    const datesIter = [...beforeCard.matchAll(ALL_DATES_RE)];
    const dates = datesIter.map(d => d[1]);
    // Heurística: dates[0]=data_corte, [1]=data_credito, [2]=data_tx, [3]=data_post
    const dataCorte = parseDateBR(dates[0] ?? '');
    const dataCredito = parseDateBR(dates[1] ?? '');
    const dataTx = parseDateBR(dates[2] ?? dates[1] ?? '');
    const dataPost = parseDateBR(dates[3] ?? '');
    if (!dataTx || !dataCredito) continue;

    // num_doc: tokens numéricos no miolo entre dates[3] (ou último date) e cartão
    const lastDateEnd = datesIter.length > 0
      ? (datesIter[datesIter.length - 1].index ?? 0) + datesIter[datesIter.length - 1][0].length
      : 0;
    const miolo = beforeCard
      .substring(lastDateEnd)
      .replace(/TEF/gi, '')
      .replace(/COMPRA/gi, '')
      .replace(/PIZZARIA/gi, '')
      .replace(/ESTRELA/gi, '')
      .trim();
    const mioloTokens = miolo.split(/\s+/).filter(t => t.length > 0);
    const numericTokens = mioloTokens.filter(t => /^\d+$/.test(t));
    const numDoc = numericTokens.length > 0 ? numericTokens.join('') : (mioloTokens[0] ?? null);

    // codEstab: primeiro número entre TRE/TAE/TF e a primeira data
    const headerEnd = m.index! + m[0].length;
    const headerToFirstDate = text.substring(headerEnd, headerEnd + 100);
    const codEstabMatch = headerToFirstDate.match(/\s+(\d+)\s+/);
    const codEstab = codEstabMatch ? codEstabMatch[1] : '';

    events.push({
      kind: 'sale',
      pos: startPos,
      posEnd: saleEndPos,
      numReembolso,
      numContrato,
      produto,
      dataCorte,
      dataCredito,
      codEstab,
      dataTx,
      dataPost,
      numDoc,
      numCartao: cardMatch[0],
      valor,
      cnpj: cnpj ?? '',
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
    .map(e => [(e as any).pos, (e as any).posEnd ?? (e as any).pos + 250] as [number, number]);

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
    // Pula lançamentos informativos (Valor Antecipado é o valor pago, não custo)
    if (isInformationalNotDiscount(descricao)) continue;
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

  // Dedupe items por lote. Quando um lote atravessa quebra de página, a Ticket
  // reimprime a última linha no topo da próxima página (visto em abril/26
  // lote 429498920). Comportamento esperado — não emite warning.
  for (const l of lots) {
    const seen = new Set<string>();
    const filtered: ParsedItem[] = [];
    for (const it of l.items) {
      const sig = `${it.numero_documento ?? ''}|${it.numero_cartao_mascarado ?? ''}|${it.valor.toFixed(2)}|${it.data_transacao}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      filtered.push(it);
    }
    l.items = filtered;
  }

  // Reconciliação aritmética (identidade Ticket: liq = subtotal - descontos).
  // O TOTAL_DESC_RE é frágil — pdfjs reordena "Total Descontos" e "Valor
  // Líquido" e o regex acaba capturando o R$ do líquido como total_descontos.
  // Sempre que dá pra derivar das outras duas grandezas, derivamos. Roda em
  // todo import — não emite warning. Só sinaliza quando uma grandeza estava
  // ausente E não foi derivável (caso anômalo digno de inspeção).
  for (const l of lots) {
    const sumItems = l.items.reduce((s, i) => s + i.valor, 0);
    if (l.subtotal_vendas === 0 && sumItems > 0) {
      l.subtotal_vendas = Math.round(sumItems * 100) / 100;
    }
    // Quando TOTAL_DESC_RE falha (pdfjs reordena Total/Descontos em PDFs
    // longos), derivamos total_descontos da SOMA dos descontos individuais
    // capturados (taxa_tpe + taxa_manutencao + tarifa_gestao + ...). Essa é
    // a fonte mais confiável porque cada discount vem com contrato+data+desc+R$.
    if (l.total_descontos === 0) {
      const sumIndiv = Object.values(l.descontos).reduce((s, v) => s + (Number(v) || 0), 0);
      if (sumIndiv > 0) l.total_descontos = Math.round(sumIndiv * 100) / 100;
    }
    if (l.subtotal_vendas > 0 && l.valor_liquido > 0 && l.subtotal_vendas >= l.valor_liquido) {
      l.total_descontos = Math.round((l.subtotal_vendas - l.valor_liquido) * 100) / 100;
    } else if (l.valor_liquido === 0 && l.subtotal_vendas > 0 && l.total_descontos > 0) {
      l.valor_liquido = Math.round((l.subtotal_vendas - l.total_descontos) * 100) / 100;
    } else if (l.valor_liquido === 0 && l.subtotal_vendas > 0 && l.total_descontos === 0) {
      l.valor_liquido = l.subtotal_vendas;
    } else if (l.subtotal_vendas === 0 || l.valor_liquido === 0) {
      warnings.push(`Lote ${l.numero_reembolso}: grandezas incompletas após parse (sub=${l.subtotal_vendas} desc=${l.total_descontos} liq=${l.valor_liquido}).`);
    }
  }

  // Diagnóstico se o parser não pegou nada de estrutura conhecida
  if (lots.length === 0) {
    const saleStartMatches = [...text.matchAll(SALE_START_RE)];
    const sampleSubtotal = text.match(/Subtotal/);
    const sampleLiq = text.match(/Líquido/);
    warnings.push(`Diagnóstico: SALE_START matches=${saleStartMatches.length}, sample Subtotal=${!!sampleSubtotal}, sample Líquido=${!!sampleLiq}`);
    if (saleStartMatches[0]) warnings.push(`Primeiro match venda: ${saleStartMatches[0][0].substring(0, 200)}`);
    warnings.push(`Texto recebido (primeiros 500 chars): ${text.substring(0, 500)}`);
  }

  return { lots, warnings };
}

// ============================================================
// Handler
// ============================================================
// ============================================================
// Parser do MESMO "Extrato de Reembolso Detalhado" da Ticket, mas em XLSX
// (o portal Edenred passou a exportar planilha em vez de PDF). Colunas
// detectadas por NOME. Cada Nº de reembolso agrupa suas vendas (linhas
// COMPRA/TEF) + linhas-resumo (Subtotal de Vendas / Tarifas / Total de
// Descontos / Valor Líquido). Devolve a MESMA estrutura ParsedLot do PDF,
// então todo o roteamento/insert a jusante é idêntico.
// ============================================================
function parseTicketRefundXlsx(rows: any[][]): { lots: ParsedLot[]; warnings: string[] } {
  const warnings: string[] = [];
  const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const c = (rows[i] || []).map(norm);
    if (c.some((x: string) => x.includes('reembolso')) && c.some((x: string) => x.includes('valor da transac'))) { hi = i; break; }
  }
  if (hi < 0) return { lots: [], warnings: ['Cabeçalho XLSX Ticket não encontrado (esperado "Número do reembolso" + "Valor da transação").'] };
  const hdr = (rows[hi] || []).map(norm);
  const ci = (...needles: string[]) => hdr.findIndex((h: string) => needles.some((n) => h.includes(n)));
  const cReemb = ci('numero do reembolso', 'reembolso');
  const cContr = ci('numero do contrato', 'contrato');
  const cProd = ci('produto');
  const cCorte = ci('data de corte', 'corte');
  const cCred = ci('credito', 'debito');
  const cEstab = ci('cod');
  const cTx = ci('data da transac');
  const cPost = ci('data de postagem', 'postagem');
  const cDoc = ci('numero do documento', 'documento');
  const cTipo = ci('tipo de transac');
  const cDesc = ci('descricao do lancamento', 'descricao');
  const cCartao = ci('numero do cartao', 'cartao');
  const cVal = ci('valor da transac');
  const cCnpj = ci('cnpj');

  const xdate = (v: any): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  };
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const lots: ParsedLot[] = [];
  const byReemb: Record<string, ParsedLot> = {};
  let current: ParsedLot | null = null;
  for (const r of rows.slice(hi + 1)) {
    if (!r || !r.some((c: any) => c != null && String(c).trim() !== '')) continue;
    const reemb = String(r[cReemb] ?? '').trim();
    const desc = String(r[cDesc] ?? '').trim();
    const tipo = String(r[cTipo] ?? '').trim().toLowerCase();
    const dl = desc.toLowerCase();
    const valor = parseValor(String(r[cVal] ?? ''));
    const isCompra = tipo === 'tef' || /compra/.test(dl);
    if (isCompra && reemb) {
      if (!byReemb[reemb]) {
        current = {
          numero_reembolso: reemb,
          numero_contrato: String(r[cContr] ?? '').trim(),
          produto: String(r[cProd] ?? '').trim(),
          data_corte: xdate(r[cCorte]),
          data_credito: xdate(r[cCred]) ?? '',
          cod_estabelecimento: String(r[cEstab] ?? '').trim() || null,
          items: [], subtotal_vendas: 0, descontos: {}, total_descontos: 0, valor_liquido: 0,
        };
        byReemb[reemb] = current;
        lots.push(current);
      } else {
        current = byReemb[reemb];
      }
      if (valor != null) current.items.push({
        data_transacao: xdate(r[cTx]) ?? '',
        data_postagem: xdate(r[cPost]),
        numero_documento: String(r[cDoc] ?? '').trim() || null,
        numero_cartao_mascarado: String(r[cCartao] ?? '').trim() || null,
        valor,
        cnpj: String(r[cCnpj] ?? '').trim() || null,
      });
      continue;
    }
    // Linhas-resumo: pertencem ao lote da própria linha (col reembolso) ou ao corrente.
    const lot = (reemb && byReemb[reemb]) ? byReemb[reemb] : current;
    if (!lot || valor == null) continue;
    if (/subtotal de vendas/.test(dl)) lot.subtotal_vendas = valor;
    else if (/total de descontos/.test(dl)) lot.total_descontos = valor;
    else if (/valor l[ií]quido/.test(dl)) lot.valor_liquido = valor;
    else if (isInformationalNotDiscount(desc)) { /* Valor Antecipado: informativo, não é custo */ }
    else if (valor !== 0) { const k = normalizeDiscountKey(desc); lot.descontos[k] = (lot.descontos[k] ?? 0) + valor; }
  }
  // Reconciliação dos campos faltantes (espelha o parser de PDF).
  for (const l of lots) {
    const sumDesc = Object.values(l.descontos).reduce((s, v) => s + v, 0);
    if (!l.subtotal_vendas) l.subtotal_vendas = round2(l.items.reduce((s, it) => s + it.valor, 0));
    if (!l.total_descontos && sumDesc) l.total_descontos = round2(sumDesc);
    if (!l.valor_liquido) l.valor_liquido = round2(l.subtotal_vendas - l.total_descontos);
    if (!l.items.length) warnings.push(`Lote ${l.numero_reembolso} sem itens de venda.`);
  }
  return { lots, warnings };
}

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
    const { audit_period_id, file_name, raw_text, rows } = body || {};
    const isXlsx = Array.isArray(rows) && rows.length > 0;
    if (!audit_period_id || !file_name || (!raw_text && !isXlsx)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, e raw_text [PDF] ou rows [XLSX])' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period, error: periodErr } = await supabase
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
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

    console.log(`[import-ticket-pdf] starting parse — ${isXlsx ? `xlsx rows=${rows.length}` : `pdf text length=${raw_text?.length ?? 0}`}`);

    let lots: any[] = [];
    let warnings: string[] = [];
    try {
      const result = isXlsx ? parseTicketRefundXlsx(rows) : parseTicketRefund(raw_text);
      lots = result.lots;
      warnings = result.warnings;
      console.log(`[import-ticket-pdf] parse OK — ${lots.length} lots, ${warnings.length} warnings`);
    } catch (parseErr: any) {
      console.error('[import-ticket-pdf] parse threw', parseErr);
      return new Response(JSON.stringify({
        error: `Erro ao parsear ${isXlsx ? 'XLSX' : 'PDF'}: ${parseErr?.message ?? 'erro desconhecido'}`,
        diagnostic: { source: isXlsx ? 'xlsx' : 'pdf', text_length: raw_text?.length ?? 0, rows_length: isXlsx ? rows.length : 0 },
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (lots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote reconhecido. Verifique se o arquivo é o "Extrato de Reembolsos Detalhado" da Ticket (PDF ou XLSX).',
        warnings,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Competência do lote = MÊS DA VENDA (data_transacao predominante em valor),
    // não o mês do crédito no banco. Igual Alelo/Pluxee. Lote sem items (raro)
    // cai em data_credito.
    function lotCompYM(l: any): string | null {
      if (!l.items || l.items.length === 0) return l.data_credito?.slice(0, 7) ?? null;
      const byMonth: Record<string, number> = {};
      for (const it of l.items) {
        const ym = it.data_transacao?.slice(0, 7);
        if (!ym) continue;
        byMonth[ym] = (byMonth[ym] ?? 0) + Number(it.valor ?? 0);
      }
      const sorted = Object.entries(byMonth).sort(([, a], [, b]) => b - a);
      return sorted[0]?.[0] ?? l.data_credito?.slice(0, 7) ?? null;
    }

    // Validação: garante que o arquivo tem linhas nos meses ao redor do período
    // (guarda contra arquivo do mês totalmente errado). O filtro abaixo é quem
    // restringe de fato ao mês da auditoria.
    const periodCheck = validatePeriodMatch(
      lots.map((l: any) => { const ym = lotCompYM(l); return ym ? `${ym}-01` : null; }),
      { month: period.month, year: period.year },
      'Ticket',
      [-2, -1, 0, 1, 2, 3],
    );
    if (!periodCheck.ok) {
      return new Response(JSON.stringify({
        error: periodCheck.error,
        breakdown_by_month: periodCheck.breakdown,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Mantém APENAS lotes cuja competência (mês da venda) é a do período da
    // auditoria; DESCARTA os demais (ex.: vendas de maio que só caíram no banco
    // em junho). Espelha o import-alelo-xlsx: nada é gravado em outros períodos
    // e nunca bloqueia por período fechado.
    const periodFilter = filterToPeriod(
      lots,
      (l: any) => { const ym = lotCompYM(l); return ym ? `${ym}-01` : null; },
      { month: period.month, year: period.year },
      [0],
    );
    const lotsKept = periodFilter.kept;

    if (lotsKept.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        total_lots: lots.length,
        kept_in_period: 0,
        inserted_lots: 0,
        updated_lots: 0,
        skipped_outside_period: periodFilter.skipped,
        skipped_outside_period_by_month: periodFilter.skippedByMonth,
        message: `Nenhum lote com competência de ${String(period.month).padStart(2, '0')}/${period.year} neste arquivo. ${periodFilter.skipped} lote(s) de outros meses foram desconsiderados.`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const totalItems = lotsKept.reduce((s, l) => s + l.items.length, 0);

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
    const lotErrors: string[] = [];

    for (const l of lotsKept) {
      try {
        // Reconciliação aritmética. O TOTAL_DESC_RE é frágil — pdfjs reordena
        // "Total Descontos" e "Valor Líquido" e a regex acaba capturando o R$
        // do líquido (sintoma observado: total_descontos == valor_liquido em ~90%
        // dos lotes). A identidade do extrato Ticket é
        //   valor_liquido = subtotal_vendas - total_descontos
        // então derivamos descontos sempre que tivermos subtotal e líquido.
        const sumItems = l.items.reduce((s, i) => s + i.valor, 0);
        if (l.subtotal_vendas === 0 && sumItems > 0) {
          l.subtotal_vendas = Math.round(sumItems * 100) / 100;
        }
        // Mesma derivação aplicada no parser — total_descontos = soma dos
        // descontos individuais quando o regex de "Total Descontos" falhou.
        if (l.total_descontos === 0) {
          const sumIndiv = Object.values(l.descontos ?? {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
          if (sumIndiv > 0) l.total_descontos = Math.round(sumIndiv * 100) / 100;
        }
        if (l.subtotal_vendas > 0 && l.valor_liquido > 0 && l.subtotal_vendas >= l.valor_liquido) {
          l.total_descontos = Math.round((l.subtotal_vendas - l.valor_liquido) * 100) / 100;
        } else if (l.valor_liquido === 0 && l.subtotal_vendas > 0 && l.total_descontos > 0
                   && l.subtotal_vendas >= l.total_descontos) {
          l.valor_liquido = Math.round((l.subtotal_vendas - l.total_descontos) * 100) / 100;
        } else if (l.valor_liquido === 0 && l.subtotal_vendas > 0 && l.total_descontos === 0) {
          l.valor_liquido = l.subtotal_vendas;
        }

        // Cada lote vai pro audit_period correspondente ao MÊS DAS VENDAS
        // (data_transacao predominante). PDF cobrindo abril+maio importado
        // em abril: lotes com vendas em março → period março; vendas em abril
        // → period abril; vendas em maio → period maio. Auditoria por
        // competência da venda, independente do crédito.
        const lotPeriodKey = lotCompYM(l) ?? '';
        const lotTargetPeriodId = targetPeriodIdByYM[lotPeriodKey] ?? audit_period_id;

        // Checagem GLOBAL pelo numero_reembolso: se o lote já existe em
        // audit_period DIFERENTE do destino calculado, atualiza no lugar
        // (re-import legítimo após correção de dados). Cada reembolso vive
        // em UM período — o da sua data_credito.
        const { data: anyExisting } = await supabase
          .from('audit_voucher_lots')
          .select('id, audit_period_id')
          .eq('operadora', 'ticket')
          .eq('numero_reembolso', l.numero_reembolso)
          .maybeSingle();
        const existing = anyExisting ?? null;

        const lotPayload = {
          audit_period_id: lotTargetPeriodId,
          operadora: 'ticket',
          numero_reembolso: String(l.numero_reembolso ?? ''),
          numero_contrato: l.numero_contrato ?? null,
          produto: l.produto ?? null,
          data_corte: l.data_corte ?? null,
          data_credito: l.data_credito,
          subtotal_vendas: Number(l.subtotal_vendas ?? 0),
          total_descontos: Number(l.total_descontos ?? 0),
          valor_liquido: Number(l.valor_liquido ?? 0),
          descontos: l.descontos ?? {},
          import_id: importRec.id,
        };

        let lotId: string;

        if (existing) {
          const { error: updErr } = await supabase
            .from('audit_voucher_lots')
            .update(lotPayload)
            .eq('id', existing.id);
          if (updErr) throw new Error(`update: ${updErr.message}`);
          await supabase.from('audit_voucher_lot_items').delete().eq('lot_id', existing.id);
          lotId = existing.id;
          updatedLots++;
        } else {
          const { data: inserted, error: insErr } = await supabase
            .from('audit_voucher_lots')
            .insert(lotPayload)
            .select('id')
            .single();
          if (insErr || !inserted) throw new Error(`insert: ${insErr?.message ?? 'sem dado'}`);
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
          if (itErr) throw new Error(`items: ${itErr.message}`);
          insertedItems += itemsPayload.length;
        }
      } catch (e: any) {
        // Erro no lote individual NÃO interrompe os demais — registra e continua
        const msg = `Lote ${l.numero_reembolso}: ${e?.message ?? 'erro'}`;
        lotErrors.push(msg);
        console.error('[import-ticket-pdf]', msg);
      }
    }

    // Se TODOS os lotes falharam, marca import como erro
    if (insertedLots === 0 && updatedLots === 0 && lotErrors.length > 0) {
      await supabase.from('audit_imports').update({
        status: 'error',
        error_message: lotErrors.slice(0, 5).join(' | '),
      }).eq('id', importRec.id);
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

    const periodsTouched = Object.entries(lotsByTargetPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, n]) => `${ym}: ${n} lote(s)`).join(' / ');

    return new Response(JSON.stringify({
      success: true,
      total_lots: lots.length,
      kept_in_period: lotsKept.length,
      lots_by_target_period: lotsByTargetPeriod,
      inserted_lots: insertedLots,
      updated_lots: updatedLots,
      total_items: totalItems,
      inserted_items: insertedItems,
      integrity_errors: integrityErrors,
      lot_errors: lotErrors.slice(0, 10),
      lot_errors_count: lotErrors.length,
      warnings: warnings.slice(0, 20),
      message: `${insertedLots} novos + ${updatedLots} atualizados (${insertedItems} vendas) — distribuído em ${periodsTouched}${lotErrors.length > 0 ? ` — ${lotErrors.length} lote(s) com erro` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-ticket-pdf error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
