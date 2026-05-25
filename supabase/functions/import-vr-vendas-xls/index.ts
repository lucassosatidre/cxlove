// @ts-nocheck
// Recebe rows pré-parseadas do XLS "Relatorio de Transação de Venda" da VR.
// Cada linha é uma venda individual com data, hora, cartão, autorização, valor.
//
// Vinculação venda→lote: pra cada venda, encontra o lote VR do mesmo produto
// cujo `data_corte` é o menor >= data_venda. Esse é o lote onde a venda foi
// agregada pra reembolso. Se não encontra lote correspondente, venda fica
// como warning (não inserida).
//
// Layout esperado (validado em extrato_vendas_vr_2026-02-01_a_2026-02-28.xls):
//   Header com colunas: CNPJ, Produto, Data, Hora, Cartão, Número Autorização, Valor

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

// Mapeia produto da VENDA pra produto do REEMBOLSO. O extrato de vendas usa
// prefixo "VR " (ex: "VR Auxílio Refeição") enquanto o extrato de reembolsos
// usa o nome curto ("Auxílio Refeição"). Outros casos: "Refeição PAT",
// "Alimentação PAT" — mantemos correspondência direta.
function mapProdutoVendaToLote(produto: string): string {
  const p = String(produto ?? '').trim();
  if (p.startsWith('VR ')) return p.substring(3);
  return p;
}

