import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  FileSpreadsheet, FileText, Landmark, Loader2, RefreshCw, UploadCloud, CreditCard, Store, ShoppingBag, UtensilsCrossed,
} from 'lucide-react';
import { extractPdfText } from '@/lib/pdf-text-extract';

export type AuditPeriodLite = { id: string; month: number; year: number; status: string };

// Alguns portais (ex: Ticket Edenred) exportam XLSX com o range declarado
// (!ref) MENOR que os dados reais — ex: declara A1:O37 num arquivo de 153
// linhas. O SheetJS confia no !ref e corta a leitura, então só uma fração do
// arquivo é lida (bug real: Ticket lia 4 de 18 lotes). Aqui recalculamos o
// !ref de cada aba varrendo as células reais ANTES de qualquer leitura.
function fixSheetRange(sheet: XLSX.WorkSheet) {
  const keys = Object.keys(sheet).filter((k) => !k.startsWith('!'));
  if (!keys.length) return;
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
  for (const k of keys) {
    const c = XLSX.utils.decode_cell(k);
    if (c.c < minC) minC = c.c;
    if (c.r < minR) minR = c.r;
    if (c.c > maxC) maxC = c.c;
    if (c.r > maxR) maxR = c.r;
  }
  sheet['!ref'] = XLSX.utils.encode_range({ s: { c: minC, r: minR }, e: { c: maxC, r: maxR } });
}

// Lê o workbook e corrige o !ref de TODAS as abas (ver fixSheetRange).
// Use SEMPRE no lugar de XLSX.read direto nos uploads de auditoria.
function readWorkbookFixed(buf: ArrayBuffer): XLSX.WorkBook {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  for (const name of wb.SheetNames) fixSheetRange(wb.Sheets[name]);
  return wb;
}

// Parse CSV line respeitando aspas duplas. Padrão CSV simples: vírgula como
// separador, aspas como delimitadores de string (com escape "" pra aspa interna).
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

