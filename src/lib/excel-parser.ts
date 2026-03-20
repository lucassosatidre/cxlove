import * as XLSX from 'xlsx';

export interface ParsedOrder {
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string;
  sale_date: string; // YYYY-MM-DD
  sale_time: string; // HH:MM
  sales_channel: string;
  partner_order_number: string;
}

const HEADER_NAMES: Record<string, string> = {
  'Pedido': 'order_number',
  'Pagamento': 'payment_method',
  'Entregador': 'delivery_person',
  'Total': 'total_amount',
};

// Column I = index 8 for sale date/time
const SALE_DATE_HEADER_NAMES = ['Data', 'Data Venda', 'Data da Venda'];

// Column F = index 5 for sales channel
const SALES_CHANNEL_HEADER_NAMES = ['Canal', 'Canal de Venda', 'Canal de venda'];
const SALES_CHANNEL_FALLBACK_INDEX = 5;

// Column H = index 7 for partner order number
const PARTNER_ORDER_HEADER_NAMES = ['Pedido Parceiro', 'Nº Parceiro', 'Número do pedido no parceiro', 'Pedido parceiro'];
const PARTNER_ORDER_FALLBACK_INDEX = 7;

// Fallback column indices (0-based): A=0, I=8, L=11, R=17, Y=24
const FALLBACK_INDICES: Record<number, string> = {
  0: 'order_number',
  11: 'payment_method',
  17: 'delivery_person',
  24: 'total_amount',
};

const SALE_DATE_FALLBACK_INDEX = 8; // Column I

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

function parseDate(value: unknown): string {
  if (!value) return '';
  
  // Excel serial date number
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, '0');
      const d = String(date.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  
  if (typeof value === 'string') {
    const str = value.trim();
    // Try DD/MM/YYYY HH:MM or DD/MM/YYYY
    const brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (brMatch) {
      return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
    }
    // Try YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
  }
  
  return '';
}

function parseTime(value: unknown): string {
  if (!value) return '';
  
  // Excel serial date number with time component
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const h = String(date.H || 0).padStart(2, '0');
      const min = String(date.M || 0).padStart(2, '0');
      return `${h}:${min}`;
    }
  }
  
  if (typeof value === 'string') {
    const str = value.trim();
    // Try to extract HH:MM from string like "15/07/2025 14:30" or just "14:30"
    const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }
  }
  
  return '';
}

export function parseExcelFile(file: File): Promise<ParsedOrder[]> {
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

        const headerRow = jsonData[0] as string[];
        const columnMap: Record<string, number> = {};
        let saleDateIndex: number | undefined;
        let salesChannelIndex: number | undefined;
        let partnerOrderIndex: number | undefined;

        // Try to find columns by header name
        headerRow.forEach((cell, index) => {
          const cellStr = String(cell || '').trim();
          if (HEADER_NAMES[cellStr]) {
            columnMap[HEADER_NAMES[cellStr]] = index;
          }
          if (SALE_DATE_HEADER_NAMES.some(h => cellStr.toLowerCase() === h.toLowerCase())) {
            saleDateIndex = index;
          }
          if (SALES_CHANNEL_HEADER_NAMES.some(h => cellStr.toLowerCase() === h.toLowerCase())) {
            salesChannelIndex = index;
          }
          if (PARTNER_ORDER_HEADER_NAMES.some(h => cellStr.toLowerCase() === h.toLowerCase())) {
            partnerOrderIndex = index;
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

        // Fallback for optional columns
        if (saleDateIndex === undefined && SALE_DATE_FALLBACK_INDEX < headerRow.length) {
          saleDateIndex = SALE_DATE_FALLBACK_INDEX;
        }
        if (salesChannelIndex === undefined && SALES_CHANNEL_FALLBACK_INDEX < headerRow.length) {
          salesChannelIndex = SALES_CHANNEL_FALLBACK_INDEX;
        }
        if (partnerOrderIndex === undefined && PARTNER_ORDER_FALLBACK_INDEX < headerRow.length) {
          partnerOrderIndex = PARTNER_ORDER_FALLBACK_INDEX;
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
        let skippedCancelled = 0;
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;

          // Column M (index 12): skip row if value is "S"
          const colMValue = String(row[12] ?? '').trim().toUpperCase();
          if (colMValue === 'S') {
            skippedCancelled++;
            continue;
          }

          const orderNumber = String(row[columnMap.order_number] ?? '').trim();
          if (!orderNumber) continue;

          const saleDate = saleDateIndex !== undefined ? parseDate(row[saleDateIndex]) : '';
          const saleTime = saleDateIndex !== undefined ? parseTime(row[saleDateIndex]) : '';
          const salesChannel = salesChannelIndex !== undefined ? String(row[salesChannelIndex] ?? '').trim() : '';
          const partnerOrderNumber = partnerOrderIndex !== undefined ? String(row[partnerOrderIndex] ?? '').trim() : '';

          orders.push({
            order_number: orderNumber,
            payment_method: String(row[columnMap.payment_method] ?? '').trim(),
            total_amount: parseCurrency(row[columnMap.total_amount]),
            delivery_person: String(row[columnMap.delivery_person] ?? '').trim(),
            sale_date: saleDate,
            sale_time: saleTime,
            sales_channel: salesChannel,
            partner_order_number: partnerOrderNumber,
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
