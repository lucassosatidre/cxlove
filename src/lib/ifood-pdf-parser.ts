// Parser do extrato PDF da Conta Digital iFood.
// Extrai texto com pdfjs-dist e faz parse por regex de linha.
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { CashflowTxRow, ParseResult } from './cashflow-parsers';
import { parseDateBR, parseNumber } from './cashflow-parsers';

(pdfjsLib.GlobalWorkerOptions as unknown as { workerSrc: string }).workerSrc = workerSrc;

const Y_TOLERANCE = 4;

async function extractLines(buf: ArrayBuffer): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number };
    const items: Item[] = (content.items as unknown as Array<{ str: string; transform: number[] }>)
      .filter((it) => typeof it.str === 'string' && it.str.length > 0)
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    items.sort((a, b) => b.y - a.y);
    const buckets: Item[][] = [];
    for (const it of items) {
      const last = buckets[buckets.length - 1];
      if (last && Math.abs(last[0].y - it.y) <= Y_TOLERANCE) last.push(it);
      else buckets.push([it]);
    }
    for (const b of buckets) {
      b.sort((a, b) => a.x - b.x);
      const line = b.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (line) allLines.push(line);
    }
  }
  return allLines;
}

const RE_SALDO_FINAL = /Saldo dispon[íi]vel no final do per[íi]odo selecionado:\s*R\$\s*([\d.,]+)/i;
const RE_TX = /^(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+(.+?)\s+(-?)R\$\s*([\d.,]+)$/;
const RE_SALDO_DIA = /^Saldo do dia\s+\d{2}\/\d{2}\/\d{4}/i;

export async function parseIfoodPdf(
  buf: ArrayBuffer,
  accountId: string | null = null,
): Promise<ParseResult<CashflowTxRow>> {
  const lines = await extractLines(buf);

  let closingBalance: number | null = null;
  for (const l of lines) {
    const m = l.match(RE_SALDO_FINAL);
    if (m) { closingBalance = parseNumber(m[1]); break; }
  }

  const out: CashflowTxRow[] = [];
  let skipped = 0;
  let seq = 0;

  for (const l of lines) {
    if (RE_SALDO_DIA.test(l)) continue;
    const m = l.match(RE_TX);
    if (!m) { skipped++; continue; }
    const dt = parseDateBR(m[1]);
    if (!dt) { skipped++; continue; }
    const cat = m[2].trim();
    const desc = m[3].trim();
    const sign = m[4] === '-' ? -1 : 1;
    const raw = parseNumber(m[5]);
    if (!raw) { skipped++; continue; }
    const amount = sign * raw;
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
      source_seq: seq++,
    });
  }

  // Cadeia regressiva de running_balance a partir do saldo final.
  // PDF lista tx em ordem cronológica DESC — preservamos a ordem original.
  let maxDate: string | null = null;
  if (closingBalance != null && out.length > 0) {
    const indexed = out.map((row, idx) => ({ row, idx }));
    indexed.sort((a, b) => {
      if (a.row.tx_date === b.row.tx_date) return a.idx - b.idx;
      return a.row.tx_date < b.row.tx_date ? 1 : -1;
    });
    let running = closingBalance;
    for (let i = 0; i < indexed.length; i++) {
      indexed[i].row.running_balance = Math.round(running * 100) / 100;
      running = running - indexed[i].row.amount;
    }
    maxDate = indexed[0].row.tx_date;
  } else if (out.length > 0) {
    maxDate = out.reduce((m, r) => (r.tx_date > m ? r.tx_date : m), out[0].tx_date);
  }

  return { rows: out, skipped, closing: { balance: closingBalance, as_of: maxDate } };
}