function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const adjusted = new Date(v.getTime() - 3 * 3600 * 1000);
    return `${adjusted.getUTCFullYear()}-${String(adjusted.getUTCMonth() + 1).padStart(2, '0')}-${String(adjusted.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const isoDt = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDt) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const adjusted = new Date(d.getTime() - 3 * 3600 * 1000);
      return `${adjusted.getUTCFullYear()}-${String(adjusted.getUTCMonth() + 1).padStart(2, '0')}-${String(adjusted.getUTCDate()).padStart(2, '0')}`;
    }
  }
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function toNumber(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function normalizeKey(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
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
    const { audit_period_id, file_name, rows } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period } = await supabase
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (!period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (period.status === 'fechado') {
      return new Response(JSON.stringify({ error: 'Período fechado.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detecta header (CNPJ + Produto + Data + Valor) em até 25 linhas
    let headerIdx = -1;
    let colMap: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i];
      if (!Array.isArray(r)) continue;
      const norm = r.map(normalizeKey);
      const hasCnpj = norm.some(c => c === 'cnpj');
      const hasProduto = norm.some(c => c === 'produto');
      const hasData = norm.some(c => c === 'data');
      const hasValor = norm.some(c => c === 'valor');
      if (hasCnpj && hasProduto && hasData && hasValor) {
        headerIdx = i;
        for (let j = 0; j < r.length; j++) {
          const k = normalizeKey(r[j]);
          if (k === 'cnpj') colMap.cnpj = j;
          else if (k === 'produto') colMap.produto = j;
          else if (k === 'data') colMap.data = j;
          else if (k === 'hora') colMap.hora = j;
          else if (k === 'cartao' || k === 'cartão') colMap.cartao = j;
          else if (k.includes('autorizacao') || k.includes('autorização')) colMap.autorizacao = j;
          else if (k === 'valor') colMap.valor = j;
        }
        break;
      }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header não encontrado (esperava CNPJ + Produto + Data + Valor).',
        diagnostic: { total_rows: rows.length, first_5_rows: rows.slice(0, 5) },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    type RawSale = {
      data_venda: string; produto: string;
      autorizacao: string | null; cartao: string | null; valor: number;
      cnpj: string | null;
    };
    const sales: RawSale[] = [];
    let skippedInvalid = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r) || r.every((c: any) => c == null || c === '')) continue;
      const data_venda = toIsoDate(r[colMap.data]);
      const valor = toNumber(r[colMap.valor]);
      const produto = String(r[colMap.produto] ?? '').trim();
      if (!data_venda || valor == null || !produto) {
        skippedInvalid++;
        continue;
      }
      sales.push({
        data_venda, produto,
        autorizacao: colMap.autorizacao != null ? String(r[colMap.autorizacao] ?? '').trim() || null : null,
        cartao: colMap.cartao != null ? String(r[colMap.cartao] ?? '').trim() || null : null,
        valor,
        cnpj: colMap.cnpj != null ? String(r[colMap.cnpj] ?? '').trim() || null : null,
      });
    }

    if (sales.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhuma venda VR encontrada.',
        diagnostic: { skipped_invalid: skippedInvalid },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validação de competência: usa data_venda. Bloqueia 100% mismatch.
    const periodCheck = validatePeriodMatch(
      sales.map(s => s.data_venda),
      { month: period.month, year: period.year },
      'VR Vendas',
    );
    if (!periodCheck.ok) {
      return new Response(JSON.stringify({
        error: periodCheck.error,
        breakdown_by_month: periodCheck.breakdown,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Filtra vendas pelo mês alvo (apenas mês exato — venda é por competência
    // do mês da venda). Arquivo cobrindo jan-mar não deve inserir items de
    // jan/mar quando audit_period é fev.
    const periodFilter = filterToPeriod(
      sales,
      (s) => s.data_venda,
      { month: period.month, year: period.year },
      [0],
    );
    const salesKept = periodFilter.kept;

    // Carrega lotes VR de QUALQUER audit_period cuja data_corte esteja no
    // intervalo plausível pra vendas deste mês. Sem isso, venda 28/04 com
    // lote pagamento 06/05 (que vive no audit_period maio) ficava órfã —
    // bug encontrado em 25/05/26: R$89 VR Auxílio Alimentação não vinculava.
    // Janela: 5 dias antes do mês alvo (vendas dos últimos dias do mês
    // anterior podem estar em lote com corte ≥ início do mês alvo) até 45
    // dias depois (cobre todo o ciclo de corte VR D+15 + folga).
    const compIni = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const compFimDate = new Date(period.year, period.month, 1);
    const cutoffMin = new Date(period.year, period.month - 1, -5).toISOString().slice(0, 10);
    const cutoffMax = new Date(compFimDate.getFullYear(), compFimDate.getMonth(), 45).toISOString().slice(0, 10);
    const { data: vrLots } = await supabase
      .from('audit_voucher_lots')
      .select('id, numero_reembolso, produto, data_corte, subtotal_vendas, audit_period_id')
      .eq('operadora', 'vr')
      .gte('data_corte', cutoffMin)
      .lte('data_corte', cutoffMax)
      .order('data_corte', { ascending: true });

    if (!vrLots || vrLots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote VR encontrado na janela pra vincular vendas. Importe o extrato de Reembolsos VR primeiro.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Index de lotes por produto (já mapeado pra normalizado)
    type LotInfo = {
      id: string; numero_reembolso: string; produto: string;
      data_corte: string | null; subtotal_vendas: number;
    };
    const lotsByProduto = new Map<string, LotInfo[]>();
    for (const l of (vrLots as any[])) {
      const info: LotInfo = {
        id: l.id,
        numero_reembolso: l.numero_reembolso,
        produto: l.produto,
        data_corte: l.data_corte,
        subtotal_vendas: Number(l.subtotal_vendas ?? 0),
      };
      const key = (info.produto ?? '').trim();
      if (!lotsByProduto.has(key)) lotsByProduto.set(key, []);
      lotsByProduto.get(key)!.push(info);
    }

    // Binding pelo bin-packing: cada lote tem capacidade = subtotal_vendas; cada
    // venda consome capacidade do lote escolhido. Sem isso, múltiplos lotes
    // com mesmo produto+data_corte recebiam TODAS as vendas no primeiro
    // (caso real mar/26: lote 701982829 R$80,00 com 3 vendas linkadas
    // somando R$343,90 — outras 2 vendas eram pra lotes irmãos com
    // data_corte posterior que ficavam órfãos).
    //
    // Algoritmo: ordena vendas por (data_venda ASC, valor DESC) — vendas
    // grandes primeiro pra evitar fragmentação que sobre só pra lotes
    // pequenos. Pra cada venda escolhe o lote com data_corte mais cedo
    // (≥ data_venda) que ainda tem capacidade pra acomodar; em empate de
    // data_corte, prefere o lote com MENOR remaining (encaixe apertado).
    //
    // Limitação conhecida: bin-packing é heurístico. Quando um lote VR
    // fica "envenenado" no início (vendas grandes que cabem mas pertenciam
    // a outro ciclo), o resto cascateia e items_sum diverge de subtotal.
    // Caso real: mai/26 lote 696721182 (corte Feb-24) recebeu 5 items
    // somando 518,80 (4 primeiros = 433,80 = subtotal exato, 5º item R$85
    // sobrou e pertenceria ao lote 697505311). Por isso o
    // contabil-data-builder usa lot.subtotal_vendas em lotes 100% no mês
    // (commit 12aec8a) — confia no total declarado pelo extrato VR.
    type Linked = { lot_id: string; sale: RawSale };
    const linked: Linked[] = [];
    const orphans: { sale: RawSale; reason: string }[] = [];
    const usedByLot = new Map<string, number>();

    const TOLERANCE = 0.05;
    const sortedSales = [...salesKept].sort((a, b) => {
      if (a.data_venda !== b.data_venda) return a.data_venda.localeCompare(b.data_venda);
      return b.valor - a.valor;
    });

    for (const s of sortedSales) {
      const produtoLote = mapProdutoVendaToLote(s.produto);
      const candidates = lotsByProduto.get(produtoLote) ?? [];
      if (candidates.length === 0) {
        orphans.push({ sale: s, reason: `Produto "${produtoLote}" não tem lote correspondente` });
        continue;
      }

      const fitting = candidates
        .filter(l => l.data_corte != null && l.data_corte >= s.data_venda)
        .map(l => {
          const used = usedByLot.get(l.id) ?? 0;
          const remaining = l.subtotal_vendas - used;
          return { lot: l, remaining };
        })
        .filter(c => c.remaining + TOLERANCE >= s.valor)
        .sort((a, b) => {
          const dc = (a.lot.data_corte ?? '').localeCompare(b.lot.data_corte ?? '');
          if (dc !== 0) return dc;
          return a.remaining - b.remaining;
        });

      if (fitting.length === 0) {
        orphans.push({
          sale: s,
          reason: `Sem lote ${produtoLote} com capacidade pra venda R$${s.valor.toFixed(2)} (data_corte >= ${s.data_venda})`,
        });
        continue;
      }

      const target = fitting[0].lot;
      usedByLot.set(target.id, (usedByLot.get(target.id) ?? 0) + s.valor);
      linked.push({ lot_id: target.id, sale: s });
    }

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'vr', file_name,
        total_rows: salesKept.length, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Limpa items VR existentes dos lotes que vão receber novas vendas (idempotente).
    // Não apaga items de OUTROS lotes pra não perder dados de outras importações.
    const affectedLotIds = Array.from(new Set(linked.map(l => l.lot_id)));
    if (affectedLotIds.length > 0) {
      await supabase
        .from('audit_voucher_lot_items')
        .delete()
        .in('lot_id', affectedLotIds);
    }

    // Insere items
    let insertedItems = 0;
    if (linked.length > 0) {
      const itemsPayload = linked.map(l => ({
        lot_id: l.lot_id,
        data_transacao: l.sale.data_venda,
        data_postagem: null,
        numero_documento: l.sale.autorizacao,
        numero_cartao_mascarado: l.sale.cartao,
        valor: Math.round(l.sale.valor * 100) / 100,
        estabelecimento: 'PIZZARIA ESTRELA',
        cnpj: l.sale.cnpj,
      }));
      // Batch insert
      const CHUNK = 500;
      for (let i = 0; i < itemsPayload.length; i += CHUNK) {
        const chunk = itemsPayload.slice(i, i + CHUNK);
        const { error: itErr } = await supabase
          .from('audit_voucher_lot_items')
          .insert(chunk);
        if (itErr) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao inserir items: ${itErr.message}`,
          }).eq('id', importRec.id);
          throw itErr;
        }
        insertedItems += chunk.length;
      }
    }

    // Após o binding venda→lote, recalcula o audit_period correto de cada
    // lote afetado pelo MÊS DAS VENDAS predominante. Lote pode ter sido
    // importado em period diferente baseado em data_corte (heurística) —
    // agora corrige com a verdade dos items. Cria audit_period destino sob
    // demanda. Auditoria por competência de venda exige isso.
    const lotMovedTo: Record<string, string> = {};
    if (linked.length > 0) {
      const valuesByLotMonth = new Map<string, Record<string, number>>();
      for (const l of linked) {
        const ym = l.sale.data_venda?.slice(0, 7);
        if (!ym) continue;
        if (!valuesByLotMonth.has(l.lot_id)) valuesByLotMonth.set(l.lot_id, {});
        const m = valuesByLotMonth.get(l.lot_id)!;
        m[ym] = (m[ym] ?? 0) + Number(l.sale.valor ?? 0);
      }
      const periodCache = new Map<string, string>();
      const existingLotMeta = new Map<string, { audit_period_id: string; data_corte: string | null }>();
      for (const lot of (vrLots as any[])) {
        existingLotMeta.set(lot.id, { audit_period_id: lot.audit_period_id, data_corte: lot.data_corte });
      }
      for (const [lotId, byMonth] of valuesByLotMonth.entries()) {
        const sorted = Object.entries(byMonth).sort(([, a], [, b]) => b - a);
        const targetYM = sorted[0]?.[0];
        if (!targetYM) continue;
        const meta = existingLotMeta.get(lotId);
        if (!meta) continue;
        // Já está no period correto? checa via audit_periods cache
        let targetPeriodId = periodCache.get(targetYM) ?? null;
        if (!targetPeriodId) {
          const [yStr, mStr] = targetYM.split('-');
          const { data: existing } = await supabase
            .from('audit_periods').select('id,status').eq('month', Number(mStr)).eq('year', Number(yStr)).maybeSingle();
          if (existing) {
            if (existing.status === 'fechado') continue; // não move pra period fechado
            targetPeriodId = existing.id;
          } else {
            const { data: created } = await supabase
              .from('audit_periods').insert({ month: Number(mStr), year: Number(yStr), status: 'aberto' })
              .select('id').single();
            if (!created) continue;
            targetPeriodId = created.id;
          }
          periodCache.set(targetYM, targetPeriodId);
        }
        if (meta.audit_period_id !== targetPeriodId) {
          await supabase
            .from('audit_voucher_lots')
            .update({ audit_period_id: targetPeriodId })
            .eq('id', lotId);
          lotMovedTo[lotId] = targetYM;
        }
      }
    }

    // Status: se 0 items vinculados apesar de ter vendas válidas, sinaliza erro
    // pra UI mostrar (caso clássico: lotes ainda não importados ou produtos
    // sem correspondência). Antes o status ficava 'completed' silenciosamente.
    const hasUnlinkedSales = insertedItems === 0 && salesKept.length > 0;
    await supabase.from('audit_imports').update({
      status: hasUnlinkedSales ? 'error' : 'completed',
      imported_rows: insertedItems,
      duplicate_rows: 0,
      error_message: hasUnlinkedSales
        ? `Nenhuma venda vinculada a lote (${orphans.length} órfãs). Verifique se o extrato_reembolsos_vr foi importado antes deste arquivo.`
        : null,
    }).eq('id', importRec.id);

    // Diagnóstico de integridade: pra cada lote afetado, compara items_sum
    // com subtotal_vendas declarado. Diff ≠ 0 indica binding heurístico
    // imperfeito (ver "Limitação conhecida" no comentário acima).
    const integrityWarnings: Array<{
      lot_id: string; numero_reembolso: string; produto: string;
      data_corte: string | null; subtotal_declared: number;
      items_sum: number; gap: number; items_count: number;
    }> = [];
    const linkedByLot = new Map<string, number>();
    const linkedCountByLot = new Map<string, number>();
    for (const l of linked) {
      linkedByLot.set(l.lot_id, (linkedByLot.get(l.lot_id) ?? 0) + l.sale.valor);
      linkedCountByLot.set(l.lot_id, (linkedCountByLot.get(l.lot_id) ?? 0) + 1);
    }
    for (const lot of (vrLots as any[])) {
      const itemsSum = Math.round((linkedByLot.get(lot.id) ?? 0) * 100) / 100;
      const declared = Math.round(Number(lot.subtotal_vendas ?? 0) * 100) / 100;
      const gap = Math.round((declared - itemsSum) * 100) / 100;
      if (Math.abs(gap) > TOLERANCE) {
        integrityWarnings.push({
          lot_id: lot.id,
          numero_reembolso: lot.numero_reembolso,
          produto: lot.produto,
          data_corte: lot.data_corte,
          subtotal_declared: declared,
          items_sum: itemsSum,
          gap,
          items_count: linkedCountByLot.get(lot.id) ?? 0,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_sales: sales.length,
      kept_in_period: salesKept.length,
      skipped_outside_period: periodFilter.skipped,
      skipped_outside_period_by_month: periodFilter.skippedByMonth,
      linked_count: linked.length,
      orphan_count: orphans.length,
      orphans: orphans.slice(0, 30).map(o => ({
        data_venda: o.sale.data_venda,
        produto: o.sale.produto,
        valor: o.sale.valor,
        reason: o.reason,
      })),
      affected_lots: affectedLotIds.length,
      inserted_items: insertedItems,
      lots_moved_count: Object.keys(lotMovedTo).length,
      integrity_warnings_count: integrityWarnings.length,
      integrity_warnings: integrityWarnings,
      message: `${linked.length} vendas vinculadas a ${affectedLotIds.length} lotes${Object.keys(lotMovedTo).length > 0 ? ` · ${Object.keys(lotMovedTo).length} lote(s) movido(s) pro mês das vendas` : ''}${orphans.length > 0 ? ` (${orphans.length} órfãs)` : ''}${integrityWarnings.length > 0 ? ` · ${integrityWarnings.length} lote(s) com gap subtotal×items` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-vr-vendas-xls error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
