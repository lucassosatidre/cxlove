// @ts-nocheck
// Recebe TEXTO CSV do extrato Pluxee (encoding ISO-8859-1 / Latin-1, frontend
// decodifica antes de enviar). Cada arquivo tem a estrutura:
//
//   Header: empresa/CNPJ/Banco/Produto/etc
//   N blocos sucessivos:
//     Data de Pagamento: DD/MM/YYYY
//     Status: PAGO
//     TOTAL BRUTO ;;R$ X
//     VALOR DEDUZIDO ;REEMBOLSO;R$ X
//     ;REEMBOLSO EXPRESSO;R$ X
//     TOTAL LÍQUIDO ;;R$ X
//     <linha vazia>
//     Header da tabela: CNPJ;Razão Social;Data da Transação;Data do Processamento;...
//     <N linhas de venda individuais>
//     TOTAL BRUTO ;;R$ X (repetido)
//     ...
//     <linha vazia>
//
// Pluxee só tem 1 produto por extrato (PLUXEE REFEICAO neste caso). Cada bloco
// = 1 lote = 1 crédito BB esperado.

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

function parseDateBR(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseValor(s: string): number | null {
  // "R$ 167,53" ou "R$167,53" ou "R$ 1.234,56"
  const cleaned = s.replace(/R\$/, '').replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

function splitCsv(line: string): string[] {
  // CSV simples Pluxee usa `;` como separador. Sem aspas envolvendo campos.
  return line.split(';').map(c => c.trim());
}

type ParsedItem = {
  data_transacao: string;
  data_postagem: string | null;
  numero_documento: string | null;
  numero_cartao: string | null;
  valor: number;
  cnpj: string | null;
};
type ParsedLot = {
  data_pagamento: string;
  bruto: number;
  deducao_reembolso: number;
  reembolso_expresso: number;
  liquido: number;
  items: ParsedItem[];
};

function parsePluxeeReembolsos(content: string): { lots: ParsedLot[]; warnings: string[] } {
  const lines = content.split(/\r?\n/);
  const lots: ParsedLot[] = [];
  const warnings: string[] = [];
  let current: ParsedLot | null = null;

  const closeLot = () => {
    if (current) {
      lots.push(current);
      current = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    // Detecta abertura de novo lote
    const dataPagMatch = line.match(/Data de Pagamento:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dataPagMatch) {
      closeLot();
      const dataPag = parseDateBR(dataPagMatch[1]);
      if (!dataPag) {
        warnings.push(`Linha ${i + 1}: Data de Pagamento inválida "${dataPagMatch[1]}"`);
        continue;
      }
      current = {
        data_pagamento: dataPag,
        bruto: 0, deducao_reembolso: 0, reembolso_expresso: 0, liquido: 0,
        items: [],
      };
      // A linha "Data de Pagamento: ..." pode ter "TOTAL BRUTO" no mesmo registro
      // (separado por ;), processo a linha inteira no parse de totais abaixo.
    }

    if (!current) continue;

    // Totais — regex sobre linha inteira (podem aparecer 2x: antes e depois dos
    // items, valor é o mesmo). Mantém último encontrado.
    const brutoM = line.match(/TOTAL\s+BRUTO[^R$]*R\$\s*([\d.,]+)/i);
    if (brutoM) {
      const v = parseValor('R$' + brutoM[1]);
      if (v != null) current.bruto = v;
    }
    // VALOR DEDUZIDO REEMBOLSO (não confundir com REEMBOLSO EXPRESSO)
    if (/VALOR\s+DEDUZIDO[^;]*;?\s*REEMBOLSO\b/i.test(line) && !/EXPRESSO/i.test(line)) {
      const m = line.match(/REEMBOLSO[^R$]*R\$\s*([\d.,]+)/i);
      if (m) {
        const v = parseValor('R$' + m[1]);
        if (v != null) current.deducao_reembolso = v;
      }
    }
    if (/REEMBOLSO\s+EXPRESSO/i.test(line)) {
      const m = line.match(/REEMBOLSO\s+EXPRESSO[^R$]*R\$\s*([\d.,]+)/i);
      if (m) {
        const v = parseValor('R$' + m[1]);
        if (v != null) current.reembolso_expresso = v;
      }
    }
    if (/TOTAL\s+L[\xC9\xCDIÍÉ]QUIDO/i.test(line) || /TOTAL L.QUIDO/.test(line)) {
      const m = line.match(/TOTAL\s+L[^R$]*R\$\s*([\d.,]+)/i);
      if (m) {
        const v = parseValor('R$' + m[1]);
        if (v != null) current.liquido = v;
      }
    }

    // Item de venda: linha começando com CNPJ no formato XX.XXX.XXX/XXXX-XX
    // Estrutura: CNPJ;Razão Social;Data Transação;Data Processamento;Rede Captura;Descrição;Cartão;Autorização;Valor;Origem
    const cells = splitCsv(line);
    if (cells.length >= 9 && /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cells[0])) {
      const dataTrans = parseDateBR(cells[2]);
      const dataProc = parseDateBR(cells[3]);
      const valor = parseValor(cells[8]);
      if (dataTrans && valor != null) {
        current.items.push({
          data_transacao: dataTrans,
          data_postagem: dataProc,
          numero_documento: cells[7] || null,
          numero_cartao: cells[6] || null,
          valor,
          cnpj: cells[0],
        });
      }
    }
  }
  closeLot();

  // Sanity check: sum items deve bater com bruto, e bruto - deducao - expresso == liquido
  const integrityErrors: string[] = [];
  for (const l of lots) {
    const sumItems = l.items.reduce((s, it) => s + it.valor, 0);
    if (Math.abs(sumItems - l.bruto) > 0.05) {
      integrityErrors.push(`Lote ${l.data_pagamento}: soma items R$${sumItems.toFixed(2)} ≠ bruto R$${l.bruto.toFixed(2)}`);
    }
    const calcLiq = l.bruto - l.deducao_reembolso - l.reembolso_expresso;
    if (Math.abs(calcLiq - l.liquido) > 0.05) {
      integrityErrors.push(`Lote ${l.data_pagamento}: bruto-descontos R$${calcLiq.toFixed(2)} ≠ líquido R$${l.liquido.toFixed(2)}`);
    }
  }
  if (integrityErrors.length > 0) warnings.push(...integrityErrors);

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
    const { audit_period_id, file_name, content } = body || {};
    if (!audit_period_id || !file_name || !content) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, content)' }), {
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

    // Detecta tipo: arquivo de reembolsos tem "Status: PAGO" + "Data de Pagamento:"
    // Arquivo de vendas tem "Filtro selecionado:" e nada de "Status: PAGO"
    const isReembolsos = /Status:\s*PAGO/i.test(content) && /Data de Pagamento:/i.test(content);
    const isVendas = /Filtro selecionado:/i.test(content) && !isReembolsos;
    if (isVendas) {
      // 200 com success:false em vez de 400 — não é erro fatal, é orientação
      // pra usuário escolher arquivo certo. Evita "Runtime Error" no Lovable
      // preview.
      return new Response(JSON.stringify({
        success: false,
        skipped: true,
        error: 'Este arquivo é de "vendas" (filtro por período). Importe os arquivos de REEMBOLSOS (com "1976928" no nome) que já contêm os lotes pagos com as vendas dentro.',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!isReembolsos) {
      return new Response(JSON.stringify({
        error: 'Não identificou tipo do CSV. Esperado conter "Status: PAGO" e "Data de Pagamento:" (extrato de reembolsos Pluxee).',
        diagnostic: { first_500_chars: content.substring(0, 500) },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { lots: parsedLots, warnings } = parsePluxeeReembolsos(content);

    if (parsedLots.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum lote pago encontrado no arquivo Pluxee.',
        warnings,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validação de competência: bloqueia 100% mismatch (ex: arquivo de mar/26
    // sendo importado em fev/26). Lote misto com vendas em 2 meses passa.
    const periodCheck = validatePeriodMatch(
      parsedLots.map(l => l.data_pagamento),
      { month: period.month, year: period.year },
      'Pluxee',
    );
    if (!periodCheck.ok) {
      return new Response(JSON.stringify({
        error: periodCheck.error,
        breakdown_by_month: periodCheck.breakdown,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const totalItems = parsedLots.reduce((s, l) => s + l.items.length, 0);
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'pluxee', file_name,
        total_rows: totalItems, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let insertedLots = 0;
    let updatedLots = 0;
    let insertedItems = 0;

    // Conta ordinal por data_pagamento pra montar numero_reembolso único
    const ordinalByDate = new Map<string, number>();
    for (const l of parsedLots) {
      const ord = (ordinalByDate.get(l.data_pagamento) ?? 0) + 1;
      ordinalByDate.set(l.data_pagamento, ord);
      const numReembolso = `PLUXEE-${l.data_pagamento.replaceAll('-', '')}-${ord}`;
      const subtotal = Math.round(l.bruto * 100) / 100;
      const liquido = Math.round(l.liquido * 100) / 100;
      const totalDesc = Math.round((l.deducao_reembolso + l.reembolso_expresso) * 100) / 100;

      const { data: existing } = await supabase
        .from('audit_voucher_lots')
        .select('id')
        .eq('audit_period_id', audit_period_id)
        .eq('operadora', 'pluxee')
        .eq('numero_reembolso', numReembolso)
        .maybeSingle();

      const lotPayload = {
        audit_period_id, operadora: 'pluxee',
        numero_reembolso: numReembolso, numero_contrato: null,
        produto: 'PLUXEE REFEICAO',
        data_corte: null,
        data_credito: l.data_pagamento,
        subtotal_vendas: subtotal,
        total_descontos: totalDesc,
        valor_liquido: liquido,
        descontos: {
          deducao_reembolso: Math.round(l.deducao_reembolso * 100) / 100,
          reembolso_expresso: Math.round(l.reembolso_expresso * 100) / 100,
        },
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

      const itemsPayload = l.items.map(it => ({
        lot_id: lotId,
        data_transacao: it.data_transacao,
        data_postagem: it.data_postagem,
        numero_documento: it.numero_documento,
        numero_cartao_mascarado: it.numero_cartao,
        valor: Math.round(it.valor * 100) / 100,
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
    }

    return new Response(JSON.stringify({
      success: true,
      total_lots: parsedLots.length,
      inserted_lots: insertedLots,
      updated_lots: updatedLots,
      inserted_items: insertedItems,
      total_items: totalItems,
      warnings: warnings.slice(0, 30),
      message: `${insertedLots} lotes novos + ${updatedLots} atualizados (${insertedItems} vendas)`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-pluxee-csv error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
