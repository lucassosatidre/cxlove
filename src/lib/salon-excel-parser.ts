import * as XLSX from 'xlsx';

export interface ParsedSalonOrder {
  order_type: string;
  sale_date: string;
  sale_time: string;
  payment_method: string;
  total_amount: number;
}

export interface SalonParseResult {
  orders: ParsedSalonOrder[];
  skippedCancelled: number;
}

function parseCurrency(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function parseDateTime(value: unknown): { date: string; time: string } {
  if (!value) return { date: '', time: '' };

  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      const date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      const time = `${String(d.H || 0).padStart(2, '0')}:${String(d.M || 0).padStart(2, '0')}`;
      return { date, time };
    }
  }

  if (typeof value === 'string') {
    const str = value.trim();
    const brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})?/);
    if (brMatch) {
      const date = `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
      const time = brMatch[4] ? `${brMatch[4].padStart(2, '0')}:${brMatch[5] || '00'}` : '';
      return { date, time };
    }
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
      return {
        date: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`,
        time: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '',
      };
    }
  }

  return { date: '', time: '' };
}

// Column indices (0-based): A=0, I=8, L=11, M=12, Y=24
const COL_ORDER_TYPE = 0;    // A
const COL_DATETIME = 8;      // I
const COL_PAYMENT = 11;      // L
const COL_CANCELLED = 12;    // M
const COL_TOTAL = 24;        // Y

export function parseSalonExcelFile(file: File): Promise<SalonParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

        if (jsonData.length < 2) {
          reject(new Error('Arquivo vazio ou sem dados suficientes.'));
          return;
        }

        const orders: ParsedSalonOrder[] = [];
        let skippedCancelled = 0;

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;

          // Skip cancelled orders (column M = 'S')
          const cancelledFlag = String(row[COL_CANCELLED] ?? '').trim().toUpperCase();
          if (cancelledFlag === 'S') {
            skippedCancelled++;
            continue;
          }

          const orderType = String(row[COL_ORDER_TYPE] ?? '').trim();
          if (!orderType) continue;

          const { date, time } = parseDateTime(row[COL_DATETIME]);
          const paymentMethod = String(row[COL_PAYMENT] ?? '').trim();
          const totalAmount = parseCurrency(row[COL_TOTAL]);

          orders.push({
            order_type: orderType,
            sale_date: date,
            sale_time: time,
            payment_method: paymentMethod,
            total_amount: totalAmount,
          });
        }

        if (orders.length === 0 && skippedCancelled === 0) {
          reject(new Error('Nenhum pedido encontrado no arquivo.'));
          return;
        }

        resolve({ orders, skippedCancelled });
      } catch {
        reject(new Error('Erro ao ler o arquivo Excel. Verifique se o formato está correto.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
