// @ts-nocheck
// import-ifood-extrato-detalhado — fonte da verdade do iFood Marketplace v2.
//
// Importa o "Extrato Detalhado" exportado do Portal Parceiro iFood (Financeiro
// → Extrato Detalhado → XLSX, 28 colunas). 1 arquivo por loja (Estrela ou Temx).
//
// Headers (linha 1):
// 1=competencia, 2=fato_gerador, 3=tipo_lancamento, 4=descricao_lancamento,
// 5=valor, 6=base_calculo, 7=percentual_taxa,
// 8=pedido_associado_ifood, 9=pedido_associado_ifood_curto,
// 10=motivo_cancelamento, 11=descricao_ocorrencia,
// 12=data_criacao_pedido_associado, 13=data_repasse_esperada,
// 14=valor_transacao, 15=loja_id, 16=loja_id_curto,
// 17=cnpj, 18=data_faturamento, 19=data_apuracao_inicio, 20=data_apuracao_fim,
// 21=valor_cesta_final, 22=responsavel_transacao, 23=canal_vendas,
// 24=impacto_no_repasse, 25=pedido_detalhes, 26=id_saldo,
// 27=metodo_pagamento, 28=bandeira_pagamento
//
// Após inserir lançamentos, agrega audit_ifood_repasses (DELETE+INSERT por
// period+store, idempotente).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ─── helpers ───────────────────────────────────────────────────────────────
function excelSerialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

// Aplicar -3h shift quando string ISO timestamp UTC vem do JSON.stringify
// (mesmo bug pattern fix Brendi commit 772b7bc).
function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const brt = new Date(v.getTime() - 3 * 60 * 60 * 1000);
    return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 100000) {
    return toIsoDate(excelSerialToDate(v));
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
      return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`;
    }
  }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toIsoDateTime(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 100000) {
    return excelSerialToDate(v).toISOString();
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, dd, mm, yyyy, h, min, sec] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${sec ?? '00'}-03:00`;
  }
  return null;
}

function toNum(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[R$\s]/gi, '');
  if (!s) return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot === -1 && lastComma === -1) return Number(s) || 0;
  const decimalSep = lastDot > lastComma ? '.' : ',';
  const thousandSep = decimalSep === '.' ? ',' : '.';
  s = s.split(thousandSep).join('').replace(decimalSep, '.');
  return Number(s) || 0;
}

