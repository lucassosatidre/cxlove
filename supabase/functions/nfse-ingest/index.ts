// Ingestão de NFS-e vindas do robô externo (Espião).
// POST { items: [ { meta:{}, xml?: string, pdf?: base64 } ] }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function parseValor(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // dd/MM/yyyy
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return null;
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const items = Array.isArray(body?.items) ? body.items : [];

  let upserted = 0;
  const errors: Array<{ chave?: string; error: string }> = [];

  for (const item of items) {
    const meta = item?.meta ?? {};
    const chave = String(meta.chaveAcesso ?? '').trim();
    try {
      if (!chave) throw new Error('chaveAcesso ausente');

      let hasXml = false, hasPdf = false;

      if (typeof item.xml === 'string' && item.xml.length > 0) {
        const { error } = await supabase.storage.from('nfse').upload(
          `${chave}.xml`,
          new Blob([item.xml], { type: 'application/xml' }),
          { contentType: 'application/xml', upsert: true },
        );
        if (error) throw new Error(`upload xml: ${error.message}`);
        hasXml = true;
      }

      if (typeof item.pdf === 'string' && item.pdf.length > 0) {
        const bytes = b64ToBytes(item.pdf);
        const { error } = await supabase.storage.from('nfse').upload(
          `${chave}.pdf`,
          new Blob([bytes], { type: 'application/pdf' }),
          { contentType: 'application/pdf', upsert: true },
        );
        if (error) throw new Error(`upload pdf: ${error.message}`);
        hasPdf = true;
      }

      const row = {
        chave_acesso: chave,
        numero_nfse: meta.numeroNfse ? String(meta.numeroNfse) : null,
        data_emissao: parseDate(meta.dataEmissao),
        valor_servico: parseValor(meta.valorServico),
        situacao: meta.situacao ?? null,
        descricao: meta.descricao ?? null,
        municipio: meta.municipio ?? null,
        consulta: meta.consulta ?? null,
        prestador_cnpj: meta.cnpjCpfPrestador ?? null,
        prestador_nome: meta.nomePrestador ?? null,
        tomador_cnpj: meta.cnpjCpfTomador ?? null,
        tomador_nome: meta.nomeTomador ?? null,
        codigo_verificacao: meta.codigoVerificacao ?? null,
        justificativa: meta.justificativa ?? null,
        source: 'espiao',
        ...(hasXml ? { has_xml: true } : {}),
        ...(hasPdf ? { has_pdf: true } : {}),
      };

      const { error: upErr } = await supabase
        .from('nfse_documents')
        .upsert(row, { onConflict: 'chave_acesso' });
      if (upErr) throw new Error(`upsert: ${upErr.message}`);

      upserted++;
    } catch (e) {
      errors.push({ chave, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({ upserted, errors }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
