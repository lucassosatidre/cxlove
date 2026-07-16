// Parser client-side de NF-e (modelo 55) para gerar contas a pagar em cashflow_launches.
// Aceita XML de nfeProc>NFe>infNFe ou NFe>infNFe. Namespace http://www.portalfiscal.inf.br/nfe.

import JSZip from 'jszip';

export type NFeDup = { nDup: string; dVenc: string | null; vDup: number };

export type ParsedNFe = {
  access_key: string;
  numero: string;
  serie: string;
  emission_date: string; // YYYY-MM-DD
  emit_cnpj: string;
  emit_name: string;
  total_value: number;
  duplicatas: NFeDup[];
  pag: string; // método
};

export type NFeLancamento = {
  emissao: string;
  vencimento: string | null;
  amount: number;
  fornecedor: string;
  cnpj: string;
  numero_nota: string;
  descricao: string;
  payment_method: string;
  category: string;
  source: 'nfe';
  nfe_access_key: string;
  nfe_dup: string;
  paid: false;
};

const TPAG_MAP: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '15': 'Boleto',
  '17': 'Pix',
  '90': 'Sem pagamento',
};

function findByLocal(root: Element | Document, localName: string): Element | null {
  const walker = (root as any).getElementsByTagNameNS
    ? (root as any).getElementsByTagNameNS('*', localName)
    : (root as any).getElementsByTagName(localName);
  if (walker && walker.length > 0) return walker[0] as Element;
  return null;
}
function findAllByLocal(root: Element | Document, localName: string): Element[] {
  const walker = (root as any).getElementsByTagNameNS
    ? (root as any).getElementsByTagNameNS('*', localName)
    : (root as any).getElementsByTagName(localName);
  const out: Element[] = [];
  for (let i = 0; i < walker.length; i++) out.push(walker[i] as Element);
  return out;
}
function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}
function findChildByLocal(parent: Element | null, localName: string): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i] as Element;
    if (c.localName === localName || c.tagName === localName || c.tagName.split(':').pop() === localName) return c;
  }
  return null;
}
function findChildrenByLocal(parent: Element | null, localName: string): Element[] {
  if (!parent) return [];
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i] as Element;
    if (c.localName === localName || c.tagName === localName || c.tagName.split(':').pop() === localName) out.push(c);
  }
  return out;
}

function toISODate(v: string): string {
  if (!v) return '';
  const s = v.trim();
  // dhEmi ex: 2026-07-15T10:22:00-03:00
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dEmi ex: 2026-07-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function digitsOnly(v: string): string {
  return (v || '').replace(/\D+/g, '');
}

export function parseNFeXml(xmlText: string): ParsedNFe {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) throw new Error('XML inválido');

  const infNFe = findByLocal(doc, 'infNFe');
  if (!infNFe) throw new Error('Tag infNFe não encontrada — não parece uma NF-e');

  const idAttr = infNFe.getAttribute('Id') || '';
  const access_key = idAttr.replace(/^NFe/i, '').replace(/\D+/g, '');

  const ide = findChildByLocal(infNFe, 'ide');
  const numero = textOf(findChildByLocal(ide, 'nNF'));
  const serie = textOf(findChildByLocal(ide, 'serie'));
  const dhEmi = textOf(findChildByLocal(ide, 'dhEmi'));
  const dEmi = textOf(findChildByLocal(ide, 'dEmi'));
  const emission_date = toISODate(dhEmi || dEmi);

  const emit = findChildByLocal(infNFe, 'emit');
  const emit_cnpj = digitsOnly(textOf(findChildByLocal(emit, 'CNPJ')));
  const emit_name = textOf(findChildByLocal(emit, 'xNome'));

  const total = findChildByLocal(infNFe, 'total');
  const icmsTot = findChildByLocal(total, 'ICMSTot');
  const total_value = Number(textOf(findChildByLocal(icmsTot, 'vNF')) || 0) || 0;

  const cobr = findChildByLocal(infNFe, 'cobr');
  const dups = findChildrenByLocal(cobr, 'dup');
  const duplicatas: NFeDup[] = dups.map((d) => ({
    nDup: textOf(findChildByLocal(d, 'nDup')) || '',
    dVenc: toISODate(textOf(findChildByLocal(d, 'dVenc'))) || null,
    vDup: Number(textOf(findChildByLocal(d, 'vDup')) || 0) || 0,
  }));

  const pag = findChildByLocal(infNFe, 'pag');
  const detPag = findChildByLocal(pag, 'detPag');
  const tPag = textOf(findChildByLocal(detPag, 'tPag'));
  const pagMethod = TPAG_MAP[tPag] ?? (tPag ? 'Boleto' : 'Boleto');

  return {
    access_key,
    numero,
    serie,
    emission_date,
    emit_cnpj,
    emit_name,
    total_value,
    duplicatas,
    pag: pagMethod,
  };
}

export async function extractXmlFiles(files: File[]): Promise<Array<{ name: string; text: string }>> {
  const out: Array<{ name: string; text: string }> = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.xml')) {
      out.push({ name: f.name, text: await f.text() });
    } else if (lower.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const entries = Object.values(zip.files);
      for (const entry of entries) {
        if (entry.dir) continue;
        if (!entry.name.toLowerCase().endsWith('.xml')) continue;
        const text = await entry.async('string');
        out.push({ name: entry.name, text });
      }
    }
  }
  return out;
}

export function nfeToLancamentos(parsed: ParsedNFe): NFeLancamento[] {
  const base = {
    emissao: parsed.emission_date,
    fornecedor: parsed.emit_name,
    cnpj: parsed.emit_cnpj,
    numero_nota: parsed.numero,
    payment_method: parsed.pag || 'Boleto',
    category: 'Matéria Prima',
    source: 'nfe' as const,
    nfe_access_key: parsed.access_key,
    paid: false as const,
  };

  if (parsed.duplicatas.length > 0) {
    return parsed.duplicatas.map((d) => ({
      ...base,
      vencimento: d.dVenc,
      amount: -Math.abs(d.vDup),
      descricao: `NF-e ${parsed.numero} parcela ${d.nDup}`,
      nfe_dup: d.nDup || '1',
    }));
  }
  return [{
    ...base,
    vencimento: parsed.emission_date,
    amount: -Math.abs(parsed.total_value),
    descricao: `NF-e ${parsed.numero}`,
    nfe_dup: '1',
  }];
}
