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

// Fixed machine serials - EXCLUDED from delivery, INCLUDED for salon
export const FIXED_MACHINE_SERIALS = new Set([
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

const EXCLUDED_SERIALS = FIXED_MACHINE_SERIALS;

function parseBRCurrency(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    let cleaned = value.replace(/R\$\s?/g, '').trim();
    // Detect format: if has both . and , → determine which is decimal
    const hasDot = cleaned.includes('.');
    const hasComma = cleaned.includes(',');
    if (hasDot && hasComma) {
      // Whichever comes last is the decimal separator
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        // 1.234,56 → BR format
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // 1,234.56 → US format
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (hasComma) {
      cleaned = cleaned.replace(',', '.');
    }
    // If only dots, leave as-is (could be 111.59 decimal)
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

        console.log('[CardParser] Sheet names:', workbook.SheetNames);

        // Find the "Transações" sheet (Page 2) - usually the second sheet
        let sheet: XLSX.WorkSheet | null = null;
        let sheetName = '';
        for (const name of workbook.SheetNames) {
          const norm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          // Prefer exact "transacoes" sheet, skip "resumo das transacoes"
          if (norm === 'transacoes') {
            sheet = workbook.Sheets[name];
            sheetName = name;
            break;
          }
        }
        // Second pass: any sheet containing "transac" but NOT "resumo"
        if (!sheet) {
          for (const name of workbook.SheetNames) {
            const norm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (norm.includes('transac') && !norm.includes('resumo')) {
              sheet = workbook.Sheets[name];
              sheetName = name;
              break;
            }
          }
        }
        // Fallback: use second sheet if available, else first
        if (!sheet) {
          sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
          sheet = workbook.Sheets[sheetName];
        }

        console.log('[CardParser] Using sheet:', sheetName);

        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

        console.log('[CardParser] Total rows:', jsonData.length);
        if (jsonData.length > 0) console.log('[CardParser] First row:', JSON.stringify(jsonData[0]));
        if (jsonData.length > 1) console.log('[CardParser] Second row:', JSON.stringify(jsonData[1]));

        // Normalize helper to strip accents
        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        // Find the header row containing "Data da venda" - search up to 20 rows
        let headerRowIndex = -1;
        let colMap: Record<string, number> = {};

        for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
          const row = jsonData[i] as string[];
          if (!row) continue;
          const found = row.findIndex(cell => norm(String(cell || '')).includes('data da venda'));
          if (found >= 0) {
            headerRowIndex = i;
            row.forEach((cell, idx) => {
              const name = norm(String(cell || ''));
              if (name.includes('data da venda')) colMap['sale_date'] = idx;
              if (name.includes('hora da venda')) colMap['sale_time'] = idx;
              if (name.includes('metodo')) colMap['payment_method'] = idx;
              if (name.includes('bandeira')) colMap['brand'] = idx;
              if (name.includes('valor bruto')) colMap['gross_amount'] = idx;
              if (name.includes('valor liquido')) colMap['net_amount'] = idx;
              if (name.includes('serial')) colMap['machine_serial'] = idx;
              if (name.includes('id da transacao')) colMap['transaction_id'] = idx;
            });
            break;
          }
        }

        console.log('[CardParser] Header row index:', headerRowIndex, 'colMap:', JSON.stringify(colMap));

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
          console.log('[CardParser] Using fallback positional colMap');
        }

        const transactions: ParsedCardTransaction[] = [];
        let excludedCount = 0;
        let totalCount = 0;
        let skippedNoSerial = 0;
        let skippedZeroAmount = 0;

        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;

          const serial = String(row[colMap.machine_serial] ?? '').trim();
          const grossAmount = parseBRCurrency(row[colMap.gross_amount]);
          
          if (!serial) { skippedNoSerial++; continue; }
          if (grossAmount === 0) { skippedZeroAmount++; continue; }
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

        console.log(`[CardParser] Results: total=${totalCount}, excluded=${excludedCount}, kept=${transactions.length}, skippedNoSerial=${skippedNoSerial}, skippedZeroAmount=${skippedZeroAmount}`);
        if (transactions.length > 0) console.log('[CardParser] First transaction:', JSON.stringify(transactions[0]));

        if (transactions.length === 0) {
          reject(new Error(`Nenhuma transação de entregador encontrada. Total: ${totalCount}, Excluídas: ${excludedCount}, Sem serial: ${skippedNoSerial}, Valor zero: ${skippedZeroAmount}.`));
          return;
        }

        resolve({ transactions, excludedCount, totalCount });
      } catch (err) {
        console.error('[CardParser] Error:', err);
        reject(new Error('Erro ao ler o arquivo de transações. Verifique se o formato está correto.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Salon-specific parser: ONLY includes transactions from fixed machines (inverse of delivery).
 */
export function parseSalonCardTransactionFile(file: File): Promise<{ transactions: ParsedCardTransaction[]; excludedCount: number; totalCount: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        let sheet: XLSX.WorkSheet | null = null;
        let sheetName = '';
        for (const name of workbook.SheetNames) {
          if (norm(name) === 'transacoes') { sheet = workbook.Sheets[name]; sheetName = name; break; }
        }
        if (!sheet) {
          for (const name of workbook.SheetNames) {
            if (norm(name).includes('transac') && !norm(name).includes('resumo')) { sheet = workbook.Sheets[name]; sheetName = name; break; }
          }
        }
        if (!sheet) { sheetName = workbook.SheetNames[1] || workbook.SheetNames[0]; sheet = workbook.Sheets[sheetName]; }

        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        let headerRowIndex = -1;
        let colMap: Record<string, number> = {};

        for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
          const row = jsonData[i] as string[];
          if (!row) continue;
          if (row.findIndex(cell => norm(String(cell || '')).includes('data da venda')) >= 0) {
            headerRowIndex = i;
            row.forEach((cell, idx) => {
              const n = norm(String(cell || ''));
              if (n.includes('data da venda')) colMap['sale_date'] = idx;
              if (n.includes('hora da venda')) colMap['sale_time'] = idx;
              if (n.includes('metodo')) colMap['payment_method'] = idx;
              if (n.includes('bandeira')) colMap['brand'] = idx;
              if (n.includes('valor bruto')) colMap['gross_amount'] = idx;
              if (n.includes('valor liquido')) colMap['net_amount'] = idx;
              if (n.includes('serial')) colMap['machine_serial'] = idx;
              if (n.includes('id da transacao')) colMap['transaction_id'] = idx;
            });
            break;
          }
        }
        if (headerRowIndex === -1) {
          headerRowIndex = 0;
          colMap = { sale_date: 0, sale_time: 1, payment_method: 3, brand: 4, gross_amount: 7, net_amount: 12, machine_serial: 14, transaction_id: 13 };
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

          if (!FIXED_MACHINE_SERIALS.has(serial)) { excludedCount++; continue; }

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
          reject(new Error(`Nenhuma transação de maquininha fixa encontrada. Total: ${totalCount}, Excluídas (não-fixas): ${excludedCount}.`));
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

/**
 * Unified parser: parses ALL transactions and splits them into delivery (non-fixed) and salon (fixed).
 */
export function parseAllCardTransactions(file: File): Promise<{
  delivery: ParsedCardTransaction[];
  salon: ParsedCardTransaction[];
  totalCount: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const normStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        let sheet: XLSX.WorkSheet | null = null;
        for (const name of workbook.SheetNames) {
          if (normStr(name) === 'transacoes') { sheet = workbook.Sheets[name]; break; }
        }
        if (!sheet) {
          for (const name of workbook.SheetNames) {
            if (normStr(name).includes('transac') && !normStr(name).includes('resumo')) { sheet = workbook.Sheets[name]; break; }
          }
        }
        if (!sheet) { sheet = workbook.Sheets[workbook.SheetNames[1] || workbook.SheetNames[0]]; }

        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        let headerRowIndex = -1;
        let colMap: Record<string, number> = {};

        for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
          const row = jsonData[i] as string[];
          if (!row) continue;
          if (row.findIndex(cell => normStr(String(cell || '')).includes('data da venda')) >= 0) {
            headerRowIndex = i;
            row.forEach((cell, idx) => {
              const n = normStr(String(cell || ''));
              if (n.includes('data da venda')) colMap['sale_date'] = idx;
              if (n.includes('hora da venda')) colMap['sale_time'] = idx;
              if (n.includes('metodo')) colMap['payment_method'] = idx;
              if (n.includes('bandeira')) colMap['brand'] = idx;
              if (n.includes('valor bruto')) colMap['gross_amount'] = idx;
              if (n.includes('valor liquido')) colMap['net_amount'] = idx;
              if (n.includes('serial')) colMap['machine_serial'] = idx;
              if (n.includes('id da transacao')) colMap['transaction_id'] = idx;
            });
            break;
          }
        }
        if (headerRowIndex === -1) {
          headerRowIndex = 0;
          colMap = { sale_date: 0, sale_time: 1, payment_method: 3, brand: 4, gross_amount: 7, net_amount: 12, machine_serial: 14, transaction_id: 13 };
        }

        const delivery: ParsedCardTransaction[] = [];
        const salon: ParsedCardTransaction[] = [];
        let totalCount = 0;

        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;
          const serial = String(row[colMap.machine_serial] ?? '').trim();
          const grossAmount = parseBRCurrency(row[colMap.gross_amount]);
          if (!serial || grossAmount === 0) continue;
          totalCount++;

          const tx: ParsedCardTransaction = {
            sale_date: parseDateStr(row[colMap.sale_date]),
            sale_time: String(row[colMap.sale_time] ?? '').trim(),
            payment_method: String(row[colMap.payment_method] ?? '').trim(),
            brand: String(row[colMap.brand] ?? '').trim(),
            gross_amount: grossAmount,
            net_amount: parseBRCurrency(row[colMap.net_amount]),
            machine_serial: serial,
            transaction_id: String(row[colMap.transaction_id] ?? '').trim(),
          };

          if (FIXED_MACHINE_SERIALS.has(serial)) {
            salon.push(tx);
          } else {
            delivery.push(tx);
          }
        }

        if (totalCount === 0) {
          reject(new Error('Nenhuma transação encontrada no arquivo.'));
          return;
        }

        resolve({ delivery, salon, totalCount });
      } catch {
        reject(new Error('Erro ao ler o arquivo de transações.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}
