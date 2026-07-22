// Puxa NF-e de ENTRADA direto do Espião NF-e (Espião Cloud) para o Vigia.
// Grava em nfe_entrada / nfe_entrada_items (dedup por access_key). Sem passar pelo Maná.
// Também aceita { xmls: [rawXml,...] } para importação manual de XML pelo app.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { DOMParser } from 'npm:@xmldom/xmldom@0.8.10';

const ESPIAO_BASE = 'https://api.espiaonfe.com.br/v1-cloud';
const TARGET_CNPJ = '00939190000107';

const onlyDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

const T = (parent: Element | null, tag: string): string => {
  if (!parent) return '';
  const el = (parent as any).getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? '';
};
const N = (parent: Element | null, tag: string): number => {
  const s = T(parent, tag);
  return s ? Number(s) : 0;
};

interface ParsedItem {
  seq: number; c_prod: string; c_ean: string; description: string; ncm: string; cfop: string;
  u_com: string; q_com: number; v_un_com: number;
  u_trib: string; q_trib: number; v_un_trib: number; v_prod: number; v_desc: number; v_encargos: number;
}
interface ParsedDup { nDup: string; dVenc: string | null; vDup: number }
interface Parsed {
  access_key: string; numero: string; serie: string;
  emit_cnpj: string; emit_name: string; dest_cnpj: string;
  emission_date: string | null; total_value: number; items: ParsedItem[]; raw_xml: string;
  duplicatas: ParsedDup[]; pag_method: string;
}

const TPAG_MAP: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito',
  '15': 'Boleto', '17': 'Pix', '90': 'Sem pagamento',
};
function toISODate(v: string): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseNfeXml(xmlText: string): Parsed | null {
  const doc: any = new DOMParser().parseFromString(xmlText, 'text/xml');
  const infNFe = doc.getElementsByTagName('infNFe')[0];
  if (!infNFe) return null;
  const idAttr = infNFe.getAttribute('Id') ?? '';
  const access_key = idAttr.replace(/^NFe/i, '') || T(doc.documentElement, 'chNFe');
  const ide = infNFe.getElementsByTagName('ide')[0] ?? null;
  const emit = infNFe.getElementsByTagName('emit')[0] ?? null;
  const dest = infNFe.getElementsByTagName('dest')[0] ?? null;
  const total = infNFe.getElementsByTagName('total')[0] ?? null;
  const icmsTot = total?.getElementsByTagName('ICMSTot')[0] ?? null;
  const emission_raw = T(ide, 'dhEmi') || T(ide, 'dEmi');
  const emission_date = emission_raw ? new Date(emission_raw).toISOString() : null;

  const items: ParsedItem[] = [];
  const dets = infNFe.getElementsByTagName('det');
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const prod = det.getElementsByTagName('prod')[0];
    if (!prod) continue;
    const seq = Number(det.getAttribute('nItem') ?? i + 1);
    const v_encargos = N(det, 'vICMSST') + N(det, 'vIPI') + N(prod, 'vFrete') + N(prod, 'vSeg') + N(prod, 'vOutro');
    items.push({
      seq,
      c_prod: T(prod, 'cProd'), c_ean: T(prod, 'cEAN'),
      description: T(prod, 'xProd'), ncm: T(prod, 'NCM'), cfop: T(prod, 'CFOP'),
      u_com: T(prod, 'uCom'), q_com: N(prod, 'qCom'), v_un_com: N(prod, 'vUnCom'),
      u_trib: T(prod, 'uTrib'), q_trib: N(prod, 'qTrib'), v_un_trib: N(prod, 'vUnTrib'),
      v_prod: N(prod, 'vProd'), v_desc: N(prod, 'vDesc'), v_encargos,
    });
  }

  // Duplicatas (parcelas) e método de pagamento — usados pela Controladoria Financeira.
  const cobr = infNFe.getElementsByTagName('cobr')[0] ?? null;
  const dupEls = cobr ? cobr.getElementsByTagName('dup') : [];
  const duplicatas: ParsedDup[] = [];
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

  return {
    access_key,
    numero: T(ide, 'nNF'), serie: T(ide, 'serie'),
    emit_cnpj: onlyDigits(T(emit, 'CNPJ')), emit_name: T(emit, 'xNome'),
    dest_cnpj: onlyDigits(T(dest, 'CNPJ')),
    emission_date, total_value: N(icmsTot, 'vNF'),
    items, raw_xml: xmlText,
    duplicatas, pag_method,
  };
}

