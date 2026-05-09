// @ts-nocheck
// Importa o XLSX "extrato_pagamentos" da Pluxee. Confirma quais vendas foram
// efetivamente pagas (Status PAGO) ou tiveram erro (ERRO NO PAGAMENTO).
//
// Layout esperado:
// - sheet "extrato_pagamentos" (ou primeira)
// - header items em row contendo "Status" + "Nº de Autorização" + "Valor Bruto"
// - colunas: CNPJ, Razão Social, Data da Transação, Data do Processamento,
//   Data do Pagamento, Status, Rede Captura, Descrição, Número do cartão,
//   Nº de Autorização, Valor Bruto R$, Origem, Taxa de Administração
//
// Estratégia:
// - Tenta MATCH com item de venda existente (operadora=pluxee, mesmo
//   numero_documento=numero_autorizacao) e atualiza status_remote.
// - Se não encontra match (= venda de mês anterior), cria lote PLUXEE-PAG-YYYYMMDD
//   por data_pagamento e item dentro com status_remote já populado.

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

function toIso(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function findHeaderRow(rows: any[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const joined = r.map(c => String(c ?? '').toLowerCase()).join('|');
    if (joined.includes('status') && joined.includes('autoriza') && joined.includes('valor bruto')) return i;
  }
  return -1;
}

function colIndex(header: any[], ...needles: string[]): number {
  const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (let i = 0; i < header.length; i++) {
    const h = norm(header[i]);
    if (needles.every(n => h.includes(norm(n)))) return i;
  }
  return -1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const userId = userData.user.id;
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) return new Response(JSON.stringify({ error: 'Acesso restrito a admin' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { audit_period_id, file_name, rows } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, rows)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: period } = await supabase.from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (!period) return new Response(JSON.stringify({ error: 'Período não encontrado' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (period.status === 'fechado') return new Response(JSON.stringify({ error: 'Período fechado.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const headerIdx = findHeaderRow(rows);
    if (headerIdx < 0) {
      return new Response(JSON.stringify({ error: 'Header de items não encontrado. Esperado linha com "Status" + "Autorização" + "Valor Bruto".' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const header = rows[headerIdx] as any[];
    const cCnpj = colIndex(header, 'cnpj');
    const cDataTrans = colIndex(header, 'data', 'transa');
    const cDataProc = colIndex(header, 'data', 'processamento');
    const cDataPag = colIndex(header, 'data', 'pagamento');
    const cStatus = colIndex(header, 'status');
    const cCartao = colIndex(header, 'cart');
    const cAuth = colIndex(header, 'autoriza');
    const cValor = colIndex(header, 'valor', 'bruto');
    const cOrigem = colIndex(header, 'origem');

    if (cDataTrans < 0 || cDataPag < 0 || cValor < 0 || cStatus < 0 || cAuth < 0) {
      return new Response(JSON.stringify({ error: 'Colunas essenciais ausentes.', header }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    type Pag = { data_transacao: string; data_processamento: string | null; data_pagamento: string; status: string; numero_autorizacao: string; numero_cartao: string | null; valor: number; origem: string | null; cnpj: string | null };
    const pagamentos: Pag[] = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const dataTrans = toIso(r[cDataTrans]);
      const dataPag = toIso(r[cDataPag]);
      const valor = toNum(r[cValor]);
      const auth = r[cAuth] != null ? String(r[cAuth]).trim() : '';
      const status = r[cStatus] != null ? String(r[cStatus]).trim() : '';
      if (!dataTrans || !dataPag || valor == null || !auth || !status) continue;
      pagamentos.push({
        data_transacao: dataTrans,
        data_processamento: cDataProc >= 0 ? toIso(r[cDataProc]) : null,
        data_pagamento: dataPag,
        status,
        numero_autorizacao: auth,
        numero_cartao: cCartao >= 0 ? (r[cCartao] != null ? String(r[cCartao]).trim() : null) : null,
        valor,
        origem: cOrigem >= 0 ? (r[cOrigem] != null ? String(r[cOrigem]).trim() : null) : null,
        cnpj: cCnpj >= 0 ? (r[cCnpj] != null ? String(r[cCnpj]).trim() : null) : null,
      });
    }

    if (pagamentos.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhum pagamento encontrado no extrato_pagamentos.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const periodCheck = validatePeriodMatch(pagamentos.map(p => p.data_pagamento), { month: period.month, year: period.year }, 'Pluxee Pagamentos', [0, 1]);
    if (!periodCheck.ok) {
      return new Response(JSON.stringify({ error: periodCheck.error, breakdown_by_month: periodCheck.breakdown }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'pluxee_pagamentos', file_name,
        total_rows: pagamentos.length, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar: ${importErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Apaga somente lotes "pagamentos" deste período (não toca os de vendas)
    const { data: oldLots } = await supabase
      .from('audit_voucher_lots').select('id')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', 'pluxee')
      .like('numero_reembolso', 'PLUXEE-PAG-%');
    if (oldLots && oldLots.length > 0) {
      const ids = oldLots.map(l => l.id);
      await supabase.from('audit_voucher_lot_items').delete().in('lot_id', ids);
      await supabase.from('audit_voucher_lots').delete().in('id', ids);
    }

    // Carrega TODOS os items pluxee do período pra match por numero_documento
    // (limit alto porque podem ser centenas)
    const { data: pluxeeLots } = await supabase
      .from('audit_voucher_lots').select('id')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', 'pluxee');
    const lotIds = (pluxeeLots ?? []).map(l => l.id);
    const existingByAuth = new Map<string, string>(); // numero_documento -> item.id
    if (lotIds.length > 0) {
      // pagina em chunks de 1000 lots se preciso
      const { data: existingItems } = await supabase
        .from('audit_voucher_lot_items')
        .select('id, numero_documento')
        .in('lot_id', lotIds)
        .limit(10000);
      for (const it of (existingItems ?? [])) {
        if (it.numero_documento) existingByAuth.set(String(it.numero_documento).trim(), it.id);
      }
    }

    let updatedItems = 0;
    let createdLots = 0;
    let createdItems = 0;
    const orphans: Pag[] = [];

    // Pass 1: atualiza status_remote nos items que casam
    for (const p of pagamentos) {
      const itemId = existingByAuth.get(p.numero_autorizacao);
      if (itemId) {
        const { error: updErr } = await supabase
          .from('audit_voucher_lot_items')
          .update({ status_remote: p.status })
          .eq('id', itemId);
        if (!updErr) updatedItems++;
      } else {
        orphans.push(p);
      }
    }

    // Pass 2: pra órfãos (vendas de mês anterior), agrupa por data_pagamento
    // e cria lotes PLUXEE-PAG-YYYYMMDD-N
    if (orphans.length > 0) {
      const byPag = new Map<string, Pag[]>();
      for (const p of orphans) {
        const arr = byPag.get(p.data_pagamento) ?? [];
        arr.push(p);
        byPag.set(p.data_pagamento, arr);
      }
      let ordinal = 0;
      for (const [dataPag, group] of byPag.entries()) {
        ordinal++;
        const subtotal = Math.round(group.reduce((s, x) => s + x.valor, 0) * 100) / 100;
        const numReembolso = `PLUXEE-PAG-${dataPag.replaceAll('-', '')}-${ordinal}`;
        const { data: ins, error: insErr } = await supabase
          .from('audit_voucher_lots').insert({
            audit_period_id, operadora: 'pluxee',
            numero_reembolso: numReembolso, numero_contrato: null,
            produto: 'PLUXEE',
            data_corte: dataPag,
            data_credito: dataPag,
            subtotal_vendas: subtotal,
            total_descontos: 0,
            valor_liquido: subtotal,
            descontos: null,
            import_id: importRec.id,
            status: 'pending',
          }).select('id').single();
        if (insErr || !ins) {
          await supabase.from('audit_imports').update({
            status: 'error', error_message: `Erro ao inserir lote ${numReembolso}: ${insErr?.message ?? 'sem dado'}`,
          }).eq('id', importRec.id);
          throw insErr ?? new Error('falha insert lote');
        }
        createdLots++;
        const lotId = ins.id;
        const itemsPayload = group.map(p => ({
          lot_id: lotId,
          data_transacao: p.data_transacao,
          data_postagem: p.data_processamento,
          numero_documento: p.numero_autorizacao,
          numero_cartao_mascarado: p.numero_cartao,
          valor: Math.round(p.valor * 100) / 100,
          estabelecimento: 'PIZZARIA ESTRELA',
          cnpj: p.cnpj,
          status_remote: p.status,
        }));
        if (itemsPayload.length) {
          const { error: itErr } = await supabase.from('audit_voucher_lot_items').insert(itemsPayload);
          if (itErr) {
            await supabase.from('audit_imports').update({
              status: 'error', error_message: `Erro ao inserir items ${numReembolso}: ${itErr.message}`,
            }).eq('id', importRec.id);
            throw itErr;
          }
          createdItems += itemsPayload.length;
        }
      }
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: updatedItems + createdItems, duplicate_rows: 0,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_pagamentos: pagamentos.length,
      updated_items: updatedItems,
      orphan_pagamentos: orphans.length,
      created_orphan_lots: createdLots,
      created_orphan_items: createdItems,
      message: `${updatedItems} status atualizados · ${createdItems} órfãos criados em ${createdLots} lotes`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-pluxee-pagamentos-xlsx error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
