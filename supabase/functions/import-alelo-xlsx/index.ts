// @ts-nocheck
// Recebe rows pré-parseadas do XLSX "Extrato" da Alelo (frontend usa xlsx.js
// pra extrair). Diferenças vs Ticket:
//   - Não há "Nº Reembolso" explícito; lote = grupo de vendas com mesma
//     "Data de Pagamento" (sintetizamos ALELO-YYYYMMDD como id).
//   - Cada venda já tem Valor Bruto e Valor Líquido próprio — taxa é por
//     transação. Subtotal/total_descontos/valor_líquido do lote = somas.
//   - Produtos mistos no mesmo lote (Refeição / Refeição PAT / Refeição
//     Auxílio): produto do lote = "MIX" se >1 tipo, senão o único.
//   - Filtramos Status='APROVADA' (descarta canceladas/recusadas).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // DD/MM/YYYY
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
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

    // Detecta linha de header (procura "Data de Pagamento" + "Valor Bruto" entre as primeiras 5 linhas)
    let headerIdx = -1;
    let colMap: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (!Array.isArray(r)) continue;
      const lower = r.map((c: any) => String(c ?? '').toLowerCase().trim());
      const hasPag = lower.some(c => c.includes('data de pagamento'));
      const hasBruto = lower.some(c => c.includes('valor bruto'));
      if (hasPag && hasBruto) {
        headerIdx = i;
        for (let j = 0; j < r.length; j++) {
          const k = String(r[j] ?? '').toLowerCase().trim();
          if (k === 'cnpj') colMap.cnpj = j;
          else if (k === 'número da autorização' || k === 'numero da autorizacao') colMap.autorizacao = j;
          else if (k === 'data da venda') colMap.dataVenda = j;
          else if (k === 'tipo cartão' || k === 'tipo cartao') colMap.tipo = j;
          else if (k === 'nº cartão' || k === 'no cartao' || k === 'n cartao') colMap.cartao = j;
          else if (k === 'valor bruto') colMap.bruto = j;
          else if (k === 'valor líquido' || k === 'valor liquido') colMap.liquido = j;
          else if (k === 'status') colMap.status = j;
          else if (k === 'data de pagamento') colMap.dataPag = j;
        }
        break;
      }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({
        error: 'Header não encontrado. Esperado linhas com "Data de Pagamento" e "Valor Bruto" entre as 5 primeiras.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (colMap.bruto == null || colMap.liquido == null || colMap.dataPag == null || colMap.dataVenda == null) {
      return new Response(JSON.stringify({
        error: `Colunas obrigatórias faltando. Encontrei: ${JSON.stringify(colMap)}`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    type RawSale = {
      data_venda: string; data_pag: string; tipo: string;
      autorizacao: string | null; cartao: string | null;
      bruto: number; liquido: number; cnpj: string | null;
    };
    const sales: RawSale[] = [];
    let skippedNonApproved = 0;
    let skippedInvalid = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r) || r.every(c => c == null || c === '')) continue;
      const status = String(r[colMap.status] ?? '').toUpperCase().trim();
      if (status && status !== 'APROVADA') { skippedNonApproved++; continue; }
      const dataVenda = toIsoDate(r[colMap.dataVenda]);
      const dataPag = toIsoDate(r[colMap.dataPag]);
      const bruto = toNumber(r[colMap.bruto]);
      const liquido = toNumber(r[colMap.liquido]);
      if (!dataVenda || !dataPag || bruto == null || liquido == null) {
        skippedInvalid++;
        continue;
      }
      sales.push({
        data_venda: dataVenda,
        data_pag: dataPag,
        tipo: String(r[colMap.tipo] ?? '').trim() || 'Refeição',
        autorizacao: colMap.autorizacao != null ? String(r[colMap.autorizacao] ?? '').trim() || null : null,
        cartao: colMap.cartao != null ? String(r[colMap.cartao] ?? '').trim() || null : null,
        bruto,
        liquido,
        cnpj: colMap.cnpj != null ? String(r[colMap.cnpj] ?? '').trim() || null : null,
      });
    }

    if (sales.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhuma venda Alelo aprovada encontrada no arquivo.',
        skipped_non_approved: skippedNonApproved,
        skipped_invalid: skippedInvalid,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Agrupa por data_pag (lote)
    type Lot = {
      data_pag: string;
      items: RawSale[];
      bruto: number; liquido: number; produtos: Set<string>;
    };
    const lotMap = new Map<string, Lot>();
    for (const s of sales) {
      const lot = lotMap.get(s.data_pag) ?? { data_pag: s.data_pag, items: [], bruto: 0, liquido: 0, produtos: new Set<string>() };
      lot.items.push(s);
      lot.bruto += s.bruto;
      lot.liquido += s.liquido;
      lot.produtos.add(s.tipo);
      lotMap.set(s.data_pag, lot);
    }
    const lots = Array.from(lotMap.values()).sort((a, b) => a.data_pag.localeCompare(b.data_pag));

    // Registra import
    const totalItems = sales.length;
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'alelo', file_name,
        total_rows: totalItems, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar importação: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let insertedLots = 0;
    let updatedLots = 0;
    let insertedItems = 0;

    for (const lot of lots) {
      const numReembolso = `ALELO-${lot.data_pag.replaceAll('-', '')}`;
      const subtotal = Math.round(lot.bruto * 100) / 100;
      const liq = Math.round(lot.liquido * 100) / 100;
      const totalDesc = Math.round((subtotal - liq) * 100) / 100;
      const produto = lot.produtos.size === 1 ? Array.from(lot.produtos)[0] : 'MIX';

      const { data: existing } = await supabase
        .from('audit_voucher_lots')
        .select('id')
        .eq('audit_period_id', audit_period_id)
        .eq('operadora', 'alelo')
        .eq('numero_reembolso', numReembolso)
        .maybeSingle();

      const lotPayload = {
        audit_period_id, operadora: 'alelo',
        numero_reembolso: numReembolso, numero_contrato: null,
        produto, data_corte: null, data_credito: lot.data_pag,
        subtotal_vendas: subtotal, total_descontos: totalDesc, valor_liquido: liq,
        descontos: { taxa_alelo: totalDesc },
        import_id: importRec.id,
      };

      let lotId: string;
      if (existing) {
        const { error: updErr } = await supabase
          .from('audit_voucher_lots').update(lotPayload).eq('id', existing.id);
        if (updErr) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao atualizar lote ${numReembolso}: ${updErr.message}`,
          }).eq('id', importRec.id);
          throw updErr;
        }
        await supabase.from('audit_voucher_lot_items').delete().eq('lot_id', existing.id);
        lotId = existing.id;
        updatedLots++;
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('audit_voucher_lots').insert(lotPayload).select('id').single();
        if (insErr || !ins) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao inserir lote ${numReembolso}: ${insErr?.message ?? 'sem dado'}`,
          }).eq('id', importRec.id);
          throw insErr ?? new Error('falha insert lote');
        }
        lotId = ins.id;
        insertedLots++;
      }

      const itemsPayload = lot.items.map(it => ({
        lot_id: lotId,
        data_transacao: it.data_venda,
        data_postagem: null,
        numero_documento: it.autorizacao,
        numero_cartao_mascarado: it.cartao,
        valor: Math.round(it.bruto * 100) / 100,
        estabelecimento: 'PIZZARIA ESTRELA',
        cnpj: it.cnpj,
      }));

      if (itemsPayload.length) {
        const { error: itErr } = await supabase
          .from('audit_voucher_lot_items').insert(itemsPayload);
        if (itErr) {
          await supabase.from('audit_imports').update({
            status: 'error',
            error_message: `Erro ao inserir items do lote ${numReembolso}: ${itErr.message}`,
          }).eq('id', importRec.id);
          throw itErr;
        }
        insertedItems += itemsPayload.length;
      }
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: insertedItems, duplicate_rows: 0,
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
      skipped_non_approved: skippedNonApproved,
      skipped_invalid: skippedInvalid,
      message: `${insertedLots} lotes novos + ${updatedLots} atualizados (${insertedItems} vendas)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-alelo-xlsx error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