export type UploadCardProps = {
  period: AuditPeriodLite | null;
  ensurePeriod: () => Promise<AuditPeriodLite | null>;
  onAfter: () => Promise<void> | void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Maquinona — XLSX, aba "Transações"
// ─────────────────────────────────────────────────────────────────────────────
export function UploadMaquinonaCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalImported = 0;
    let totalSkippedNoDate = 0;
    const failures: string[] = [];
    let lastSampleNoDate: any[] | null = null;

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          const norm = (s: string) =>
            s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
          const sheetName = wb.SheetNames.find(n => norm(n) === 'transacoes');
          if (!sheetName) throw new Error('Aba "Transações" não encontrada.');
          const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { defval: null, raw: false });

          // Aba "Resumo das transações" (Saipos abr/26+): header em row index 3.
          // sheet_to_json com header:1 + range:3 retorna arrays — primeiro = header.
          const summarySheetName = wb.SheetNames.find(n => norm(n) === 'resumo das transacoes');
          const summary_rows = summarySheetName
            ? XLSX.utils.sheet_to_json<any>(wb.Sheets[summarySheetName], { header: 1, range: 3, defval: null, raw: false })
            : [];

          const { data, error } = await supabase.functions.invoke('import-maquinona', {
            body: { audit_period_id: p.id, file_name: file.name, rows, summary_rows },
          });

          if (error) {
            // 400/failed: FunctionsHttpError vem com message genérica
            // ("non-2xx") — extrai a mensagem real do body (ex: competência
            // errada detectada pelo validador do mês).
            let detail = error.message ?? 'erro';
            try {
              const ctx = (error as any).context;
              if (ctx && typeof ctx.json === 'function') {
                const bj = await ctx.json();
                if (bj?.error) detail = bj.error;
              }
            } catch { /* noop */ }
            throw new Error(detail);
          }
          if ((data as any)?.error) throw new Error((data as any).error);
          if (data && (data as any).success === false) throw new Error((data as any).error || 'Falha na importação');
          const newRows = Number((data as any)?.imported_rows ?? 0);
          const updRows = Number((data as any)?.updated_rows ?? 0);
          // Defensivo: 0 novas E 0 atualizadas = nada entrou (reimport do
          // mesmo arquivo atualiza, então updated_rows > 0 é ok).
          if (newRows + updRows === 0) {
            throw new Error('0 transações importadas — arquivo não tem vendas no mês desta página. Confira o mês do arquivo.');
          }
          totalImported += newRows;
          const diag = (data as any)?.diagnostic;
          if (diag?.skipped_no_date) {
            totalSkippedNoDate += Number(diag.skipped_no_date);
            if (Array.isArray(diag.sample_no_date) && diag.sample_no_date.length > 0) {
              lastSampleNoDate = diag.sample_no_date;
            }
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        if (totalSkippedNoDate > 0) {
          const sampleStr = lastSampleNoDate
            ? lastSampleNoDate.map(s => `${s.type}:${JSON.stringify(s.raw)}`).join(' | ')
            : '';
          toast.warning(
            `${totalImported} importadas, ${totalSkippedNoDate} rejeitadas (sem Data da venda)`,
            { description: `Sample bruto: ${sampleStr}` },
          );
        } else {
          toast.success(`${totalImported} transações de ${xlsx.length} arquivo(s) Maquinona`);
        }
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <CreditCard className="h-5 w-5 text-emerald-600" />
        <CardTitle className="text-base">Maquinona iFood (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          XLSX exportado da Maquinona (aba "Transações") — vendas crédito/débito/PIX/voucher.
          <strong>1 arquivo</strong>: o mês cheio da competência (01 ao último dia). Arquivo de outro mês é recusado.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cresol — XLSX, primeira aba como matriz
// ─────────────────────────────────────────────────────────────────────────────
export function UploadCresolCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalImported = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });

          const { data, error } = await supabase.functions.invoke('import-cresol', {
            body: { audit_period_id: p.id, file_name: file.name, rows },
          });
          if (error) throw new Error(error.message);
          if ((data as any)?.error) throw new Error((data as any).error);
          if (data && (data as any).success === false) throw new Error((data as any).error || 'Falha na importação');
          totalImported += Number((data as any)?.imported_rows ?? 0);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalImported} créditos Cresol de ${xlsx.length} arquivo(s)`);
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <Landmark className="h-5 w-5 text-emerald-700" />
        <CardTitle className="text-base">Extrato Cresol (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          XLSX do banco Cresol — depósitos correspondentes às vendas iFood.
          Idealmente <strong>3 arquivos</strong> (mesma janela da Maquinona) pra cobrir defasagem.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BB — XLSX
// ─────────────────────────────────────────────────────────────────────────────
export function UploadBBCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [pullingOF, setPullingOF] = useState(false);

  const handlePullOF = async () => {
    setPullingOF(true);
    try {
      const p = await ensurePeriod();
      if (!p) return;
      const { data, error } = await supabase.functions.invoke('import-bb-openfinance', {
        body: { audit_period_id: p.id, bank: 'bb' },
      });
      if (error) {
        let detail = error.message ?? 'erro';
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const bj = await ctx.json();
            if (bj?.error) detail = bj.error;
          }
        } catch { /* noop */ }
        throw new Error(detail);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const imported = Number((data as any)?.imported_rows ?? 0);
      const dups = Number((data as any)?.duplicate_rows ?? 0);
      const breakdown = Object.entries((data as any)?.breakdown_by_category ?? {})
        .filter(([, n]) => Number(n) > 0)
        .map(([k, n]) => `${k}=${n}`).join(', ') || '—';
      toast.success(`${imported} créditos importados do Open Finance`, {
        description: `${dups} duplicados ignorados. Categorias: ${breakdown}`,
      });
      await onAfter();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao puxar Open Finance');
    } finally {
      setPullingOF(false);
    }
  };


  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    const totalBreakdown: Record<string, number> = {};
    let totalImported = 0;
    let totalDuplicates = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const workbook = readWorkbookFixed(buf);
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) throw new Error('Arquivo sem abas');
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Arquivo vazio');

          const { data, error } = await supabase.functions.invoke('import-bb', {
            body: { audit_period_id: p.id, rows, file_name: file.name },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha na importação');

          totalImported += Number(data.imported_rows ?? 0);
          totalDuplicates += Number(data.duplicate_rows ?? 0);
          for (const [k, n] of Object.entries(data.breakdown_by_category ?? {})) {
            totalBreakdown[k] = (totalBreakdown[k] ?? 0) + Number(n);
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      const breakdown = Object.entries(totalBreakdown)
        .filter(([, n]) => Number(n) > 0)
        .map(([k, n]) => `${k}=${n}`).join(', ') || '—';
      if (failures.length === 0) {
        toast.success(`${totalImported} créditos importados de ${xlsx.length} arquivo(s)`, {
          description: `${totalDuplicates} duplicados ignorados. Categorias: ${breakdown}`,
        });
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <Landmark className="h-5 w-5 text-blue-600" />
        <CardTitle className="text-base">Extrato BB (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Extrato Banco do Brasil — depósitos voucher categorizados automaticamente
          por descrição (alelo / ticket / pluxee / vr / brendi / outros).
          Para cobrir defasagem, importe <strong>2 meses</strong> (mês competência + posterior).
        </p>
        <p className="text-xs text-muted-foreground">
          Ou puxe automaticamente os créditos do BB já sincronizados no Fluxo de Caixa (Open Finance) — sem baixar/subir planilha.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="default" className="gap-2" disabled={uploading || pullingOF} onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {uploading
              ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
              : 'Selecionar XLSX (1 ou mais)'}
          </Button>
          <Button variant="secondary" className="gap-2" disabled={uploading || pullingOF} onClick={handlePullOF}>
            {pullingOF ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {pullingOF ? 'Puxando…' : 'Puxar do Open Finance'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket — PDF
// ─────────────────────────────────────────────────────────────────────────────
export function UploadTicketCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const pdfs = files.filter(f => /\.(pdf|xlsx)$/i.test(f.name));
    const invalid = files.length - pdfs.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — aceita .pdf ou .xlsx`);
    if (pdfs.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: pdfs.length });
    let totalLots = 0;
    let totalItems = 0;
    const failures: string[] = [];
    const allWarnings: string[] = [];
    const allIntegrity: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setProgress({ current: i + 1, total: pdfs.length });
        try {
          let invokeBody: any;
          if (/\.xlsx$/i.test(file.name)) {
            const buf = await file.arrayBuffer();
            const workbook = readWorkbookFixed(buf);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
            invokeBody = { audit_period_id: p.id, file_name: file.name, rows };
          } else {
            const rawText = await extractPdfText(file);
            invokeBody = { audit_period_id: p.id, file_name: file.name, raw_text: rawText };
          }
          const { data, error } = await supabase.functions.invoke('import-ticket-pdf', {
            body: invokeBody,
          });
          if (error) {
            let detail = error.message ?? 'erro desconhecido';
            try {
              const ctx = (error as any).context;
              if (ctx && typeof ctx.json === 'function') {
                const bodyJson = await ctx.json();
                if (bodyJson?.error) detail = bodyJson.error;
                if (bodyJson?.warnings?.length) console.warn('[import-ticket-pdf] warnings:', bodyJson.warnings);
              }
            } catch { /* fallback */ }
            throw new Error(detail);
          }
          if (!data?.success) throw new Error(data?.error || 'Falha no import Ticket');

          totalLots += Number(data.inserted_lots ?? 0) + Number(data.updated_lots ?? 0);
          totalItems += Number(data.inserted_items ?? 0);
          for (const w of (data.warnings ?? []) as string[]) allWarnings.push(`${file.name}: ${w}`);
          for (const e of (data.integrity_errors ?? []) as string[]) allIntegrity.push(`${file.name}: ${e}`);
          if (data.lot_errors?.length) {
            console.warn(`[import-ticket-pdf] ${file.name} — ${data.lot_errors_count} lote(s) com erro:`, data.lot_errors);
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalLots} lotes / ${totalItems} vendas de ${pdfs.length} arquivo(s)`, {
          description: allIntegrity.length > 0
            ? `⚠ ${allIntegrity.length} divergências de integridade (veja console)`
            : allWarnings.length > 0
              ? `${allWarnings.length} warnings (não crítico)`
              : 'Sem divergências',
        });
      } else {
        toast.error(`${failures.length} de ${pdfs.length} falharam`, { description: failures.join(' | ') });
      }
      if (allIntegrity.length > 0) console.warn('Integrity:', allIntegrity);
      if (allWarnings.length > 0) console.info('Warnings:', allWarnings);
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileText className="h-5 w-5 text-amber-600" />
        <CardTitle className="text-base">Reembolsos Ticket (.pdf ou .xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          "Extrato de Reembolsos Detalhado" do portal Ticket Edenred — em PDF
          ou XLSX (o portal exporta os dois). Cada Nº Reembolso vira 1 lote = 1
          depósito esperado no BB. Pode selecionar mais de 1 arquivo (ex: meses separados).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar PDF (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alelo — XLSX (aba "Extrato")
// ─────────────────────────────────────────────────────────────────────────────
export function UploadAleloCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalLots = 0;
    let totalItems = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const workbook = readWorkbookFixed(buf);
          let sheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'extrato');
          if (!sheetName) {
            for (const candidate of workbook.SheetNames) {
              const sheet = workbook.Sheets[candidate];
              const probe = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
              const hasHeader = probe.slice(0, 5).some(r =>
                Array.isArray(r) && r.some(c => String(c ?? '').toLowerCase().includes('data de pagamento')),
              );
              if (hasHeader) { sheetName = candidate; break; }
            }
          }
          if (!sheetName) {
            throw new Error(`Aba "Extrato" não encontrada (abas: ${workbook.SheetNames.join(', ')})`);
          }
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          const { data, error } = await supabase.functions.invoke('import-alelo-xlsx', {
            body: { audit_period_id: p.id, rows, file_name: file.name },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import Alelo');

          totalLots += Number(data.inserted_lots ?? 0) + Number(data.updated_lots ?? 0);
          totalItems += Number(data.inserted_items ?? 0);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalLots} lotes / ${totalItems} vendas Alelo importadas`);
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileSpreadsheet className="h-5 w-5 text-orange-600" />
        <CardTitle className="text-base">Extrato Alelo (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          XLSX exportado do portal Alelo (aba "Extrato"). Cada Data de Pagamento
          única vira 1 lote = 1 crédito BB esperado. Taxa é por venda (não por lote).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VR — Reembolsos + Vendas (XLS/XLSX, auto-detecta tipo pela aba)
// ─────────────────────────────────────────────────────────────────────────────
export function UploadVRCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xls = files.filter(f => /\.(xlsx?|XLSX?)$/.test(f.name));
    const invalid = files.length - xls.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xls ou .xlsx`);
    if (xls.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xls.length });
    let totalLots = 0;
    let totalLinkedSales = 0;
    let totalOrphans = 0;
    const failures: string[] = [];
    const orphansAcc: any[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xls.length; i++) {
        const file = xls[i];
        setProgress({ current: i + 1, total: xls.length });
        try {
          const buf = await file.arrayBuffer();
          const workbook = readWorkbookFixed(buf);

          let kind: 'reembolsos' | 'vendas' | null = null;
          let sheetName: string | undefined;
          for (const n of workbook.SheetNames) {
            const lower = n.trim().toLowerCase();
            if (lower.includes('reembolso') || lower.includes('guias')) {
              kind = 'reembolsos'; sheetName = n; break;
            }
            if (lower.includes('venda') || lower.includes('transação') || lower.includes('transacao')) {
              kind = 'vendas'; sheetName = n; break;
            }
          }
          if (!kind || !sheetName) {
            sheetName = workbook.SheetNames[0];
            const probe = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
            const flat = probe.slice(0, 25).flat().map((c: any) => String(c ?? '').toLowerCase());
            if (flat.some(c => c.includes('número guia') || c.includes('numero guia'))) kind = 'reembolsos';
            else if (flat.some(c => c.includes('autorização') || c.includes('autorizacao'))) kind = 'vendas';
            else throw new Error('Não identificou tipo. Abas: ' + workbook.SheetNames.join(', '));
          }
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          const fnName = kind === 'reembolsos' ? 'import-vr-xls' : 'import-vr-vendas-xls';
          const { data, error } = await supabase.functions.invoke(fnName, {
            body: { audit_period_id: p.id, rows, file_name: file.name },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || `Falha no import ${kind}`);

          if (kind === 'reembolsos') {
            totalLots += Number(data.inserted_lots ?? 0) + Number(data.updated_lots ?? 0);
          } else {
            totalLinkedSales += Number(data.linked_count ?? 0);
            totalOrphans += Number(data.orphan_count ?? 0);
            for (const o of (data.orphans ?? [])) orphansAcc.push(o);
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        const parts: string[] = [];
        if (totalLots > 0) parts.push(`${totalLots} lotes VR`);
        if (totalLinkedSales > 0) parts.push(`${totalLinkedSales} vendas vinculadas`);
        const desc = totalOrphans > 0 ? `${totalOrphans} venda(s) órfã(s) — sem lote correspondente. Veja console.` : '';
        toast.success(parts.join(' + ') || 'Import concluído', { description: desc });
        if (orphansAcc.length > 0) console.warn('Vendas VR órfãs:', orphansAcc);
      } else {
        toast.error(`${failures.length} de ${xls.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileSpreadsheet className="h-5 w-5 text-pink-600" />
        <CardTitle className="text-base">VR — Reembolsos + Vendas (.xls)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Aceita "Guias de Reembolso" (lotes) e "Relatório de Transação de Venda"
          (vendas individuais). Importe os 2 — vendas precisam dos lotes pra serem
          vinculadas pelo produto + data_corte.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLS (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pluxee — XLSX (formato novo, mai/2026 em diante: 3 arquivos)
// ─────────────────────────────────────────────────────────────────────────────
// Detecta o TIPO do arquivo Pluxee pelo cabeçalho (não pelo nome do arquivo
// nem pelo card onde foi solto). Pagamentos tem coluna Status; Vendas não.
function detectPluxeeType(rows: any[][]): 'vendas' | 'pagamentos' | null {
  const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let pag = false, ven = false;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const j = (rows[i] || []).map(norm).join(' | ');
    if (j.includes('status') && j.includes('autoriza') && j.includes('valor bruto')) pag = true;
    else if (j.includes('data da transacao') && j.includes('data de pagamento')) ven = true;
  }
  return pag ? 'pagamentos' : ven ? 'vendas' : null;
}

// Sobe arquivos Pluxee roteando CADA arquivo pro robô certo conforme o tipo
// detectado no cabeçalho — assim tanto faz em qual card (Vendas/Pagamentos) o
// usuário soltou; o sistema separa. `defaultFn` só decide o desempate se não
// der pra detectar.
function usePluxeeXlsxUploader(
  defaultFn: 'import-pluxee-vendas-xlsx' | 'import-pluxee-pagamentos-xlsx',
  ensurePeriod: () => Promise<AuditPeriodLite | null>,
  onAfter: () => Promise<void> | void,
) {
  return async (files: File[], setProgress: (v: { current: number; total: number } | null) => void) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx`);
    if (xlsx.length === 0) return { ok: false, summaries: [] as string[] };
    const summaries: string[] = [];
    const failures: string[] = [];
    const p = await ensurePeriod();
    if (!p) return { ok: false, summaries };
    for (let i = 0; i < xlsx.length; i++) {
      const file = xlsx[i];
      setProgress({ current: i + 1, total: xlsx.length });
      try {
        const buf = await file.arrayBuffer();
        const wb = readWorkbookFixed(buf);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
        if (!rows.length) throw new Error('Aba vazia');
        const type = detectPluxeeType(rows) ?? (defaultFn.includes('pagamento') ? 'pagamentos' : 'vendas');
        const fnName = type === 'pagamentos' ? 'import-pluxee-pagamentos-xlsx' : 'import-pluxee-vendas-xlsx';
        const { data, error } = await supabase.functions.invoke(fnName, {
          body: { audit_period_id: p.id, rows, file_name: file.name },
        });
        if (error) {
          let detail = error.message ?? 'erro';
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const bj = await ctx.json();
              if (bj?.error) detail = bj.error;
            }
          } catch { /* noop */ }
          throw new Error(detail);
        }
        if (!data?.success) throw new Error(data?.error || 'Falha no import');
        summaries.push(`${data.message ?? 'ok'} (${type})`);
      } catch (e: any) {
        failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
      }
    }
    if (failures.length) toast.error(`${failures.length}/${xlsx.length} falharam`, { description: failures.join(' | ') });
    if (summaries.length) toast.success(summaries.join(' · '));
    await onAfter();
    return { ok: failures.length === 0, summaries };
  };
}

export function UploadPluxeeVendasCard({ ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const upload = usePluxeeXlsxUploader('import-pluxee-vendas-xlsx', ensurePeriod, onAfter);
  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try { await upload(files, setProgress); }
    finally { setUploading(false); setProgress(null); if (inputRef.current) inputRef.current.value = ''; }
  };
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileSpreadsheet className="h-5 w-5 text-violet-600" />
        <CardTitle className="text-base">Pluxee — Extrato de Vendas (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Pode soltar aqui os XLSX do Pluxee — <strong>vendas e/ou pagamentos</strong>: o sistema
          identifica cada um e manda pro lugar certo. Use os arquivos do <strong>mês de competência</strong>.
        </p>
        <input
          ref={inputRef} type="file" accept=".xlsx" multiple className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) handleFiles(f); }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…') : 'Selecionar XLSX'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function UploadPluxeePagamentosCard({ ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const upload = usePluxeeXlsxUploader('import-pluxee-pagamentos-xlsx', ensurePeriod, onAfter);
  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try { await upload(files, setProgress); }
    finally { setUploading(false); setProgress(null); if (inputRef.current) inputRef.current.value = ''; }
  };
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileSpreadsheet className="h-5 w-5 text-violet-700" />
        <CardTitle className="text-base">Pluxee — Extrato de Pagamentos (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          XLSX "extrato_pagamentos" do portal Pluxee (Status PAGO/ERRO + descontos). Pode soltar
          vendas e pagamentos juntos aqui — o sistema separa. Use o <strong>mês de competência</strong>;
          a cauda do fim do mês (paga no mês seguinte) já entra como taxa provisionada.
        </p>
        <input
          ref={inputRef} type="file" accept=".xlsx" multiple className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) handleFiles(f); }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…') : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pluxee — CSV legado (formato antigo "1976928*.csv", recuperação)
// ─────────────────────────────────────────────────────────────────────────────
export function UploadPluxeeCard({ ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const csvs = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
    const invalid = files.length - csvs.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .csv`);
    if (csvs.length === 0) return;
    const p = await ensurePeriod();
    if (!p) return;
    setUploading(true);
    const summaries: string[] = [];
    const failures: string[] = [];
    try {
      for (let i = 0; i < csvs.length; i++) {
        const file = csvs[i];
        setProgress({ current: i + 1, total: csvs.length });
        try {
          const buf = await file.arrayBuffer();
          // Pluxee CSV vem em ISO-8859-1 (Latin-1)
          const content = new TextDecoder('iso-8859-1').decode(buf);
          const { data, error } = await supabase.functions.invoke('import-pluxee-csv', {
            body: { audit_period_id: p.id, file_name: file.name, content },
          });
          if (error) {
            let detail = error.message ?? 'erro';
            try {
              const ctx = (error as any).context;
              if (ctx && typeof ctx.json === 'function') {
                const bj = await ctx.json();
                if (bj?.error) detail = bj.error;
              }
            } catch { /* noop */ }
            throw new Error(detail);
          }
          if (data?.skipped) { failures.push(`${file.name}: ${data.error}`); continue; }
          if (!data?.success) throw new Error(data?.error || 'Falha no import');
          summaries.push(data.message ?? `${file.name}: ok`);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }
      if (failures.length) toast.error(`${failures.length}/${csvs.length} falharam`, { description: failures.join(' | ') });
      if (summaries.length) toast.success(summaries.join(' · '));
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileText className="h-5 w-5 text-amber-600" />
        <CardTitle className="text-base">Pluxee — CSV legado (.csv)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Formato antigo (arquivo "1976928*.csv"). Use APENAS pra recuperar audit
          periods anteriores a mar/26 que ainda usavam CSV. Não é mais o formato atual.
        </p>
        <input
          ref={inputRef} type="file" accept=".csv" multiple className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) handleFiles(f); }}
        />
        <Button variant="outline" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…') : 'Selecionar CSV (legado)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Brendi — XLSX (report "Resultado da consulta")
// ─────────────────────────────────────────────────────────────────────────────
export function UploadBrendiCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalImported = 0;
    let totalIgnoredStatus = 0;
    let totalIgnoredForma = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          // Aba esperada: "Resultado da consulta" — fallback primeira aba
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('resultado')) ?? wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          // raw: true = valores nativos (number/Date/string), evita formatação locale
          // que quebrava parser na edge (ex: "113.90" virava 11390 no toNum bugado)
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          // clear_existing desabilitado: cada upload individual faz upsert.
          // O botão de lixeira na aba Importações cobre apagar quando necessário.
          const { data, error } = await supabase.functions.invoke('import-brendi-xlsx', {
            body: { audit_period_id: p.id, rows, file_name: file.name, clear_existing: false },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import Brendi');

          totalImported += Number(data.imported_rows ?? 0);
          totalIgnoredStatus += Number(data.ignored_status ?? 0);
          totalIgnoredForma += Number(data.ignored_forma ?? 0);
          if (Number(data.imported_rows ?? 0) === 0 && Number(data.total_rows ?? 0) > 0) {
            console.warn(
              `[import-brendi-xlsx] ${file.name} importou 0/${data.total_rows}.`,
              `\n  ignored_status=${data.ignored_status} ignored_forma=${data.ignored_forma} skipped_no_id=${data.skipped_no_id} skipped_no_date=${data.skipped_no_date}`,
              '\n  Status vistos:', data.seen_statuses,
              '\n  Formas vistas:', data.seen_formas,
              '\n  Sample Created At (3):', data.sample_created_at,
            );
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalImported} pedidos online Brendi importados`, {
          description: totalImported === 0
            ? `0 importados — abra o Console (F12) pra ver status/formas vistos`
            : `${totalIgnoredStatus} não-entregue + ${totalIgnoredForma} fora de escopo (Pix/Crédito Online apenas)`,
        });
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <ShoppingBag className="h-5 w-5 text-rose-600" />
        <CardTitle className="text-base">Report Brendi (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Export "Pedidos" do portal Brendi (aba "Resultado da consulta"). Importa apenas
          pedidos com status="Entregue" e Forma de pagamento ∈ ("Pix Online", "Crédito Online").
          Importe os 3 meses (ant + competência + post) pra cobrir D+1 entre meses.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Saipos — XLSX (export "Vendas por período"), canal-agnóstica
// ─────────────────────────────────────────────────────────────────────────────
export function UploadSaiposCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalImported = 0;
    const byCanal: Record<string, number> = {};
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('vendas')) ?? wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          // raw: true = valores nativos (number/Date/string), evita formatação locale
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          // clear_existing desabilitado: cada upload individual faz upsert.
          const { data, error } = await supabase.functions.invoke('import-saipos-xlsx', {
            body: { audit_period_id: p.id, rows, file_name: file.name, clear_existing: false },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import Saipos');

          totalImported += Number(data.imported_rows ?? 0);
          for (const [k, n] of Object.entries(data.by_canal ?? {})) {
            byCanal[k] = (byCanal[k] ?? 0) + Number(n);
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        const canalDesc = Object.entries(byCanal).map(([k, n]) => `${k}=${n}`).join(', ') || '—';
        toast.success(`${totalImported} pedidos Saipos importados`, { description: `Canais: ${canalDesc}` });
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <Store className="h-5 w-5 text-cyan-600" />
        <CardTitle className="text-base">Saipos — Vendas por período (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Export do PDV Saipos (aba "Vendas por período"). Importa <strong>todos os canais</strong> (Brendi,
          iFood, balcão), serve como fonte da verdade pra cross-check Saipos × Brendi (e estágio 4 iFood Marketplace).
          Obrigatório pra rodar match Brendi.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: dispara match-vouchers reset=true por operadora
// ─────────────────────────────────────────────────────────────────────────────
export async function dispatchAutoMatchVouchers(
  periodId: string,
  operadoras: Array<'ticket' | 'alelo' | 'pluxee' | 'vr'>,
) {
  for (const op of operadoras) {
    try {
      const { data, error } = await supabase.functions.invoke('match-vouchers', {
        body: { audit_period_id: periodId, operadora: op, reset: true },
      });
      if (error) {
        toast.error(`Match ${op} falhou`, { description: error.message });
        continue;
      }
      if (!data?.success) {
        toast.error(`Match ${op} falhou`, { description: data?.error || 'Erro desconhecido' });
        continue;
      }
      const ambig = (data.ambiguous ?? []) as string[];
      if (ambig.length > 0) {
        toast.warning(`${op}: ${data.message ?? data.matched + ' pareados'}`, {
          description: `${ambig.length} ambíguos`,
        });
        console.warn(`[match ${op}] ambíguos:`, ambig);
      }
    } catch (e: any) {
      toast.error(`Match ${op} erro`, { description: e?.message ?? 'Erro inesperado' });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// iFood Marketplace — Relatório Pedidos (.xlsx, per-pedido)
// ─────────────────────────────────────────────────────────────────────────────
export function UploadIfoodOrdersCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalImported = 0;
    let totalIgnoredStatus = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          // clear_existing desabilitado: cada upload individual faz upsert.
          const { data, error } = await supabase.functions.invoke('import-ifood-orders', {
            body: { audit_period_id: p.id, rows, file_name: file.name, clear_existing: false },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import iFood Orders');

          totalImported += Number(data.imported_rows ?? 0);
          totalIgnoredStatus += Number(data.ignored_status ?? 0);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalImported} pedidos iFood Marketplace importados`, {
          description: `${totalIgnoredStatus} fora de escopo (não-CONCLUIDO)`,
        });
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <UtensilsCrossed className="h-5 w-5 text-red-600" />
        <CardTitle className="text-base">iFood — Relatório de Pedidos (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Portal Parceiro → Pedidos → Relatório de Pedidos → XLSX. <strong>1 arquivo por loja</strong>{' '}
          (Pizzaria Estrela e Temx Pizza separadamente). Apenas o mês de competência.
          Filtra status="CONCLUIDO".
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// iFood Marketplace — Extrato Detalhado (.xlsx) — fonte da verdade do iFood v2
// 1 arquivo por loja (Pizzaria Estrela e Temx Pizza separadamente).
// ─────────────────────────────────────────────────────────────────────────────
export function UploadIfoodExtratoDetalhadoCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    let totalImported = 0;
    const lojas: string[] = [];
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          const { data, error } = await supabase.functions.invoke('import-ifood-extrato-detalhado', {
            body: { audit_period_id: p.id, rows, file_name: file.name },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import Extrato Detalhado');

          totalImported += Number(data.imported_rows ?? 0);
          if (data.store_id_curto) lojas.push(data.store_id_curto);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalImported} lançamentos importados`, {
          description: `Lojas: ${[...new Set(lojas)].join(', ')}`,
        });
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileSpreadsheet className="h-5 w-5 text-red-600" />
        <CardTitle className="text-base">iFood — Extrato Detalhado (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Portal Parceiro → Financeiro → Extrato Detalhado → XLSX. <strong>1 arquivo por loja</strong>{' '}
          (Pizzaria Estrela e Temx Pizza separadamente). Apenas o mês de competência.
          A loja é detectada automaticamente.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (Estrela + Temx)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// iFood Marketplace — Conta iFood Pago (.csv) — extrato bancário da conta
// nativa do iFood. Importar mês comp + comp+1 (ciclos atravessam meses).
// ─────────────────────────────────────────────────────────────────────────────
export function UploadIfoodContaCsvCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const csvs = files.filter(f => /\.(csv|pdf)$/i.test(f.name));
    if (csvs.length === 0) {
      toast.error('Aceita .csv ou .pdf');
      return;
    }
    setUploading(true);
    setProgress({ current: 0, total: csvs.length });
    let totalImported = 0;
    let totalNaoReconhecido = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < csvs.length; i++) {
        const file = csvs[i];
        setProgress({ current: i + 1, total: csvs.length });
        try {
          let invokeBody: any;
          if (/\.pdf$/i.test(file.name)) {
            // PDF da conta digital iFood: manda o texto cru pro edge extrair.
            const rawText = await extractPdfText(file);
            invokeBody = { audit_period_id: p.id, raw_text: rawText, file_name: file.name, clear_existing: false };
          } else {
            // CSV: lê texto cru — xlsx.js convertia datas ISO em formato americano
            // M/D/YY e o edge descartava todas as antecipações por "sem data".
            let text = await file.text();
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
            const rows = lines.map(line => parseCsvLine(line));
            if (!rows.length) throw new Error('CSV vazio');
            invokeBody = { audit_period_id: p.id, rows, file_name: file.name, clear_existing: false };
          }
          const { data, error } = await supabase.functions.invoke('import-ifood-conta-csv', {
            body: invokeBody,
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import Conta iFood Pago');
          totalImported += Number(data.imported_rows ?? 0);
          totalNaoReconhecido += Number(data.total_nao_reconhecido ?? 0);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (totalNaoReconhecido > 0) {
        const fmt = totalNaoReconhecido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        toast.info(`R$ ${fmt} entraram na conta sem identificação (campo informativo)`);
      }
      if (failures.length === 0) {
        toast.success(`${totalImported} movimentos importados (conta iFood Pago)`);
      } else {
        toast.error(`${failures.length} de ${csvs.length} falharam`, { description: failures.join(' | ') });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <Landmark className="h-5 w-5 text-orange-600" />
        <CardTitle className="text-base">iFood — Conta iFood Pago (.csv ou .pdf)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Extrato da <strong>conta iFood Pago</strong> (banco do iFood) — em CSV ou PDF.
          <strong> Importe 2 arquivos</strong>: o do mês de competência <em>e</em> o do mês seguinte
          (alguns ciclos antecipam no mês posterior). Repasse e Antecipação viram repasse/taxa;
          créditos sem identificação entram como "não reconhecido".
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button variant="default" className="gap-2" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar CSV (comp + comp+1)'}
        </Button>
      </CardContent>
    </Card>
  );
}

// Dispara match-ifood-marketplace (reset=true)
export async function dispatchMatchIfoodMarketplace(periodId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('match-ifood-marketplace', {
      body: { audit_period_id: periodId, reset: true },
    });
    if (error) {
      toast.error('Match iFood Marketplace falhou', { description: error.message });
      return null;
    }
    if (!data?.success) {
      toast.error('Match iFood Marketplace falhou', { description: data?.error || 'Erro desconhecido' });
      return null;
    }
    const cc = data.crosscheck;
    if (cc?.missing_in_ifood_count > 0) {
      toast.warning(`⚠ ${cc.missing_in_ifood_count} pedido(s) só no Saipos`, {
        description: 'iFood não declarou — possível repasse omisso',
      });
    }
    return data;
  } catch (e: any) {
    toast.error('Match iFood Marketplace erro', { description: e?.message ?? 'Erro inesperado' });
    return null;
  }
}

// Dispara match-brendi (reset=true) — usado pelo onAfter dos uploads Brendi/Saipos
// e pelo botão "Executar match Brendi" no /conciliacao.
export async function dispatchMatchBrendi(periodId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('match-brendi', {
      body: { audit_period_id: periodId, reset: true },
    });
    if (error) {
      toast.error('Match Brendi falhou', { description: error.message });
      return null;
    }
    if (!data?.success) {
      toast.error('Match Brendi falhou', { description: data?.error || 'Erro desconhecido' });
      return null;
    }
    const cc = data.crosscheck;
    if (cc?.missing_in_brendi_count > 0) {
      toast.warning(`⚠ ${cc.missing_in_brendi_count} pedido(s) só no Saipos`, {
        description: 'Brendi não declarou — possível repasse omisso',
      });
    }
    return data;
  } catch (e: any) {
    toast.error('Match Brendi erro', { description: e?.message ?? 'Erro inesperado' });
    return null;
  }
}
