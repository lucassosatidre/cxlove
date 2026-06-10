// @ts-nocheck
// Receives pre-parsed JSON rows from the frontend (array of arrays — header=1).
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
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
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

    // Cresol export: detecta a linha de cabeçalho ("Data ... Valor") e as
    // colunas por NOME — o layout varia entre exportações (em umas o Valor
    // fica na 5ª coluna, em outras na 3ª). Fallback: layout antigo (0,1,4).
    const norm = (s: any) => String(s ?? '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    let headerIdx = -1;
    let colData = 0, colDesc = 1, colVal = 4;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const cells = (rows[i] || []).map(norm);
      const dIdx = cells.findIndex((c: string) => c === 'data');
      const vIdx = cells.findIndex((c: string) => c === 'valor' || c.startsWith('valor'));
      if (dIdx !== -1 && vIdx !== -1) {
        headerIdx = i; colData = dIdx; colVal = vIdx;
        const descIdx = cells.findIndex((c: string) =>
          c.includes('histor') || c.includes('descri') || c.includes('lanca'));
        colDesc = descIdx !== -1 ? descIdx : dIdx + 1;
        break;
      }
    }
    const dataRows = (headerIdx !== -1 ? rows.slice(headerIdx + 1)
      : rows.length > 10 ? rows.slice(10) : rows)
      .filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
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
      const rawDate = r[colData];
      const description = r[colDesc] != null ? String(r[colDesc]).trim() : '';
      const amount = parseNumber(r[colVal]);

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

    // Validação de competência: bloqueia 100% mismatch (extrato Cresol de
    // mês X sendo importado num período de mês Y). Lote misto (alguns
    // depósitos do mês ant/post entrando) passa.
    const periodCheck = validatePeriodMatch(
      deposits.map(d => d.deposit_date),
      { month: period.month, year: period.year },
      'Cresol',
      [-1, 0, 1],
    );
    if (!periodCheck.ok) {
      await supabase.from('audit_imports').update({
        status: 'failed', error_message: periodCheck.error,
      }).eq('id', importRec.id);
      return new Response(JSON.stringify({
        error: periodCheck.error,
        breakdown_by_month: periodCheck.breakdown,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // UPSERT por row_hash (calculado por trigger no banco). Reimportar o mesmo
    // arquivo atualiza linhas existentes em vez de pular.
    let inserted = 0;
    let duplicates = 0;
    const CHUNK = 200;

    // Conta quantas das linhas já existiam (para reportar como "duplicates")
    const { count: existingCount } = await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol');
    const beforeCount = existingCount ?? 0;

    for (let i = 0; i < deposits.length; i += CHUNK) {
      const chunk = deposits.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_bank_deposits')
        .upsert(chunk, { onConflict: 'audit_period_id,bank,row_hash' });
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: insErr.message,
          imported_rows: inserted, duplicate_rows: duplicates,
        }).eq('id', importRec.id);
        return new Response(JSON.stringify({ error: `Erro ao inserir: ${insErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { count: afterCount } = await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol');
    inserted = (afterCount ?? 0) - beforeCount;
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
