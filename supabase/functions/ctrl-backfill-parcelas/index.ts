// Backfill: re-parse raw_xml de nfe_entrada onde duplicatas está NULL
// e preenche duplicatas + pag_method. Usa a mesma lógica do espiao-sync-entrada.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { DOMParser } from 'npm:@xmldom/xmldom@0.8.10';

const T = (parent: Element | null, tag: string): string => {
  if (!parent) return '';
  const el = (parent as any).getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? '';
};
const N = (parent: Element | null, tag: string): number => {
  const s = T(parent, tag);
  return s ? Number(s) : 0;
};

const TPAG_MAP: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito',
  '15': 'Boleto', '17': 'Pix', '90': 'Sem pagamento',
};
function toISODate(v: string): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseFromXml(xmlText: string): { duplicatas: any[]; pag_method: string } | null {
  try {
    const doc: any = new DOMParser().parseFromString(xmlText, 'text/xml');
    const infNFe = doc.getElementsByTagName('infNFe')[0];
    if (!infNFe) return null;
    const cobr = infNFe.getElementsByTagName('cobr')[0] ?? null;
    const dupEls = cobr ? cobr.getElementsByTagName('dup') : [];
    const duplicatas: any[] = [];
    for (let i = 0; i < dupEls.length; i++) {
      const d = dupEls[i];
      duplicatas.push({
        nDup: T(d, 'nDup') || String(i + 1),
        dVenc: toISODate(T(d, 'dVenc')),
        vDup: N(d, 'vDup'),
      });
    }
    const pagEl = infNFe.getElementsByTagName('pag')[0] ?? null;
    const detPag = pagEl?.getElementsByTagName('detPag')[0] ?? null;
    const tPag = T(detPag, 'tPag');
    const pag_method = TPAG_MAP[tPag] ?? 'Boleto';
    return { duplicatas, pag_method };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const summary = { scanned: 0, updated: 0, skipped: 0, errors: 0, errorDetails: [] as string[] };
  const batchSize = 200;
  let offset = 0;

  try {
    while (true) {
      const { data, error } = await supabase
        .from('nfe_entrada')
        .select('id, raw_xml')
        .is('duplicatas', null)
        .not('raw_xml', 'is', null)
        .range(offset, offset + batchSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        summary.scanned++;
        const parsed = parseFromXml(row.raw_xml as string);
        if (!parsed) { summary.skipped++; continue; }
        const { error: upErr } = await supabase
          .from('nfe_entrada')
          .update({
            duplicatas: parsed.duplicatas.length > 0 ? parsed.duplicatas : null,
            pag_method: parsed.pag_method,
          })
          .eq('id', row.id);
        if (upErr) { summary.errors++; summary.errorDetails.push(`${row.id}: ${upErr.message}`); }
        else summary.updated++;
      }

      if (data.length < batchSize) break;
      offset += batchSize;
      if (offset > 20000) break;
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e), summary }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