// base64 -> gzip -> utf-16le (formato do Espião)
async function decodeEspiaoXml(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  const buf = new Uint8Array(await stream.arrayBuffer());
  return new TextDecoder('utf-16le').decode(buf);
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const summary = { imported: 0, skipped: 0, errors: 0, errorDetails: [] as string[], pages: 0, listed: 0 };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  async function processXml(xmlText: string, source: string) {
    const parsed = parseNfeXml(xmlText);
    if (!parsed || !parsed.access_key) { summary.errors++; summary.errorDetails.push('parse: sem access_key'); return; }

    const { data: existing } = await supabase
      .from('nfe_entrada').select('id').eq('access_key', parsed.access_key).maybeSingle();
    if (existing) { summary.skipped++; return; }

    const { data: ins, error: insErr } = await supabase.from('nfe_entrada').insert({
      access_key: parsed.access_key,
      numero: parsed.numero, serie: parsed.serie,
      emit_cnpj: parsed.emit_cnpj, emit_name: parsed.emit_name,
      dest_cnpj: parsed.dest_cnpj,
      emission_date: parsed.emission_date,
      total_value: parsed.total_value,
      source,
      raw_xml: parsed.raw_xml,
      duplicatas: parsed.duplicatas.length > 0 ? parsed.duplicatas : null,
      pag_method: parsed.pag_method,
    }).select('id').single();
    if (insErr || !ins) { summary.errors++; summary.errorDetails.push(`insert ${parsed.access_key}: ${insErr?.message}`); return; }

    if (parsed.items.length > 0) {
      const itemsPayload = parsed.items.map((it) => ({ nfe_id: ins.id, ...it }));
      await supabase.from('nfe_entrada_items').insert(itemsPayload);
    }
    summary.imported++;
  }

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    // Modo importação por CHAVE / código de barras (44 dígitos).
    // O Vigia não alcança o Espião (IP fora do BR); busca o XML pela ponte do Maná (nfe-feed).
    if (typeof body?.chave === 'string' && body.chave.replace(/\D/g, '').length > 0) {
      const chave = body.chave.replace(/\D/g, '');
      const jh = { ...corsHeaders, 'Content-Type': 'application/json' };
      const done = (obj: any) => new Response(JSON.stringify(obj), { headers: jh });
      if (chave.length !== 44) return done({ ok: false, message: 'Chave inválida: informe os 44 dígitos.' });

      const feedUrl = Deno.env.get('COLOVE_NFE_FEED_URL');
      const feedToken = Deno.env.get('NFE_FEED_TOKEN');
      if (!feedUrl || !feedToken) return done({ ok: false, message: 'Ponte do Espião (Maná) não configurada.' });

      let bridge: any = null;
      try {
        const r = await fetch(feedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${feedToken}` },
          body: JSON.stringify({ chave }),
        });
        bridge = await r.json().catch(() => null);
      } catch (e: any) {
        return done({ ok: false, message: `Falha ao consultar o Espião: ${e?.message ?? e}` });
      }
      if (!bridge?.found || !bridge?.xml) {
        return done({ ok: false, message: bridge?.error || 'Nota não encontrada no Espião.' });
      }

      await processXml(bridge.xml, 'chave');
      if (summary.imported > 0) return done({ ok: true, imported: 1, message: 'Nota importada com sucesso.' });
      if (summary.skipped > 0) return done({ ok: true, imported: 0, skipped: 1, message: 'Essa nota já estava importada.' });
      return done({ ok: false, message: summary.errorDetails[0] || 'Não foi possível importar a nota.' });
    }

    // Modo importação manual: XMLs crus enviados pelo app
    if (Array.isArray(body?.xmls) && body.xmls.length > 0) {
      for (const x of body.xmls) {
        try {
          if (typeof x === 'string' && x.trim().startsWith('<')) await processXml(x, 'upload');
          else await processXml(await decodeEspiaoXml(x), 'upload');
        } catch (e: any) { summary.errors++; summary.errorDetails.push(`upload: ${e?.message ?? e}`); }
      }
      return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Modo Espião: puxa da API
    const cloudToken = Deno.env.get('ESPIAO_CLOUD_TOKEN');
    const userToken = Deno.env.get('ESPIAO_USER_TOKEN');
    if (!cloudToken || !userToken) {
      return new Response(JSON.stringify({ error: 'ESPIAO_CLOUD_TOKEN/ESPIAO_USER_TOKEN não configurados no Vigia', summary }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const days = Number(body?.days ?? 30);
    const hoje = new Date();
    const ini = new Date(hoje); ini.setDate(hoje.getDate() - (isFinite(days) ? days : 30));
    const dataInicial = body?.dataInicial ?? fmtDate(ini);
    const dataFinal = body?.dataFinal ?? fmtDate(hoje);

    const headers = {
      'esp-cloud-token': cloudToken,
      'user-token': userToken,
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; VigiaBot/1.0)',
    };

    let codigoProximaPagina: string | null = null;
    while (true) {
      const qs = new URLSearchParams({
        dataInicial, dataFinal, modelo: '55', cnpjCpf: TARGET_CNPJ, tipoPeriodo: 'E',
      });
      if (codigoProximaPagina) qs.set('codigoProximaPagina', codigoProximaPagina);

      let res: Response | null = null;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { res = await fetch(`${ESPIAO_BASE}/consulta/periodo/xmls?${qs.toString()}`, { headers }); break; }
        catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
      }
      if (!res) { summary.errors++; summary.errorDetails.push(`list connect: ${lastErr?.message ?? lastErr}`); break; }
      if (!res.ok) { const t = await res.text(); summary.errors++; summary.errorDetails.push(`list: ${res.status} ${t.slice(0, 200)}`); break; }

      const json: any = await res.json();
      const dados: any[] = json?.dados ?? [];
      summary.pages++; summary.listed += dados.length;

      for (const item of dados) {
        try { await processXml(await decodeEspiaoXml(item.xml), 'espiao'); }
        catch (e: any) { summary.errors++; summary.errorDetails.push(`item: ${e?.message ?? e}`); }
      }

      const next = json?.codigoProximaPagina;
      if (!next || String(next) === '-1') break;
      codigoProximaPagina = String(next);
      if (summary.pages > 200) break;
    }

    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e), summary }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
