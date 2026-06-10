// @ts-nocheck
// import-ifood-conta-csv — extrato bancário da conta iFood Pago.
//
// CSV exportado da conta iFood Pago (Banco do iFood). Header esperado:
//   "data da transação","descrição","valor","categoria"
// Colunas:
//   0=data (YYYY-MM-DD), 1=descrição (texto), 2=valor (BR pt: vírgula decimal),
//   3=categoria (Repasse iFood | Antecipação | Pix | Transferência)
//
// Importa linhas com categoria='Repasse iFood' ou 'Antecipação' (núcleo da
// reconciliação iFood Marketplace v2). CRÉDITOS (valor>0) de outras categorias
// (ex: 'Transferência recebida') entram como categoria='nao_reconhecido' —
// campo informativo, dinheiro que entrou na conta sem identificação. Débitos
// de outras categorias (Pix saída, Transferência enviada) seguem ignorados:
// fluxo de tesouraria.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

function toIsoDate(v: any): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function normLower(s: any): string {
  return String(s ?? '').normalize('NFC').trim().toLowerCase();
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
    const { audit_period_id, file_name, rows, clear_existing } = body || {};
    if (!audit_period_id || !file_name || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, rows)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period } = await supabase
      .from('audit_periods').select('id,month,year,status').eq('id', audit_period_id).maybeSingle();
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

    if (clear_existing === true) {
      await supabase.from('audit_ifood_conta_movimentos').delete().eq('audit_period_id', audit_period_id);
    }

    // Detect header. CSV header expected: "data da transação","descrição","valor","categoria"
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => normLower(c));
      const hasData = cells.some(c => c.includes('data') && c.includes('transa'));
      const hasCat = cells.some(c => c === 'categoria' || c.includes('categoria'));
      if (hasData && hasCat) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      return new Response(JSON.stringify({ error: 'Header CSV iFood Pago não encontrado. Esperado: "data da transação", "descrição", "valor", "categoria".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const dataRows = rows.slice(headerIdx + 1).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'ifood_conta_csv',
        file_name,
        total_rows: dataRows.length,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar import: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const movimentos: any[] = [];
    let ignoradosCategoria = 0;
    let ignoradosSemData = 0;
    let naoReconhecidoCount = 0;
    let naoReconhecidoTotal = 0;
    const categoriasVistas: Record<string, number> = {};
    let csvIdx = 0;

    for (const r of dataRows) {
      const dataStr = toIsoDate(r[0]);
      const descricao = String(r[1] ?? '').trim();
      const valor = toNum(r[2]);
      const catCsv = String(r[3] ?? '').trim();
      const catLow = normLower(catCsv);
      categoriasVistas[catCsv] = (categoriasVistas[catCsv] ?? 0) + 1;
      csvIdx++;

      if (!dataStr) { ignoradosSemData++; continue; }

      let categoria: 'repasse' | 'taxa_antecip' | 'nao_reconhecido' | null = null;
      if (catLow === 'repasse ifood') categoria = 'repasse';
      else if (catLow === 'antecipação' || catLow === 'antecipacao') categoria = 'taxa_antecip';
      // Crédito de categoria desconhecida (ex: 'Transferência recebida'):
      // importa como 'nao_reconhecido' — entrou dinheiro sem identificação.
      else if (valor > 0) {
        categoria = 'nao_reconhecido';
        naoReconhecidoCount++;
        naoReconhecidoTotal += valor;
      }

      if (!categoria) { ignoradosCategoria++; continue; }

      movimentos.push({
        audit_period_id,
        import_id: importRec.id,
        csv_idx: csvIdx,
        data: dataStr,
        descricao,
        valor,
        categoria_csv: catCsv,
        categoria,
        status: 'pending',
      });
    }

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < movimentos.length; i += CHUNK) {
      const chunk = movimentos.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_ifood_conta_movimentos')
        .upsert(chunk, { onConflict: 'audit_period_id,data,descricao,valor' });
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: insErr.message, imported_rows: inserted,
        }).eq('id', importRec.id);
        return new Response(JSON.stringify({ error: `Erro ao inserir movimentos: ${insErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted += chunk.length;
    }

    await supabase.from('audit_imports').update({
      status: 'completed', imported_rows: inserted,
    }).eq('id', importRec.id);

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return new Response(JSON.stringify({
      success: true,
      total_rows: dataRows.length,
      imported_rows: inserted,
      ignored_categoria: ignoradosCategoria,
      ignored_no_data: ignoradosSemData,
      nao_reconhecido_count: naoReconhecidoCount,
      total_nao_reconhecido: round2(naoReconhecidoTotal),
      categorias_vistas: categoriasVistas,
      message: `${inserted} movimentos iFood Pago importados (${ignoradosCategoria} fora de escopo, ${ignoradosSemData} sem data, ${naoReconhecidoCount} créditos não reconhecidos).`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-ifood-conta-csv error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
