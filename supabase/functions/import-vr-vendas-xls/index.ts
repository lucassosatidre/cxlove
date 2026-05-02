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
import { validatePeriodMatch } from '../_shared/period-validator.ts';

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

    // Carrega TODOS os lotes VR do período (não só do mês de competência —
    // venda de fev pode estar em lote com corte em mar)
    const { data: vrLots } = await supabase
      .from('audit_voucher_lots')
      .select('id, numero_reembolso, produto, data_corte')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', 'vr')
      .order('data_corte', { ascending: true });

    if (!vrLots || vrLots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote VR encontrado neste período. Importe o extrato de Reembolsos VR primeiro.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Index de lotes por produto (já mapeado pra normalizado)
    type LotInfo = { id: string; numero_reembolso: string; produto: string; data_corte: string | null };
    const lotsByProduto = new Map<string, LotInfo[]>();
    for (const l of (vrLots as LotInfo[])) {
      const key = (l.produto ?? '').trim();
      if (!lotsByProduto.has(key)) lotsByProduto.set(key, []);
      lotsByProduto.get(key)!.push(l);
    }

    // Pra cada venda, encontra lote: produto correspondente + menor data_corte >= data_venda
    type Linked = { lot_id: string; sale: RawSale };
    const linked: Linked[] = [];
    const orphans: { sale: RawSale; reason: string }[] = [];

    for (const s of sales) {
      const produtoLote = mapProdutoVendaToLote(s.produto);
      const candidates = lotsByProduto.get(produtoLote) ?? [];
      if (candidates.length === 0) {
        orphans.push({ sale: s, reason: `Produto "${produtoLote}" não tem lote correspondente` });
        continue;
      }
      // Menor data_corte >= data_venda
      const target = candidates
        .filter(l => l.data_corte != null && l.data_corte >= s.data_venda)
        .sort((a, b) => (a.data_corte ?? '').localeCompare(b.data_corte ?? ''))[0];
      if (!target) {
        orphans.push({ sale: s, reason: `Sem lote ${produtoLote} com data_corte >= ${s.data_venda}` });
        continue;
      }
      linked.push({ lot_id: target.id, sale: s });
    }

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'vr', file_name,
        total_rows: sales.length, status: 'pending', created_by: userId,
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

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: insertedItems, duplicate_rows: 0,
    }).eq('id', importRec.id);

    return new Response(JSON.stringify({
      success: true,
      total_sales: sales.length,
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
      message: `${linked.length} vendas vinculadas a ${affectedLotIds.length} lotes${orphans.length > 0 ? ` (${orphans.length} órfãs)` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-vr-vendas-xls error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