function toStr(v: any): string | null {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

function normLower(s: string | null): string {
  return (s ?? '').normalize('NFC').trim().toLowerCase();
}

// Classificação de categoria_calc — bucket derivado pra agregar em repasses.
// Ordem do if importa (especificidade decrescente).
function classificar(fato: string | null, tipo: string | null, desc: string | null): string {
  const f = normLower(fato);
  const t = normLower(tipo);
  const d = normLower(desc);

  if (f === 'venda' && t === 'entrada financeira') return 'bruto_venda';

  if (f === 'venda' && d.includes('comissão do ifood')) return 'comissao';
  if (f === 'venda' && d.includes('comissao do ifood')) return 'comissao';

  if (f === 'venda' && t === 'cobrança' && d.includes('taxa de transação')) return 'taxa_transacao';
  if (f === 'venda' && t === 'cobranca' && d.includes('taxa de transacao')) return 'taxa_transacao';

  if (f === 'venda' && t === 'subsídio' && d.includes('custeada pelo ifood')) return 'promo_ifood';
  if (f === 'venda' && t === 'subsidio' && d.includes('custeada pelo ifood')) return 'promo_ifood';

  if (f === 'venda' && t === 'subsídio' && d.includes('custeada pela loja')) return 'promo_loja';
  if (f === 'venda' && t === 'subsidio' && d.includes('custeada pela loja')) return 'promo_loja';

  if (f === 'venda' && t === 'retenção' && d.includes('taxa de serviço')) return 'taxa_servico_cliente';
  if (f === 'venda' && t === 'retencao' && d.includes('taxa de servico')) return 'taxa_servico_cliente';

  if (f === 'venda' && t === 'retenção' && d.includes('conveniência')) return 'taxa_conveniencia';
  if (f === 'venda' && t === 'retencao' && d.includes('conveniencia')) return 'taxa_conveniencia';

  if (f === 'venda' && t === 'retenção' && d.includes('taxa entrega')) return 'taxa_entrega_ret';
  if (f === 'venda' && t === 'retencao' && d.includes('taxa entrega')) return 'taxa_entrega_ret';

  if (f === 'venda' && t === 'cobrança' && d.includes('serviço de entrega')) return 'taxa_servico_sob_demanda';
  if (f === 'venda' && t === 'cobranca' && d.includes('servico de entrega')) return 'taxa_servico_sob_demanda';

  if (f === 'venda' && t === 'reembolso') return 'reembolsos';

  if (f === 'solicitação frete' || f === 'solicitacao frete') return 'frete_ifood';
  if (f === 'cancelamento solicitação frete' || f === 'cancelamento solicitacao frete') return 'cancel_frete';
  if (f === 'cancelamento total') return 'cancel_total';
  if (f === 'cancelamento parcial') return 'cancel_parcial';
  // "Ocorrência avulsa" no iFood é guarda-chuva: ADS (pacote de anúncios) +
  // Frota Garantida (logística contratada) + ajustes diversos. Separar pela
  // descrição é único caminho — fato_gerador é idêntico em todos.
  if (f === 'ocorrência avulsa' || f === 'ocorrencia avulsa') {
    if (d.includes('pacote de anúncios') || d.includes('pacote de anuncios')) return 'ads';
    if (d.includes('frota garantida')) return 'frete_garantido';
    return 'outros_avulsos';
  }
  if (f === 'ocorrência venda' || f === 'ocorrencia venda') return 'ocor_venda';
  if (f === 'ressarcimento/indenização' || f === 'ressarcimento/indenizacao') return 'ressarc';
  if (f === 'fechamento') return 'mensalidade';

  return 'outros';
}

// Calcula data_repasse_esperada a partir de uma data base (data do pedido OU data
// de apuração fim — ambas servem como referência pro ciclo iFood).
// Regra iFood Pago (com antecipação automática contratada — modelo padrão fev/26):
//   1. Corte = próximo domingo (>= base), OU último dia do mês se vier antes
//   2. data_repasse = próxima quarta-feira após o corte (D+3 se corte é dom, D+4 se sáb)
// Validado contra portal iFood fev/26:
//   - Corte 01/02 (dom) → repasse 04/02 (qua, D+3)
//   - Corte 08/02 (dom) → repasse 11/02 (qua, D+3)
//   - Corte 28/02 (sáb, fim do mês) → repasse 04/03 (qua, D+4)
// (O modelo antigo D+24 era pra lojas SEM antecipação — virou caso raro. A coluna
// `data_repasse_esperada` do XLSX traz D+24 mesmo com antecipação ativa, então
// ignoramos ela e calculamos pelo ciclo real.)
function calcDataRepasseFromPedido(baseIso: string | null): string | null {
  if (!baseIso) return null;
  const [y, m, d] = baseIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun, 6=Sat
  const daysUntilSunday = (7 - dow) % 7;
  const sundayCorte = new Date(dt.getTime() + daysUntilSunday * 86400000);
  const lastDay = new Date(Date.UTC(y, m, 0)); // dia 0 do mês seguinte = último do mês
  const useMonthEnd = lastDay < sundayCorte && lastDay >= dt;
  const corte = useMonthEnd ? lastDay : sundayCorte;
  // Próxima quarta-feira após o corte
  const corteDow = corte.getUTCDay();
  const daysUntilWed = ((3 - corteDow + 7) % 7) || 7; // se corte for qua, vai pra próxima qua (+7)
  const repasse = new Date(corte.getTime() + daysUntilWed * 86400000);
  return `${repasse.getUTCFullYear()}-${String(repasse.getUTCMonth() + 1).padStart(2, '0')}-${String(repasse.getUTCDate()).padStart(2, '0')}`;
}

// Recua 21 dias de uma data D+24 (formato YYYY-MM-DD). Usado como fallback quando
// não temos data_pedido nem data_apuracao mas a coluna data_repasse_esperada do
// XLSX existe (linhas tipo mensalidade/ADS sem pedido associado).
function shiftBack21d(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - 21 * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ─── Server ────────────────────────────────────────────────────────────────
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
    const { audit_period_id, file_name, rows } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, rows)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period, error: periodErr } = await supabase
      .from('audit_periods').select('id,month,year,status').eq('id', audit_period_id).maybeSingle();
    if (periodErr || !period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (period.status === 'fechado') {
      return new Response(JSON.stringify({ error: 'Período fechado. Reabra antes de adicionar imports.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Header detection: linha 0-2 com "competencia" + "fato_gerador"
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => normLower(c == null ? null : String(c)));
      if (cells.some(c => c === 'competencia') && cells.some(c => c === 'fato_gerador')) {
        headerIdx = i; break;
      }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header não encontrado. Esperado: "competencia" e "fato_gerador" na linha 1.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const COL = {
      competencia: 0, fato: 1, tipo: 2, desc: 3,
      valor: 4, base: 5, pct: 6,
      pedido: 7, pedido_curto: 8,
      motivo_cancel: 9, desc_ocor: 10,
      data_criacao: 11, data_repasse: 12,
      valor_transacao: 13, loja_id: 14, loja_id_curto: 15,
      cnpj: 16, data_faturamento: 17,
      data_apur_ini: 18, data_apur_fim: 19,
      valor_cesta: 20, responsavel: 21, canal: 22,
      impacto: 23, pedido_detalhes: 24, id_saldo: 25,
      metodo: 26, bandeira: 27,
    };

    const dataRows = rows.slice(headerIdx + 1).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
    const totalRows = dataRows.length;

    // Detecta competência + loja a partir das linhas de dados
    let competenciaArquivo: string | null = null;
    let storeIdCurto: string | null = null;
    let lojaIdLong: string | null = null;
    for (const r of dataRows) {
      const comp = toStr(r[COL.competencia]);
      const sid = toStr(r[COL.loja_id_curto]);
      const lid = toStr(r[COL.loja_id]);
      if (comp && !competenciaArquivo) competenciaArquivo = comp;
      if (sid && !storeIdCurto) storeIdCurto = sid;
      if (lid && !lojaIdLong) lojaIdLong = lid;
      if (competenciaArquivo && storeIdCurto) break;
    }

    if (!competenciaArquivo) {
      return new Response(JSON.stringify({ error: 'Não foi possível detectar a competência (col competencia vazia em todas as linhas).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!storeIdCurto) {
      return new Response(JSON.stringify({ error: 'Não foi possível detectar a loja (col loja_id_curto vazia em todas as linhas).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validador de competência: deve bater com period.month/year
    const expectedComp = `${period.year}-${String(period.month).padStart(2, '0')}`;
    if (competenciaArquivo !== expectedComp) {
      return new Response(JSON.stringify({
        error: `Competência do arquivo (${competenciaArquivo}) diferente do período aberto (${expectedComp}). Reabra o período correto antes de importar.`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Cleanup: DELETE lançamentos e repasses anteriores desta loja+period
    await supabase
      .from('audit_ifood_lancamentos')
      .delete()
      .eq('audit_period_id', audit_period_id)
      .eq('store_id_curto', storeIdCurto);
    await supabase
      .from('audit_ifood_repasses')
      .delete()
      .eq('audit_period_id', audit_period_id)
      .eq('store_id_curto', storeIdCurto);

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'ifood_extrato_detalhado',
        file_name,
        total_rows: totalRows,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar import: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Monta linhas pra inserir
    const lancamentos: any[] = [];
    const seenStores = new Set<string>();
    const compsSeen = new Set<string>();
    const breakdownByCategoria: Record<string, { count: number; soma: number }> = {};

    let idx = 0;
    for (const r of dataRows) {
      const comp = toStr(r[COL.competencia]);
      const fato = toStr(r[COL.fato]);
      const tipo = toStr(r[COL.tipo]);
      const desc = toStr(r[COL.desc]);
      const valor = toNum(r[COL.valor]);
      const sidRow = toStr(r[COL.loja_id_curto]);
      const impacto = toStr(r[COL.impacto]);

      // Toda linha precisa ser da MESMA loja+comp do arquivo
      if (sidRow && sidRow !== storeIdCurto) {
        // Saída defensiva — deveria nunca acontecer (cada arquivo é 1 loja)
        return new Response(JSON.stringify({
          error: `Arquivo contém múltiplas lojas (${storeIdCurto} e ${sidRow}). Exporte 1 arquivo por loja.`,
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (comp) compsSeen.add(comp);
      if (sidRow) seenStores.add(sidRow);

      const categoria = classificar(fato, tipo, desc);
      breakdownByCategoria[categoria] = breakdownByCategoria[categoria]
        ?? { count: 0, soma: 0 };
      breakdownByCategoria[categoria].count++;
      breakdownByCategoria[categoria].soma += valor;

      lancamentos.push({
        audit_period_id,
        import_id: importRec.id,
        store_id_curto: storeIdCurto,
        idx_arquivo: idx,
        competencia: comp,
        fato_gerador: fato,
        tipo_lancamento: tipo,
        descricao_lancamento: desc,
        valor,
        base_calculo: toNum(r[COL.base]),
        percentual_taxa: toNum(r[COL.pct]) || null,
        pedido_associado_ifood: toStr(r[COL.pedido]),
        pedido_associado_ifood_curto: toStr(r[COL.pedido_curto]),
        motivo_cancelamento: toStr(r[COL.motivo_cancel]),
        descricao_ocorrencia: toStr(r[COL.desc_ocor]),
        data_criacao_pedido_associado: toIsoDateTime(r[COL.data_criacao]),
        data_repasse_esperada: toIsoDate(r[COL.data_repasse]),
        valor_transacao: toNum(r[COL.valor_transacao]),
        loja_id: toStr(r[COL.loja_id]),
        loja_id_curto: sidRow,
        cnpj: toStr(r[COL.cnpj]),
        data_faturamento: toIsoDate(r[COL.data_faturamento]),
        data_apuracao_inicio: toIsoDate(r[COL.data_apur_ini]),
        data_apuracao_fim: toIsoDate(r[COL.data_apur_fim]),
        valor_cesta_final: toNum(r[COL.valor_cesta]),
        responsavel_transacao: toStr(r[COL.responsavel]),
        canal_vendas: toStr(r[COL.canal]),
        impacto_no_repasse: impacto,
        pedido_detalhes: toStr(r[COL.pedido_detalhes]),
        id_saldo: toStr(r[COL.id_saldo]),
        metodo_pagamento: toStr(r[COL.metodo]),
        bandeira_pagamento: toStr(r[COL.bandeira]),
        categoria_calc: categoria,
      });
      idx++;
    }

    // Insert chunked
    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < lancamentos.length; i += CHUNK) {
      const chunk = lancamentos.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_ifood_lancamentos')
        .insert(chunk);
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: insErr.message, imported_rows: inserted,
        }).eq('id', importRec.id);
        return new Response(JSON.stringify({ error: `Erro ao inserir lançamentos: ${insErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted += chunk.length;
    }

    // ─── Agregação em audit_ifood_repasses ─────────────────────────────────
    // Separar por (data_repasse_esperada, store_id_curto). Para impacto=NÃO
    // (pgto-direto-loja) usamos data calculada via data_criacao_pedido.
    type RepasseAcc = {
      bruto_venda: number; pgto_direto_loja: number;
      comissao: number; taxa_transacao: number; taxa_conveniencia: number;
      taxa_entrega_ret: number; taxa_servico_sob_demanda: number;
      taxa_servico_cliente: number; promo_ifood: number; promo_loja: number;
      frete_ifood: number; cancel_frete: number; cancel_total: number; cancel_parcial: number;
      ads: number; frete_garantido: number; outros_avulsos: number;
      ressarc: number; ocor_venda: number; reembolsos: number;
      mensalidade: number; outros: number;
      liquido_esperado: number;
      periodo_apuracao_inicio: string | null;
      periodo_apuracao_fim: string | null;
    };
    const acc = new Map<string, RepasseAcc>();
    const newAcc = (): RepasseAcc => ({
      bruto_venda: 0, pgto_direto_loja: 0,
      comissao: 0, taxa_transacao: 0, taxa_conveniencia: 0,
      taxa_entrega_ret: 0, taxa_servico_sob_demanda: 0,
      taxa_servico_cliente: 0, promo_ifood: 0, promo_loja: 0,
      frete_ifood: 0, cancel_frete: 0, cancel_total: 0, cancel_parcial: 0,
      ads: 0, frete_garantido: 0, outros_avulsos: 0,
      ressarc: 0, ocor_venda: 0, reembolsos: 0,
      mensalidade: 0, outros: 0,
      liquido_esperado: 0,
      periodo_apuracao_inicio: null, periodo_apuracao_fim: null,
    });

    let dataRepasseAusenteCount = 0;
    let dataRepasseAusenteValor = 0;
    for (const l of lancamentos) {
      const isImpactoSim = l.impacto_no_repasse === 'SIM';
      // SEMPRE calcula data_repasse pela regra D+3/D+4 (modelo com antecipação
      // automática). A coluna data_repasse_esperada do XLSX traz D+24 mesmo com
      // antecipação ativa — não confiamos nela. Ordem de fallback:
      //   1) data_criacao_pedido_associado (preferido, vendas têm pedido)
      //   2) data_apuracao_fim (fim do período de apuração)
      //   3) data_repasse_esperada do XLSX − 21 dias (linhas sem pedido nem apuração)
      let dataRepasse: string | null =
        calcDataRepasseFromPedido(l.data_criacao_pedido_associado)
        ?? calcDataRepasseFromPedido(l.data_apuracao_fim)
        ?? shiftBack21d(l.data_repasse_esperada);
      if (!dataRepasse) {
        // Lançamento sem qualquer data utilizável — não é agregado em nenhum
        // repasse, então some do líquido_esperado consolidado. Conta pra
        // exibir no toast/log no front.
        dataRepasseAusenteCount += 1;
        dataRepasseAusenteValor += Number(l.valor ?? 0);
        continue;
      }
      const key = dataRepasse;
      if (!acc.has(key)) acc.set(key, newAcc());
      const a = acc.get(key)!;

      // Se é impacto=SIM e categoria é uma das somáveis, atualiza decomposição
      if (isImpactoSim) {
        a.liquido_esperado += l.valor;
        switch (l.categoria_calc) {
          case 'bruto_venda': a.bruto_venda += l.valor; break;
          case 'comissao': a.comissao += l.valor; break;
          case 'taxa_transacao': a.taxa_transacao += l.valor; break;
          case 'taxa_conveniencia': a.taxa_conveniencia += l.valor; break;
          case 'taxa_entrega_ret': a.taxa_entrega_ret += l.valor; break;
          case 'taxa_servico_sob_demanda': a.taxa_servico_sob_demanda += l.valor; break;
          case 'taxa_servico_cliente': a.taxa_servico_cliente += l.valor; break;
          case 'promo_ifood': a.promo_ifood += l.valor; break;
          case 'frete_ifood': a.frete_ifood += l.valor; break;
          case 'cancel_frete': a.cancel_frete += l.valor; break;
          case 'cancel_total': a.cancel_total += l.valor; break;
          case 'cancel_parcial': a.cancel_parcial += l.valor; break;
          case 'ads': a.ads += l.valor; break;
          case 'frete_garantido': a.frete_garantido += l.valor; break;
          case 'outros_avulsos': a.outros_avulsos += l.valor; break;
          case 'ressarc': a.ressarc += l.valor; break;
          case 'ocor_venda': a.ocor_venda += l.valor; break;
          case 'reembolsos': a.reembolsos += l.valor; break;
          case 'mensalidade': a.mensalidade += l.valor; break;
          default: a.outros += l.valor;
        }
        // janela de apuração
        if (l.data_apuracao_inicio && (!a.periodo_apuracao_inicio || l.data_apuracao_inicio < a.periodo_apuracao_inicio)) {
          a.periodo_apuracao_inicio = l.data_apuracao_inicio;
        }
        if (l.data_apuracao_fim && (!a.periodo_apuracao_fim || l.data_apuracao_fim > a.periodo_apuracao_fim)) {
          a.periodo_apuracao_fim = l.data_apuracao_fim;
        }
      } else {
        // impacto=NÃO: vai pra pgto_direto_loja (Entrada Financeira) ou promo_loja
        if (l.tipo_lancamento && normLower(l.tipo_lancamento) === 'entrada financeira') {
          a.pgto_direto_loja += l.valor;
        } else if (l.categoria_calc === 'promo_loja') {
          a.promo_loja += l.valor;
        }
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const repassesPayload = Array.from(acc.entries()).map(([dataRepasse, a]) => ({
      audit_period_id,
      store_id_curto: storeIdCurto,
      data_repasse_esperada: dataRepasse,
      periodo_apuracao_inicio: a.periodo_apuracao_inicio,
      periodo_apuracao_fim: a.periodo_apuracao_fim,
      bruto_venda: round2(a.bruto_venda),
      pgto_direto_loja: round2(a.pgto_direto_loja),
      comissao: round2(a.comissao),
      taxa_transacao: round2(a.taxa_transacao),
      taxa_conveniencia: round2(a.taxa_conveniencia),
      taxa_entrega_ret: round2(a.taxa_entrega_ret),
      taxa_servico_sob_demanda: round2(a.taxa_servico_sob_demanda),
      taxa_servico_cliente: round2(a.taxa_servico_cliente),
      promo_ifood: round2(a.promo_ifood),
      promo_loja: round2(a.promo_loja),
      frete_ifood: round2(a.frete_ifood),
      cancel_frete: round2(a.cancel_frete),
      cancel_total: round2(a.cancel_total),
      cancel_parcial: round2(a.cancel_parcial),
      ads: round2(a.ads),
      frete_garantido: round2(a.frete_garantido),
      outros_avulsos: round2(a.outros_avulsos),
      ressarc: round2(a.ressarc),
      ocor_venda: round2(a.ocor_venda),
      reembolsos: round2(a.reembolsos),
      mensalidade: round2(a.mensalidade),
      outros: round2(a.outros),
      liquido_esperado: round2(a.liquido_esperado),
      status: 'pending',
    }));

    if (repassesPayload.length > 0) {
      const { error: repErr } = await supabase
        .from('audit_ifood_repasses')
        .insert(repassesPayload);
      if (repErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: `Erro ao agregar repasses: ${repErr.message}`,
        }).eq('id', importRec.id);
        return new Response(JSON.stringify({ error: `Erro ao agregar repasses: ${repErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: inserted,
    }).eq('id', importRec.id);

    return new Response(JSON.stringify({
      success: true,
      total_rows: totalRows,
      imported_rows: inserted,
      store_id_curto: storeIdCurto,
      loja_id: lojaIdLong,
      competencia: competenciaArquivo,
      repasses_gerados: repassesPayload.length,
      breakdown_by_categoria: Object.fromEntries(
        Object.entries(breakdownByCategoria).map(([k, v]) => [k, { count: v.count, soma: round2(v.soma) }])
      ),
      // Lançamentos sem qualquer data utilizável — fora do consolidado de
      // repasses. Útil pra detectar mensalidade/ADS sem competência atribuída.
      data_repasse_ausente_count: dataRepasseAusenteCount,
      data_repasse_ausente_valor: round2(dataRepasseAusenteValor),
      message: `${inserted} lançamentos importados (loja ${storeIdCurto}, comp ${competenciaArquivo}). ${repassesPayload.length} repasses agregados.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-ifood-extrato-detalhado error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
