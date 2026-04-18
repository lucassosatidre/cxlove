// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

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

// Parse "311,49 C" / "-1.613,32 D" / "2.740,13 C" → { amount: number, isCredit: boolean }
function parseBBValue(v: any): { amount: number; isCredit: boolean } | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    return { amount: Math.abs(v), isCredit: v >= 0 };
  }
  const s = String(v).trim();
  const m = s.match(/^(-?[\d\.\,]+)\s*([CD])?$/i);
  if (!m) {
    // tenta só número
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    if (!isFinite(n)) return null;
    return { amount: Math.abs(n), isCredit: n >= 0 };
  }
  const numStr = m[1].replace(/\./g, '').replace(',', '.');
  const n = Number(numStr);
  if (!isFinite(n)) return null;
  const suffix = (m[2] ?? '').toUpperCase();
  const isCredit = suffix === 'C' ? true : suffix === 'D' ? false : n >= 0;
  return { amount: Math.abs(n), isCredit };
}

function categorizeBB(detail: string): string {
  const d = (detail || '').toUpperCase();
  if (/ALELO/.test(d)) return 'alelo';
  if (/TICKET/.test(d)) return 'ticket';
  if (/PLUXEE|SODEXO/.test(d)) return 'pluxee';
  if (/78626983|BANCO VR/.test(d)) return 'vr';
  if (/BRENDI/.test(d)) return 'brendi';
  return 'outro';
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
    const { audit_period_id, file_base64, file_name } = body || {};
    if (!audit_period_id || !file_base64 || !file_name) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes' }), {
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
    if (!['aberto', 'importado'].includes(period.status)) {
      return new Response(JSON.stringify({ error: `Período está '${period.status}' e não permite importação` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bin = atob(file_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    let workbook: any;
    try {
      workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    } catch {
      return new Response(JSON.stringify({ error: 'Não foi possível ler o arquivo .xlsx' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Procura aba "Extrato Conta" ou usa a primeira
    const sheetName = workbook.SheetNames.find((n: string) => /extrato/i.test(n)) || workbook.SheetNames[0];
    if (!sheetName) {
      return new Response(JSON.stringify({ error: 'Arquivo sem abas' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    // Linha 0 = cabeçalho. Dados começam na linha 1.
    const dataRows = rows.slice(1).filter(r => r && r.some(c => c != null && c !== ''));
    const totalRows = dataRows.length;

    const { data: importRec, error: importErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'bb',
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
    let skippedDebits = 0;
    const breakdown: Record<string, number> = { alelo: 0, ticket: 0, pluxee: 0, vr: 0, brendi: 0, outro: 0 };

    for (const r of dataRows) {
      const depositDate = parseDateBR(r[0]);
      const description = r[1] != null ? String(r[1]).trim() : '';
      const detail = r[2] != null ? String(r[2]).trim() : '';
      const docNumber = r[3] != null ? String(r[3]).trim() : '';
      const valueParsed = parseBBValue(r[4]);
      const tipo = r[5] != null ? String(r[5]).trim() : '';

      if (!depositDate || !description) continue;
      // Ignora linhas de saldo
      if (/saldo anterior|saldo do dia|saldo/i.test(description)) continue;
      if (!valueParsed) continue;

      // Apenas créditos (Entrada ou C)
      const isEntrada = /entrada/i.test(tipo);
      if (!isEntrada && !valueParsed.isCredit) {
        skippedDebits++;
        continue;
      }
      if (valueParsed.amount <= 0) continue;

      const category = categorizeBB(detail);
      breakdown[category] = (breakdown[category] ?? 0) + 1;

      deposits.push({
        audit_period_id,
        bank: 'bb',
        deposit_date: depositDate,
        description,
        detail: detail || null,
        amount: valueParsed.amount,
        category,
        auto_categorized: true,
        doc_number: docNumber || null,
      });
    }

    // Dedup por (bank, deposit_date, amount, doc_number)
    const { data: existing } = await supabase
      .from('audit_bank_deposits')
      .select('deposit_date,amount,doc_number')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'bb');
    const existingKeys = new Set(
      (existing ?? []).map((e: any) =>
        `${e.deposit_date}|${Number(e.amount).toFixed(2)}|${e.doc_number ?? ''}`,
      ),
    );

    const toInsert: any[] = [];
    let duplicates = 0;
    for (const d of deposits) {
      const key = `${d.deposit_date}|${d.amount.toFixed(2)}|${d.doc_number ?? ''}`;
      if (existingKeys.has(key)) {
        duplicates++;
        continue;
      }
      existingKeys.add(key);
      toInsert.push(d);
    }

    let inserted = 0;
    const CHUNK = 200;
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
      skipped_debits: skippedDebits,
      breakdown_by_category: breakdown,
      message: `${inserted} créditos importados`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('import-bb error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
