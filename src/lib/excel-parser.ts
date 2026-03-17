import * as XLSX from 'xlsx';

export interface ParsedOrder {
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string;
}

const HEADER_NAMES: Record<string, string> = {
  'Pedido': 'order_number',
  'Pagamento': 'payment_method',
  'Entregador': 'delivery_person',
  'Total': 'total_amount',
};

// Fallback column indices (0-based): A=0, L=11, R=17, Y=24
const FALLBACK_INDICES: Record<number, string> = {
  0: 'order_number',
  11: 'payment_method',
  17: 'delivery_person',
  24: 'total_amount',
};

function parseCurrency(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/R\$\s?/, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

export function parseExcelFile(file: File): Promise<ParsedOrder[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown[][];

        if (jsonData.length < 2) {
          reject(new Error('Arquivo vazio ou sem dados suficientes.'));
          return;
        }

        const headerRow = jsonData[0] as string[];
        const columnMap: Record<string, number> = {};

        // Try to find columns by header name
        headerRow.forEach((cell, index) => {
          const cellStr = String(cell || '').trim();
          if (HEADER_NAMES[cellStr]) {
            columnMap[HEADER_NAMES[cellStr]] = index;
          }
        });

        // Fallback to column indices for missing columns
        const requiredFields = ['order_number', 'payment_method', 'delivery_person', 'total_amount'];
        for (const field of requiredFields) {
          if (columnMap[field] === undefined) {
            const fallbackEntry = Object.entries(FALLBACK_INDICES).find(([, f]) => f === field);
            if (fallbackEntry) {
              const idx = parseInt(fallbackEntry[0]);
              if (idx < headerRow.length) {
                columnMap[field] = idx;
              }
            }
          }
        }

        // Validate all required columns exist
        const missingFields = requiredFields.filter(f => columnMap[f] === undefined);
        if (missingFields.length > 0) {
          const names = missingFields.map(f => {
            const entry = Object.entries(HEADER_NAMES).find(([, v]) => v === f);
            return entry ? entry[0] : f;
          });
          reject(new Error(`Coluna(s) não encontrada(s) no relatório: ${names.join(', ')}`));
          return;
        }

        const orders: ParsedOrder[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;

          const orderNumber = String(row[columnMap.order_number] ?? '').trim();
          if (!orderNumber) continue;

          orders.push({
            order_number: orderNumber,
            payment_method: String(row[columnMap.payment_method] ?? '').trim(),
            total_amount: parseCurrency(row[columnMap.total_amount]),
            delivery_person: String(row[columnMap.delivery_person] ?? '').trim(),
          });
        }

        if (orders.length === 0) {
          reject(new Error('Nenhum pedido encontrado no arquivo.'));
          return;
        }

        resolve(orders);
      } catch (err) {
        reject(new Error('Erro ao ler o arquivo Excel. Verifique se o formato está correto.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
