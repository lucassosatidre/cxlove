// Puxa NF-e do feed do Maná (colove) e insere em cashflow_launches (source='nfe').
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

type Dup = { nDup?: string; dVenc?: string | null; vDup?: number };
type Nota = {
  access_key: string;
  numero: string;
  serie?: string;
  emission_date: string;
  emit_cnpj: string;
  emit_name: string;
  total_value: number;
  duplicatas?: Dup[];
  pag?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const feedUrl = Deno.env.get('COLOVE_NFE_FEED_URL');
    const token = Deno.env.get('NFE_FEED_TOKEN');
    if (!feedUrl || !token) {
      return new Response(JSON.stringify({ error: 'Missing COLOVE_NFE_FEED_URL or NFE_FEED_TOKEN' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let since: string | null = null;
    try {
      const url = new URL(req.url);
      since = url.searchParams.get('since');
      if (!since && req.method !== 'GET') {
        const body = await req.json().catch(() => ({}));
        since = body?.since ?? null;
      }
    } catch { /* noop */ }

    if (!since) {
      const d = new Date();
      d.setDate(d.getDate() - 120);
      since = d.toISOString().slice(0, 10);
    }

    const feedRes = await fetch(`${feedUrl}?since=${encodeURIComponent(since)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!feedRes.ok) {
      const txt = await feedRes.text();
      return new Response(JSON.stringify({ error: 'feed error', status: feedRes.status, body: txt.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const feed = await feedRes.json() as { count?: number; notas?: Nota[] };
    const notas = feed?.notas ?? [];

    const rows: any[] = [];
    for (const n of notas) {
      if (!n.access_key) continue;
      const base = {
        emissao: n.emission_date,
        fornecedor: n.emit_name,
        cnpj: n.emit_cnpj,
        numero_nota: n.numero,
        payment_method: n.pag || 'Boleto',
        category: 'Matéria Prima',
        source: 'nfe',
        nfe_access_key: n.access_key,
        paid: false,
      };
      const dups = n.duplicatas ?? [];
      if (dups.length > 0) {
        for (const d of dups) {
          rows.push({
            ...base,
            vencimento: d.dVenc ?? n.emission_date,
            amount: -Math.abs(Number(d.vDup || 0)),
            descricao: `NF-e ${n.numero} parcela ${d.nDup || '1'}`,
            nfe_dup: d.nDup || '1',
          });
        }
      } else {
        rows.push({
          ...base,
          vencimento: n.emission_date,
          amount: -Math.abs(Number(n.total_value || 0)),
          descricao: `NF-e ${n.numero}`,
          nfe_dup: '1',
        });
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let inserted = 0;
    if (rows.length > 0) {
      const keys = rows.map(r => ({ k: r.nfe_access_key, d: r.nfe_dup }));
      const { data: existing } = await supabase
        .from('cashflow_launches')
        .select('nfe_access_key,nfe_dup')
        .eq('source', 'nfe')
        .in('nfe_access_key', keys.map(k => k.k));
      const existingSet = new Set((existing || []).map((e: any) => `${e.nfe_access_key}|${e.nfe_dup}`));

      const { error } = await supabase
        .from('cashflow_launches')
        .upsert(rows, { onConflict: 'nfe_access_key,nfe_dup', ignoreDuplicates: true });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted = rows.filter(r => !existingSet.has(`${r.nfe_access_key}|${r.nfe_dup}`)).length;
    }

    return new Response(JSON.stringify({
      feed_count: feed?.count ?? notas.length,
      inserted,
      skipped: rows.length - inserted,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
