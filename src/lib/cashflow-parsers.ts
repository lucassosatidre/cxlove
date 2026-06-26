// Cashflow parsers — client-side (SheetJS). NÃO calcula row_hash (trigger faz).
// Cada linha leva `source_seq` = índice físico no arquivo (estável → reimport idempotente).
import * as XLSX from 'xlsx';

// ============================================================================
// Types
// ============================================================================
export type CashflowTxRow = {
  source: 'bb' | 'cresol' | 'c6' | 'sicredi' | 'ifood';
  account_id: string | null;
  tx_date: string;             // ISO yyyy-mm-dd
  description: string | null;
  detail: string | null;
  amount: number;              // assinado: + entrada / − saída
  running_balance: number | null;
  category: string | null;
  is_internal_transfer: boolean;
  counterparty: string | null;
  doc_number: string | null;
  source_seq: number;
};

export type CashflowSaiposRow = {
  source: 'saipos';
  company: 'estrela' | 'proposito';
  vencimento: string | null;
  emissao: string | null;
  pagamento: string | null;
  amount: number;              // assinado
  payment_method: string | null;
  category: string | null;
  fornecedor: string | null;
  descricao: string | null;
  paid: boolean;
  is_frente_caixa: boolean;
  source_seq: number;
};

export type ClosingInfo = { balance: number | null; as_of: string | null };
export type ParseResult<T> = { rows: T[]; skipped: number; closing?: ClosingInfo };

// ============================================================================
// Workbook / sheet helpers (copiado de UploadCards.tsx)
// ============================================================================
export function fixSheetRange(sheet: XLSX.WorkSheet): XLSX.WorkSheet {
  const keys = Object.keys(sheet).filter((k) => !k.startsWith('!'));
  if (keys.length === 0) return sheet;
  let maxR = 0, maxC = 0;
  for (const k of keys) {
    const ref = XLSX.utils.decode_cell(k);
    if (ref.r > maxR) maxR = ref.r;
    if (ref.c > maxC) maxC = ref.c;
  }
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return sheet;
}

export function readWorkbookFixed(buf: ArrayBuffer): XLSX.WorkBook {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  for (const name of wb.SheetNames) wb.Sheets[name] = fixSheetRange(wb.Sheets[name]);
  return wb;
}

export function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
}

