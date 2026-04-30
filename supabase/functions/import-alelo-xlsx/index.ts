// @ts-nocheck
// Recebe rows pré-parseadas do XLSX "Extrato" da Alelo (frontend usa xlsx.js
// pra extrair). Usa LAYOUT POSICIONAL FIXO (não detecta header pelo nome) —
// xlsx.js no browser ocasionalmente omite a linha de header dependendo do
// estilo da célula, então confiamos nas posições documentadas.
//
// Layout aba "Extrato" portal Alelo (validado em alelo março exc.xlsx, A1:M33):
//   Col 0=Nome  1=CNPJ  2=NumEC  3=Autorização  4=Data Venda  5=Hora
//   6=Tipo Cartão  7=Cartão  8=PSR  9=Valor Bruto  10=Valor Líquido
//   11=Status  12=Data Pagamento

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const COL = {
  cnpj: 1,
  autorizacao: 3,
  dataVenda: 4,
  tipo: 6,
  cartao: 7,
  bruto: 9,
  liquido: 10,
  status: 11,
  dataPag: 12,
};

// xlsx.js no browser converte Excel datetime pra Date JS em horário LOCAL.
// Ao virar JSON (envio pra edge), o ISO sai em UTC. Vendas BRT >= 21h saem
// como UTC do dia seguinte. Compensamos aqui aplicando offset BRT (-3h)
// antes de extrair a data civil. Funciona pra vendas com hora local; pra
// strings BR/ISO sem tempo, usa direto.
function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    // Date com componente de tempo — aplica offset BRT
    const adjusted = new Date(v.getTime() - 3 * 3600 * 1000);
    const y = adjusted.getUTCFullYear();
    const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(adjusted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // ISO datetime (chega assim do JSON.stringify(Date))
  const isoDt = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (isoDt) {
    // O ISO vem em UTC; converte pra Date e aplica offset BRT
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const adjusted = new Date(d.getTime() - 3 * 3600 * 1000);
      const y = adjusted.getUTCFullYear();
      const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(adjusted.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  // DD/MM/YYYY sem tempo
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // YYYY-MM-DD sem tempo
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

function isHeaderRow(r: any[]): boolean {
  const c0 = String(r?.[0] ?? '').toLowerCase().trim();
  const c1 = String(r?.[1] ?? '').toLowerCase().trim();
  return c0 === 'nome' || c1 === 'cnpj';
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

    type RawSale = {
      data_venda: string; data_pag: string; tipo: string;
      autorizacao: string | null; cartao: string | null;
      bruto: number; liquido: number; cnpj: string | null;
    };
    const sales: RawSale[] = [];
    let skippedHeader = 0;
    let skippedNonApproved = 0;
    let skippedInvalid = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r) || r.every((c: any) => c == null || c === '')) continue;
      if (isHeaderRow(r)) { skippedHeader++; continue; }

      const status = String(r[COL.status] ?? '').toUpperCase().trim();
      if (status && status !== 'APROVADA') { skippedNonApproved++; continue; }

      const dataVenda = toIsoDate(r[COL.dataVenda]);
      const dataPag = toIsoDate(r[COL.dataPag]);
      const bruto = toNumber(r[COL.bruto]);
      const liquido = toNumber(r[COL.liquido]);
      if (!dataVenda || !dataPag || bruto == null || liquido == null) {
        skippedInvalid++;
        continue;
      }

      sales.push({
        data_venda: dataVenda,
        data_pag: dataPag,
        tipo: String(r[COL.tipo] ?? '').trim() || 'Refeição',
        autorizacao: String(r[COL.autorizacao] ?? '').trim() || null,
        cartao: String(r[COL.cartao] ?? '').trim() || null,
        bruto,
        liquido,
        cnpj: String(r[COL.cnpj] ?? '').trim() || null,
      });
    }

    if (sales.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhuma venda Alelo aprovada encontrada no arquivo. Confira que selecionou o XLSX exportado da aba "Extrato" do portal Alelo.',
        diagnostic: {
          total_rows: rows.length,
          skipped_header: skippedHeader,
          skipped_non_approved: skippedNonApproved,
          skipped_invalid: skippedInvalid,
          sample_first_3: rows.slice(0, 3),
        },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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
      skipped_header: skippedHeader,
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
