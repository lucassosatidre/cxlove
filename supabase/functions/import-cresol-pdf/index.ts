// @ts-nocheck
// Recebe TEXTO bruto extraído do PDF do extrato Cresol (frontend usa
// pdfjs-dist + extractPdfText). Filtra apenas linhas de "PIX CREDITO DE:
// IFOODCOM AGENCIA DE..." que são os depósitos do iFood na Cresol.
//
// Equivalente ao import-cresol (XLSX), só que parser textual.
// Schema destino: audit_bank_deposits com bank='cresol' + category='ifood'.

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
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
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
    const { audit_period_id, file_name, raw_text } = body || {};
    if (!audit_period_id || !file_name || !raw_text) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes (audit_period_id, file_name, raw_text)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period } = await supabase
      .from('audit_periods').select('id,status').eq('id', audit_period_id).maybeSingle();
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
    const wasConciliado = period.status === 'conciliado';

    // Achata o texto: pdfjs pode retornar com newlines aleatórios.
    const flat = raw_text.replace(/\s+/g, ' ');

    // Captura cada depósito iFood. Regex non-greedy [^+]*? pula "21/04" (sem
    // ano) e captura a data completa antes do "+ R$".
    const PIX_IFOOD_RE =
      /PIX CREDITO DE:\s*IFOODCOM[^+]*?(\d{2}\/\d{2}\/\d{4})\s*\+\s*R\$\s*([\d.,]+)/gi;

    type Dep = { deposit_date: string; amount: number; description: string };
    const deposits: Dep[] = [];
    for (const m of flat.matchAll(PIX_IFOOD_RE)) {
      const dt = parseDateBR(m[1]);
      const v = parseValor(m[2]);
      if (!dt || v == null || v <= 0) continue;
      deposits.push({
        deposit_date: dt,
        amount: Math.round(v * 100) / 100,
        description: 'PIX CREDITO IFOOD',
      });
    }

    if (deposits.length === 0) {
      return new Response(JSON.stringify({
        error: 'Nenhum depósito iFood encontrado no PDF Cresol.',
        diagnostic: { sample_first_500: flat.substring(0, 500) },
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Registra import
    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id, file_type: 'cresol', file_name,
        total_rows: deposits.length, status: 'pending', created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insere com upsert por row_hash (calculado por trigger no banco) — idempotente
    const payload = deposits.map(d => ({
      audit_period_id,
      import_id: importRec.id,
      bank: 'cresol',
      deposit_date: d.deposit_date,
      description: d.description,
      detail: null,
      amount: d.amount,
      category: 'ifood',
      auto_categorized: true,
      doc_number: null,
    }));

    let inserted = 0;
    let duplicates = 0;
    const CHUNK = 200;
    const beforeCount = (await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol')).count ?? 0;

    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_bank_deposits')
        .upsert(chunk, { onConflict: 'audit_period_id,bank,row_hash', ignoreDuplicates: true });
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'error',
          error_message: `Erro ao inserir: ${insErr.message}`,
        }).eq('id', importRec.id);
        throw insErr;
      }
    }

    const afterCount = (await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol')).count ?? 0;
    inserted = afterCount - beforeCount;
    duplicates = deposits.length - inserted;

    await supabase.from('audit_imports').update({
      status: 'completed',
      imported_rows: inserted,
      duplicate_rows: duplicates,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    } else if (wasConciliado) {
      await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_periods')
        .update({ status: 'importado', updated_at: new Date().toISOString() })
        .eq('id', audit_period_id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_rows: deposits.length,
      imported_rows: inserted,
      duplicate_rows: duplicates,
      skipped_non_ifood: 0,
      message: `${inserted} depósitos iFood importados (PDF). ${duplicates} duplicados ignorados.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-cresol-pdf error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