// ============================================================================
// CSV
// ============================================================================
export function parseCsvLine(line: string, sep = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ============================================================================
// Dates / numbers
// ============================================================================
export function parseDateBR(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    const dc = XLSX.SSF.parse_date_code(v);
    if (dc) return `${dc.y}-${String(dc.m).padStart(2, '0')}-${String(dc.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

export const toIsoDate = parseDateBR;
export const normalizeDateBR = parseDateBR;

export function parseNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/R\$\s?/i, '');
  // BR: 1.234,56  / EN: 1,234.56
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let n: number;
  if (hasComma && hasDot) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (hasComma) n = Number(s.replace(',', '.'));
  else n = Number(s);
  return isFinite(n) ? n : 0;
}

export const toNum = parseNumber;

export function parseBBValue(v: unknown): { amount: number; isCredit: boolean } | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return { amount: Math.abs(v), isCredit: v >= 0 };
  const s = String(v).trim();
  const m = s.match(/^(-?[\d.,]+)\s*([CD])?$/i);
  if (!m) {
    const n = parseNumber(s);
    if (!isFinite(n) || n === 0) return null;
    return { amount: Math.abs(n), isCredit: n >= 0 };
  }
  const n = parseNumber(m[1]);
  if (!isFinite(n)) return null;
  const suf = (m[2] ?? '').toUpperCase();
  const isCredit = suf === 'C' ? true : suf === 'D' ? false : n >= 0;
  return { amount: Math.abs(n), isCredit };
}

// ============================================================================
// Categorization / internal transfer detection
// ============================================================================
function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

export function categorizeBB(detail: string): string {
  const d = norm(detail);
  if (/ALELO/.test(d) || /04\.?740\.?876/.test(d)) return 'alelo';
  if (/TICKET|EDENRED/.test(d) || /47\.?866\.?934/.test(d)) return 'ticket';
  if (/TOPAZIO/.test(d) || /07\.?679\.?404/.test(d)) return 'ticket';
  if (/PLUXEE|SODEXO/.test(d)) return 'pluxee';
  if (/78626983|BANCO\s*VR|VR\s+BENEFICIOS?|VR\s+REFEICAO/.test(d)) return 'vr';
  if (/BRENDI/.test(d)) return 'brendi';
  if (/IFOOD/.test(d)) return 'ifood';
  return 'outro';
}

const INTERNAL_TOKENS = [
  'PIZZARIA ESTRELA DA ILHA',
  'PROPOSITO',
  '5 ESTRELAS',
  'PROVER',
  'LUCAS SOSA TIDRE',
  'LUANA',
];

export function detectInternalTransfer(
  description: string | null | undefined,
  detail: string | null | undefined,
): { is_internal_transfer: boolean; counterparty: string | null } {
  const txt = `${description ?? ''} ${detail ?? ''}`;
  const n = norm(txt);

  // iFood: repasse / antecipação / pix enviado IFOOD → interno (mesma operação)
  if (/IFOOD/.test(n) && /(REPASSE|PIX ENVIADO|ANTECIPACAO)/.test(n)) {
    return { is_internal_transfer: true, counterparty: 'IFOOD' };
  }

  for (const tok of INTERNAL_TOKENS) {
    if (n.includes(tok)) return { is_internal_transfer: true, counterparty: tok };
  }

  const m = txt.match(/Pix\s+(?:enviado\s+para|recebido(?:\s+c6)?\s+de)\s+(.+)/i);
  const counterparty = m ? m[1].trim().slice(0, 200) : null;
  return { is_internal_transfer: false, counterparty };
}

// ============================================================================
// Parsers
// ============================================================================

// ---- BB ----
export function parseBB(rows: unknown[][], accountId: string | null = null): ParseResult<CashflowTxRow> {
  // detecta header e formato (igual import-bb)
  let headerIdx = -1;
  let isNew = false;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i];
    if (!r) continue;
    const cells = r.map((c) => String(c ?? '').toLowerCase().trim());
    const hasData = cells.some((c) => c === 'data' || c.startsWith('data '));
    if (!hasData) continue;
    const hasHist = cells.some((c) => c.includes('histor'));
    const hasLanc = cells.some((c) => c.includes('lanca') || c.includes('lança'));
    if (hasHist) { headerIdx = i; isNew = true; break; }
    if (hasLanc) { headerIdx = i; isNew = false; break; }
  }
  if (headerIdx < 0) { headerIdx = 0; isNew = false; }

  const COL = isNew
    ? { date: 0, desc: 7, detail: 10, doc: 5, value: 8, cd: 9, tipo: -1 }
    : { date: 0, desc: 1, detail: 2, doc: 3, value: 4, cd: -1, tipo: 5 };

  const out: CashflowTxRow[] = [];
  let skipped = 0;
  let closingBalance: number | null = null;
  let maxDate: string | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c != null && c !== '')) { skipped++; continue; }
    const dt = parseDateBR(r[COL.date]);
    const desc = String(r[COL.desc] ?? '').trim();
    if (!dt || !desc) { skipped++; continue; }
    if (/saldo anterior|saldo do dia|^saldo$|S A L D O/i.test(desc)) {
      // Captura a linha de SALDO de fechamento (a última vence)
      const cdInf = COL.cd >= 0 ? String(r[COL.cd] ?? '').trim().toUpperCase() : '';
      let raw: number | null = null;
      if (isNew) {
        const v = r[COL.value];
        if (v != null && v !== '') {
          const n = typeof v === 'number' ? v : parseNumber(v);
          if (isFinite(n)) raw = Math.abs(n);
        }
      } else {
        const parsed = parseBBValue(r[COL.value]);
        if (parsed) raw = parsed.amount;
      }
      if (raw != null) {
        const isCredit = cdInf === 'C' ? true : cdInf === 'D' ? false : true;
        closingBalance = isCredit ? raw : -raw;
        if (!maxDate || dt > maxDate) maxDate = dt;
      }
      skipped++;
      continue;
    }

    const detail = COL.detail >= 0 ? String(r[COL.detail] ?? '').trim() : '';
    const docNumber = COL.doc >= 0 ? String(r[COL.doc] ?? '').trim() : '';
    const cdInf = COL.cd >= 0 ? String(r[COL.cd] ?? '').trim().toUpperCase() : '';
    const tipo = COL.tipo >= 0 ? String(r[COL.tipo] ?? '').trim() : '';

    let parsed: { amount: number; isCredit: boolean } | null;
    if (isNew) {
      const raw = r[COL.value];
      if (raw == null || raw === '') { skipped++; continue; }
      const n = typeof raw === 'number' ? raw : parseNumber(raw);
      if (!isFinite(n) || n === 0) { skipped++; continue; }
      parsed = { amount: Math.abs(n), isCredit: cdInf === 'C' || (cdInf === '' && n >= 0) };
    } else {
      parsed = parseBBValue(r[COL.value]);
      if (!parsed) { skipped++; continue; }
      if (!/entrada/i.test(tipo) && !parsed.isCredit) {
        parsed = { amount: parsed.amount, isCredit: parsed.isCredit };
      }
    }
    if (!parsed || parsed.amount === 0) { skipped++; continue; }

    const amount = parsed.isCredit ? parsed.amount : -parsed.amount;
    const it = detectInternalTransfer(desc, detail);
    if (!maxDate || dt > maxDate) maxDate = dt;
    out.push({
      source: 'bb',
      account_id: accountId,
      tx_date: dt,
      description: desc,
      detail: detail || null,
      amount,
      running_balance: null,
      category: categorizeBB(detail || desc),
      is_internal_transfer: it.is_internal_transfer,
      counterparty: it.counterparty,
      doc_number: docNumber || null,
      source_seq: i,
    });
  }
  return { rows: out, skipped, closing: { balance: closingBalance, as_of: maxDate } };
}

// ---- Cresol ----
export function parseCresol(rows: unknown[][], accountId: string | null = null): ParseResult<CashflowTxRow> {
  // detecta header por nomes
  let headerIdx = -1;
  const COL = { date: -1, desc: -1, detail: -1, value: -1, doc: -1, balance: -1 };
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    if (!r) continue;
    const cells = r.map((c) => String(c ?? '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const hasData = cells.some((c) => c === 'data' || c.startsWith('data'));
    const hasValor = cells.some((c) => c.includes('valor'));
    const hasHist = cells.some((c) => c.includes('histor') || c.includes('descri'));
    if (hasData && hasValor && hasHist) {
      headerIdx = i;
      cells.forEach((c, idx) => {
        if (COL.date < 0 && (c === 'data' || c.startsWith('data'))) COL.date = idx;
        else if (COL.desc < 0 && (c.includes('histor') || c.includes('descri'))) COL.desc = idx;
        else if (COL.detail < 0 && (c.includes('detalh') || c.includes('observ') || c.includes('complement'))) COL.detail = idx;
        else if (COL.value < 0 && c.includes('valor')) COL.value = idx;
        else if (COL.doc < 0 && (c.includes('doc') || c.includes('nr.'))) COL.doc = idx;
        else if (COL.balance < 0 && c.includes('saldo')) COL.balance = idx;
      });
      break;
    }
  }
  if (headerIdx < 0) return { rows: [], skipped: rows.length };

  // Procura "saldo em conta" no cabeçalho (antes da tabela)
  let closingBalance: number | null = null;
  for (let i = 0; i < headerIdx; i++) {
    const r = rows[i];
    if (!r) continue;
    for (let j = 0; j < r.length; j++) {
      const cell = String(r[j] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (cell.includes('saldo em conta')) {
        // valor pode estar na próxima célula ou em qualquer cell seguinte com número
        for (let k = j + 1; k < r.length; k++) {
          const v = r[k];
          if (v == null || v === '') continue;
          const s = String(v).trim();
          if (!/[\d]/.test(s)) continue;
          const neg = /^-/.test(s) || /^-?\s*R\$/.test(s) && /-/.test(s);
          const n = parseNumber(s.replace(/^-/, ''));
          if (isFinite(n) && n !== 0) {
            closingBalance = neg ? -n : n;
          } else if (isFinite(n)) {
            closingBalance = 0;
          }
          break;
        }
        break;
      }
    }
    if (closingBalance != null) break;
  }

  const out: CashflowTxRow[] = [];
  let skipped = 0;
  let maxDate: string | null = null;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c != null && c !== '')) { skipped++; continue; }
    const firstCell = String(r[0] ?? '').toLowerCase();
    if (/consulta posicao|periodo de/i.test(firstCell)) { skipped++; continue; }
    const dt = parseDateBR(r[COL.date]);
    if (!dt) { skipped++; continue; }
    const desc = String(r[COL.desc] ?? '').trim();
    const detail = COL.detail >= 0 ? String(r[COL.detail] ?? '').trim() : '';
    const amount = parseNumber(r[COL.value]);
    if (amount === 0) { skipped++; continue; }
    const docNumber = COL.doc >= 0 ? String(r[COL.doc] ?? '').trim() : '';
    const it = detectInternalTransfer(desc, detail);
    if (!maxDate || dt > maxDate) maxDate = dt;
    out.push({
      source: 'cresol',
      account_id: accountId,
      tx_date: dt,
      description: desc || null,
      detail: detail || null,
      amount,
      running_balance: null,
      category: /ifood/i.test(`${desc} ${detail}`) ? 'ifood' : null,
      is_internal_transfer: it.is_internal_transfer,
      counterparty: it.counterparty,
      doc_number: docNumber || null,
      source_seq: i,
    });
  }
  return { rows: out, skipped, closing: { balance: closingBalance, as_of: maxDate } };
}

// ---- C6 ----
export type ParseC6Result = ParseResult<CashflowTxRow> & { account_number: string | null };

export function parseC6(rows: unknown[][], accountId: string | null = null): ParseC6Result {
  // extrai conta antes do header
  let accountNumber: string | null = null;
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    if (!r) continue;
    const joined = r.map((c) => String(c ?? '')).join(' ');
    const m = joined.match(/Ag[eê]ncia:\s*(\d+)\s*\/\s*Conta:\s*([\d-]+)/i);
    if (m && !accountNumber) accountNumber = m[2];
    if (String(r[0] ?? '').trim() === 'Data Lançamento') { headerIdx = i; break; }
  }
  if (headerIdx < 0) return { rows: [], skipped: rows.length, account_number: accountNumber };

  const out: CashflowTxRow[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c != null && c !== '')) { skipped++; continue; }
    const dt = parseDateBR(r[0]);
    if (!dt) { skipped++; continue; }
    const desc = String(r[2] ?? '').trim();
    const detail = String(r[3] ?? '').trim();
    const entrada = parseNumber(r[4]);
    const saida = parseNumber(r[5]);
    const amount = entrada - saida;
    if (amount === 0) { skipped++; continue; }
    const saldo = r[6] != null && r[6] !== '' ? parseNumber(r[6]) : null;
    const it = detectInternalTransfer(desc, detail);
    out.push({
      source: 'c6',
      account_id: accountId,
      tx_date: dt,
      description: desc || null,
      detail: detail || null,
      amount,
      running_balance: saldo,
      category: null,
      is_internal_transfer: it.is_internal_transfer,
      counterparty: it.counterparty,
      doc_number: null,
      source_seq: i,
    });
  }
  const last = out[out.length - 1];
  const closing: ClosingInfo = {
    balance: last?.running_balance ?? null,
    as_of: last?.tx_date ?? null,
  };
  return { rows: out, skipped, account_number: accountNumber, closing };
}

// ---- Sicredi ----
export function parseSicredi(rows: unknown[][], accountId: string | null = null): ParseResult<CashflowTxRow> {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    if (!r) continue;
    const c0 = String(r[0] ?? '').trim();
    const c3 = String(r[3] ?? '').toLowerCase();
    const c4 = String(r[4] ?? '').toLowerCase();
    if (c0 === 'Data' && c3.includes('valor') && c4.includes('saldo')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return { rows: [], skipped: rows.length };

  const out: CashflowTxRow[] = [];
  let skipped = 0;
  let start = headerIdx + 1;
  if (rows[start] && String(rows[start][1] ?? '').trim() === 'Saldo Anterior') start++;

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c != null && c !== '')) { skipped++; continue; }
    const c1 = String(r[1] ?? '').trim();
    if (/^Saldo da Conta em/i.test(c1)) break;
    const dt = parseDateBR(r[0]);
    if (!dt) { skipped++; continue; }
    const desc = c1;
    let detail = String(r[2] ?? '').trim();
    if (detail === '  ') detail = '';
    const amount = parseNumber(r[3]);
    if (amount === 0) { skipped++; continue; }
    const saldo = r[4] != null && r[4] !== '' ? parseNumber(r[4]) : null;
    const it = detectInternalTransfer(desc, detail);
    const isInternal = it.is_internal_transfer || /PIZZARIA ESTRELA/i.test(`${desc} ${detail}`);
    out.push({
      source: 'sicredi',
      account_id: accountId,
      tx_date: dt,
      description: desc || null,
      detail: detail || null,
      amount,
      running_balance: saldo,
      category: null,
      is_internal_transfer: isInternal,
      counterparty: it.counterparty,
      doc_number: null,
      source_seq: i,
    });
  }
  const last = out[out.length - 1];
  return {
    rows: out,
    skipped,
    closing: { balance: last?.running_balance ?? null, as_of: last?.tx_date ?? null },
  };
}



// ---- iFood Conta (CSV ou rows) ----
export function parseIfoodConta(
  input: string | unknown[][],
  accountId: string | null = null,
): ParseResult<CashflowTxRow> {
  let rows: unknown[][];
  if (typeof input === 'string') {
    const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
    // detecta separador
    const sep = lines[0] && lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
    rows = lines.map((l) => parseCsvLine(l, sep));
  } else {
    rows = input;
  }
  if (rows.length === 0) return { rows: [], skipped: 0 };

  // pular header se primeiro campo não for data
  const start = parseDateBR(rows[0][0]) ? 0 : 1;
  const out: CashflowTxRow[] = [];
  let skipped = 0;

  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) { skipped++; continue; }
    const dt = parseDateBR(r[0]);
    if (!dt) { skipped++; continue; }
    const desc = String(r[1] ?? '').trim();
    const raw = Math.abs(parseNumber(r[2]));
    const cat = String(r[3] ?? '').trim();
    if (raw === 0) { skipped++; continue; }
    const isOut = /enviad|taxa/i.test(desc);
    const amount = isOut ? -raw : raw;
    const isInternalTransfer = /pix\s*enviad/i.test(desc);
    out.push({
      source: 'ifood',
      account_id: accountId,
      tx_date: dt,
      description: desc || null,
      detail: cat || null,
      amount,
      running_balance: null,
      category: cat || null,
      is_internal_transfer: isInternalTransfer,
      counterparty: isInternalTransfer ? 'IFOOD (varredura)' : null,
      doc_number: null,
      source_seq: i,
    });
  }
  return { rows: out, skipped };
}

// ---- Saipos ----
export function parseSaipos(rows: unknown[][]): ParseResult<CashflowSaiposRow> {
  if (rows.length < 2) return { rows: [], skipped: 0 };
  const out: CashflowSaiposRow[] = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => c != null && c !== '')) { skipped++; continue; }
    const vencimento = parseDateBR(r[0]);
    const emissao = parseDateBR(r[1]);
    const pagamento = parseDateBR(r[2]);
    const payment_method = String(r[4] ?? '').trim();
    const category = String(r[5] ?? '').trim();
    const amount = parseNumber(r[6]);
    const paid = String(r[7] ?? '').trim().toLowerCase() === 'sim';
    const fornecedor = String(r[8] ?? '').trim();
    const descricao = String(r[9] ?? '').trim();
    if (!vencimento && !emissao && !pagamento && amount === 0) { skipped++; continue; }

    const company: 'estrela' | 'proposito' = /c6/i.test(payment_method) ? 'proposito' : 'estrela';

    out.push({
      source: 'saipos',
      company,
      vencimento,
      emissao,
      pagamento,
      amount,
      payment_method: payment_method || null,
      category: category || null,
      fornecedor: fornecedor || null,
      descricao: descricao || null,
      paid,
      is_frente_caixa: category === 'Frente de Caixa',
      source_seq: i,
    });
  }
  return { rows: out, skipped };
}
