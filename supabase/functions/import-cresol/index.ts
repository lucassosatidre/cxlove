// @ts-nocheck
// Receives pre-parsed JSON rows from the frontend (array of arrays — header=1).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function parseDateBR(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parseNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : 0;
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

    // Cresol export: header on row 9 (index 9), data starts row 10.
    // Frontend sends the raw matrix (header=1). Skip until row 10 if needed,
    // otherwise just iterate and let the date/amount filters drop noise rows.
    const dataRows = rows.length > 10
      ? rows.slice(10).filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''))
      : rows.filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
    const totalRows = dataRows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'cresol',
        file_name,
        total_rows: totalRows,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (importErr) {
      return new Response(JSON.stringify({ error: `Erro ao registrar importação: ${importErr.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const deposits: any[] = [];
    let skippedNonIfood = 0;
    for (const r of dataRows) {
      const rawDate = r[0];
      const description = r[1] != null ? String(r[1]).trim() : '';
      const amount = parseNumber(r[4]);

      if (!description) continue;
      if (/consulta posicao|periodo de/i.test(description) && !rawDate) continue;
      const depositDate = parseDateBR(rawDate);
      if (!depositDate) continue;
      if (amount <= 0) continue;

      if (!/ifood/i.test(description)) {
        skippedNonIfood++;
        continue;
      }

      deposits.push({
        audit_period_id,
        import_id: importRec.id,
        bank: 'cresol',
        deposit_date: depositDate,
        description,
        detail: null,
        amount,
        category: 'ifood',
        auto_categorized: true,
        doc_number: null,
      });
    }

    let inserted = 0;
    let duplicates = 0;
    const CHUNK = 200;

    const { data: existing } = await supabase
      .from('audit_bank_deposits')
      .select('deposit_date,amount,description')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol');
    const existingKeys = new Set(
      (existing ?? []).map((e: any) => `${e.deposit_date}|${Number(e.amount).toFixed(2)}|${(e.description ?? '').trim()}`),
    );

    const toInsert: any[] = [];
    for (const d of deposits) {
      const key = `${d.deposit_date}|${d.amount.toFixed(2)}|${d.description.trim()}`;
      if (existingKeys.has(key)) {
        duplicates++;
        continue;
      }
      existingKeys.add(key);
      toInsert.push(d);
    }

    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const { error: insErr } = await supabase.from('audit_bank_deposits').insert(chunk);
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: insErr.message,
          imported_rows: inserted, duplicate_rows: duplicates,
        }).eq('id', importRec.id);
        return new Response(JSON.stringify({ error: `Erro ao inserir: ${insErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted += chunk.length;
    }

    await supabase.from('audit_imports').update({
      status: 'completed',
      imported_rows: inserted,
      duplicate_rows: duplicates,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_rows: totalRows,
      imported_rows: inserted,
      duplicate_rows: duplicates,
      skipped_non_ifood: skippedNonIfood,
      message: `${inserted} depósitos iFood importados, ${duplicates} duplicados, ${skippedNonIfood} não-iFood ignorados`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-cresol error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
