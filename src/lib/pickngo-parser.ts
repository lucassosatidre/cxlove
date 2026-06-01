/**
 * Parser do relatório do PickNGo (relatorioGeral.csv).
 *
 * Formato observado: CSV latin-1 (ISO-8859-1), com 1ª linha técnica "sep=;",
 * delimitador ponto-e-vírgula, cabeçalho na 2ª linha. Cada linha é um pedido.
 *
 * O número do pedido do Saipos é IGUAL ao "Código" do PickNGo (validado 31/05/2026,
 * 170/170), então o casamento com o cx love é feito por order_number.
 */

import { normalizeName } from './driver-name-match';

export interface ParsedPickNGoRow {
  order_number: string;     // "Código" — bate com imported_orders.order_number
  delivery_person: string;  // "Entregador" — vazio = Frota Garantida (iFood)
  customer_name: string;    // "Nome do cliente" (referência)
  sale_date: string;        // YYYY-MM-DD (de "Data de cadastro")
  payment_method: string;   // "Forma de pagamento"
}

export interface ParsePickNGoResult {
  rows: ParsedPickNGoRow[];
  totalRows: number;
  skippedCancelled: number;
}

// Cabeçalhos do PickNGo -> campo interno (comparados normalizados)
const HEADER_MAP: Record<string, keyof ParsedPickNGoRow | 'situacao'> = {
  'codigo': 'order_number',
  'entregador': 'delivery_person',
  'nome do cliente': 'customer_name',
  'data de cadastro': 'sale_date',
  'forma de pagamento': 'payment_method',
  'situacao': 'situacao',
};

/** Divide uma linha CSV respeitando aspas duplas. */
function parseCsvLine(line: string, delim = ';'): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** "31/05/2026 19:41:47" -> "2026-05-31" */
function parsePickNGoDate(value: string): string {
  const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

export function parsePickNGoFile(file: File): Promise<ParsePickNGoResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const text = new TextDecoder('iso-8859-1').decode(new Uint8Array(buffer));
        const allLines = text.split(/\r?\n/).filter(l => l.length > 0);

        if (allLines.length < 2) {
          reject(new Error('Arquivo vazio ou sem dados suficientes.'));
          return;
        }

        // Pula a 1ª linha "sep=;" se existir
        let headerIdx = 0;
        if (/^sep=/i.test(allLines[0].trim())) headerIdx = 1;

        const header = parseCsvLine(allLines[headerIdx]).map(h => normalizeName(h));
        const col: Partial<Record<keyof ParsedPickNGoRow | 'situacao', number>> = {};
        header.forEach((h, idx) => {
          const field = HEADER_MAP[h];
          if (field && col[field] === undefined) col[field] = idx;
        });

        if (col.order_number === undefined || col.delivery_person === undefined) {
          reject(new Error('Não encontrei as colunas "Código" e "Entregador" no arquivo do PickNGo.'));
          return;
        }

        const rows: ParsedPickNGoRow[] = [];
        let skippedCancelled = 0;

        for (let i = headerIdx + 1; i < allLines.length; i++) {
          const cells = parseCsvLine(allLines[i]);
          const get = (field: keyof ParsedPickNGoRow | 'situacao') => {
            const ix = col[field];
            return ix !== undefined && ix < cells.length ? String(cells[ix] ?? '').trim() : '';
          };

          const orderNumber = get('order_number');
          if (!orderNumber || !/^\d+$/.test(orderNumber)) continue;

          const situacao = normalizeName(get('situacao'));
          if (situacao.includes('cancel')) {
            skippedCancelled++;
            continue;
          }

          rows.push({
            order_number: orderNumber,
            delivery_person: get('delivery_person'),
            customer_name: get('customer_name'),
            sale_date: parsePickNGoDate(get('sale_date')),
            payment_method: get('payment_method'),
          });
        }

        if (rows.length === 0) {
          reject(new Error('Nenhum pedido válido encontrado no arquivo do PickNGo.'));
          return;
        }

        resolve({ rows, totalRows: rows.length, skippedCancelled });
      } catch (err) {
        reject(new Error('Erro ao ler o arquivo do PickNGo. Verifique se é o relatório certo (.csv).'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
