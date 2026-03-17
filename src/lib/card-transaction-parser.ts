import * as XLSX from 'xlsx';

export interface ParsedCardTransaction {
  sale_date: string; // YYYY-MM-DD
  sale_time: string; // HH:MM:SS
  payment_method: string;
  brand: string;
  gross_amount: number;
  net_amount: number;
  machine_serial: string;
  transaction_id: string;
}

// Serials to EXCLUDE (store/iFood machines, not delivery drivers)
const EXCLUDED_SERIALS = new Set([
  'S1F2-000158242609442',
  'S1F2-000158242610215',
  'S1F2-000158242606048',
  'S1F2-000158242610382',
  'S1F2-000158242609592',
  'S1F2-000158242609478',
  'S1F2-000158242608860',
  'S1F2-000158242606379',
  'S1F2-000158242610579',
  'S1F2-000158242610139',
  'S1F2-000158242609530',
  'S1F2-000158242610541',
]);

function parseBRCurrency(value: unknown): number {
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

function parseDateStr(value: unknown): string {
  if (!value) return '';
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  return str;
}

export function parseCardTransactionFile(file: File): Promise<{ transactions: ParsedCardTransaction[]; excludedCount: number; totalCount: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Find the "Transações" sheet (Page 2) - usually the second sheet
        let sheet: XLSX.WorkSheet | null = null;
        for (const name of workbook.SheetNames) {
          if (name.toLowerCase().includes('transaç') || name.toLowerCase().includes('transac')) {
            sheet = workbook.Sheets[name];
            break;
          }
        }
        // Fallback: use second sheet if available, else first
        if (!sheet) {
          sheet = workbook.Sheets[workbook.SheetNames[1]] || workbook.Sheets[workbook.SheetNames[0]];
        }

        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

        // Find the header row containing "Data da venda"
        let headerRowIndex = -1;
        let colMap: Record<string, number> = {};

        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i] as string[];
          if (!row) continue;
          const found = row.findIndex(cell => String(cell || '').toLowerCase().includes('data da venda'));
          if (found >= 0) {
            headerRowIndex = i;
            row.forEach((cell, idx) => {
              const name = String(cell || '').trim().toLowerCase();
              if (name.includes('data da venda')) colMap['sale_date'] = idx;
              if (name.includes('hora da venda')) colMap['sale_time'] = idx;
              if (name.includes('metodo') || name.includes('método')) colMap['payment_method'] = idx;
              if (name.includes('bandeira')) colMap['brand'] = idx;
              if (name.includes('valor bruto')) colMap['gross_amount'] = idx;
              if (name.includes('valor liquido') || name.includes('valor líquido')) colMap['net_amount'] = idx;
              if (name.includes('serial')) colMap['machine_serial'] = idx;
              if (name.includes('id da transacao') || name.includes('id da transação')) colMap['transaction_id'] = idx;
            });
            break;
          }
        }

        // Fallback to positional if header not found
        if (headerRowIndex === -1) {
          headerRowIndex = 0;
          colMap = {
            sale_date: 0,
            sale_time: 1,
            payment_method: 3,
            brand: 4,
            gross_amount: 7,
            net_amount: 12,
            machine_serial: 14,
            transaction_id: 13,
          };
        }

        const transactions: ParsedCardTransaction[] = [];
        let excludedCount = 0;
        let totalCount = 0;

        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;

          const serial = String(row[colMap.machine_serial] ?? '').trim();
          const grossAmount = parseBRCurrency(row[colMap.gross_amount]);
          
          if (!serial || grossAmount === 0) continue;
          totalCount++;

          if (EXCLUDED_SERIALS.has(serial)) {
            excludedCount++;
            continue;
          }

          transactions.push({
            sale_date: parseDateStr(row[colMap.sale_date]),
            sale_time: String(row[colMap.sale_time] ?? '').trim(),
            payment_method: String(row[colMap.payment_method] ?? '').trim(),
            brand: String(row[colMap.brand] ?? '').trim(),
            gross_amount: grossAmount,
            net_amount: parseBRCurrency(row[colMap.net_amount]),
            machine_serial: serial,
            transaction_id: String(row[colMap.transaction_id] ?? '').trim(),
          });
        }

        if (transactions.length === 0) {
          reject(new Error('Nenhuma transação de entregador encontrada no arquivo (todas foram de máquinas excluídas ou o arquivo está vazio).'));
          return;
        }

        resolve({ transactions, excludedCount, totalCount });
      } catch (err) {
        reject(new Error('Erro ao ler o arquivo de transações. Verifique se o formato está correto.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
