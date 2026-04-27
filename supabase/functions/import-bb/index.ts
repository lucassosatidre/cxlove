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

function parseBBValue(v: any): { amount: number; isCredit: boolean } | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    return { amount: Math.abs(v), isCredit: v >= 0 };
  }
  const s = String(v).trim();
  const m = s.match(/^(-?[\d\.\,]+)\s*([CD])?$/i);
  if (!m) {
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

    // Detect format: legacy (6 cols: Data | Lançamento | Detalhes | Doc | Valor C/D | Tipo)
    // vs new (11 cols: Data | observacao | Data balancete | Ag.Origem | Lote | NumDoc | CodHist | Historico | Valor | Inf C/D | Detalhamento)
    // Find header row by looking for cells containing 'data' AND 'histor' (new format)
    // or 'data' AND 'lan' (legacy format)
    let headerIndex = -1;
    let isNewFormat = false;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i];
      if (!r || !Array.isArray(r)) continue;
      const cells = r.map((c: any) => String(c ?? '').toLowerCase().trim());
      const hasData = cells.some((c) => c === 'data' || c.startsWith('data '));
      if (!hasData) continue;
      const hasHistorico = cells.some((c) => c.includes('histor'));
      const hasLancamento = cells.some((c) => c.includes('lanca') || c.includes('lança'));
      if (hasHistorico) {
        headerIndex = i;
        isNewFormat = true;
        break;
      }
      if (hasLancamento) {
        headerIndex = i;
        isNewFormat = false;
        break;
      }
    }
    // Fallback: legacy format starts at row 1 (skip header at row 0)
    if (headerIndex < 0) {
      headerIndex = 0;
      isNewFormat = false;
    }

    // Column mapping
    const COL = isNewFormat
      ? { date: 0, desc: 7, detail: 10, doc: 5, value: 8, cd: 9, tipo: -1 }
      : { date: 0, desc: 1, detail: 2, doc: 3, value: 4, cd: -1, tipo: 5 };

    const dataRows = rows
      .slice(headerIndex + 1)
      .filter((r: any[]) => r && r.some((c: any) => c != null && c !== ''));
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
      const depositDate = parseDateBR(r[COL.date]);
      const description = r[COL.desc] != null ? String(r[COL.desc]).trim() : '';
      const detail = COL.detail >= 0 && r[COL.detail] != null ? String(r[COL.detail]).trim() : '';
      const docNumber = COL.doc >= 0 && r[COL.doc] != null ? String(r[COL.doc]).trim() : '';
      const tipo = COL.tipo >= 0 && r[COL.tipo] != null ? String(r[COL.tipo]).trim() : '';
      const cdInf = COL.cd >= 0 && r[COL.cd] != null ? String(r[COL.cd]).trim().toUpperCase() : '';

      let valueParsed: { amount: number; isCredit: boolean } | null;
      if (isNewFormat) {
        const raw = r[COL.value];
        if (raw == null || raw === '') {
          valueParsed = null;
        } else {
          const n = typeof raw === 'number'
            ? raw
            : Number(String(raw).replace(/\./g, '').replace(',', '.'));
          if (!isFinite(n)) {
            valueParsed = null;
          } else {
            valueParsed = { amount: Math.abs(n), isCredit: cdInf === 'C' || (cdInf === '' && n >= 0) };
          }
        }
      } else {
        valueParsed = parseBBValue(r[COL.value]);
      }

      if (!depositDate || !description) continue;
      if (/saldo anterior|saldo do dia|^saldo$/i.test(description)) continue;
      if (!valueParsed) continue;

      // Ignorar transferências internas (Pix recebido da própria empresa)
      // Essas movimentações não são depósitos de cartão/voucher e poluem a auditoria
      if (/pix.*recebido/i.test(description) && /pizzaria/i.test(detail || '')) {
        continue;
      }

      const isEntrada = /entrada/i.test(tipo);
      if (isNewFormat) {
        if (!valueParsed.isCredit) { skippedDebits++; continue; }
      } else {
        if (!isEntrada && !valueParsed.isCredit) { skippedDebits++; continue; }
      }
      if (valueParsed.amount <= 0) continue;

      // Categorization: new format uses Detalhamento Hist. (detail); legacy uses detail too
      const categorizationSource = detail || description;
      const category = categorizeBB(categorizationSource);
      breakdown[category] = (breakdown[category] ?? 0) + 1;

      deposits.push({
        audit_period_id,
        import_id: importRec.id,
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

    // UPSERT por row_hash (calculado por trigger no banco). Permite reimportar
    // o mesmo extrato sem duplicar e sem ignorar linhas atualizadas.
    let inserted = 0;
    let duplicates = 0;
    const CHUNK = 200;

    const { count: existingCount } = await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'bb');
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
      .eq('bank', 'bb');
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
      // Reset status: novos depósitos exigem reconciliação
      await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_voucher_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_periods')
        .update({ status: 'importado', updated_at: new Date().toISOString() })
        .eq('id', audit_period_id);
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
