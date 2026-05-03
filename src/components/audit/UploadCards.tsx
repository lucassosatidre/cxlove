import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  FileSpreadsheet, FileText, Landmark, Loader2, UploadCloud, CreditCard, Store, ShoppingBag,
} from 'lucide-react';
import { extractPdfText } from '@/lib/pdf-text-extract';

export type AuditPeriodLite = { id: string; month: number; year: number; status: string };

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
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames.find(
            n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'transacoes',
          );
          if (!sheetName) throw new Error('Aba "Transações" não encontrada.');
          const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { defval: null, raw: false });

          const { data, error } = await supabase.functions.invoke('import-maquinona', {
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
        toast.success(`${totalImported} transações de ${xlsx.length} arquivo(s) Maquinona`);
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
          Idealmente <strong>3 arquivos</strong>: mês anterior + competência + posterior.
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
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
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
          const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
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
// Ticket — PDF
// ─────────────────────────────────────────────────────────────────────────────
export function UploadTicketCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const invalid = files.length - pdfs.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .pdf é aceito`);
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
          const rawText = await extractPdfText(file);
          const { data, error } = await supabase.functions.invoke('import-ticket-pdf', {
            body: { audit_period_id: p.id, file_name: file.name, raw_text: rawText },
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
        <CardTitle className="text-base">Reembolsos Ticket (.pdf)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          PDF "Extrato de Reembolsos Detalhado" do portal Ticket Edenred.
          Cada Nº Reembolso vira 1 lote = 1 depósito esperado no BB.
          Pode selecionar mais de 1 PDF (ex: meses separados).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
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
          const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
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
          const workbook = XLSX.read(buf, { type: 'array', cellDates: true });

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
// Pluxee — CSV ISO-8859-1
// ─────────────────────────────────────────────────────────────────────────────
export function UploadPluxeeCard({ period, ensurePeriod, onAfter }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const csvs = files.filter(f => /\.csv$/i.test(f.name));
    const invalid = files.length - csvs.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .csv`);
    if (csvs.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: csvs.length });
    let totalLots = 0;
    let totalItems = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < csvs.length; i++) {
        const file = csvs[i];
        setProgress({ current: i + 1, total: csvs.length });
        try {
          const buf = await file.arrayBuffer();
          const content = new TextDecoder('iso-8859-1').decode(buf);

          const { data, error } = await supabase.functions.invoke('import-pluxee-csv', {
            body: { audit_period_id: p.id, content, file_name: file.name },
          });
          if (error) {
            let detail = error.message ?? 'erro desconhecido';
            try {
              const ctx = (error as any).context;
              if (ctx && typeof ctx.json === 'function') {
                const bodyJson = await ctx.json();
                if (bodyJson?.error) detail = bodyJson.error;
              }
            } catch { /* fallback */ }
            throw new Error(detail);
          }
          if (!data?.success) {
            if (data?.skipped) { failures.push(`${file.name}: ${data.error}`); continue; }
            throw new Error(data?.error || 'Falha no import Pluxee');
          }

          totalLots += Number(data.inserted_lots ?? 0) + Number(data.updated_lots ?? 0);
          totalItems += Number(data.inserted_items ?? 0);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalLots} lotes Pluxee + ${totalItems} vendas`);
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
        <FileText className="h-5 w-5 text-violet-600" />
        <CardTitle className="text-base">Pluxee — Reembolsos (.csv)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          CSV de reembolsos Pluxee/Sodexo (arquivos com "1976928" no nome).
          Cada arquivo contém os lotes pagos com vendas embutidas.
          Arquivos de "vendas" sem o prefixo são redundantes — sistema avisa.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain,application/csv,application/vnd.ms-excel,application/octet-stream"
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
            : 'Selecionar CSV (1 ou mais)'}
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
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
          // Aba esperada: "Resultado da consulta" — fallback primeira aba
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('resultado')) ?? wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          // raw: true = valores nativos (number/Date/string), evita formatação locale
          // que quebrava parser na edge (ex: "113.90" virava 11390 no toNum bugado)
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          // PRIMEIRO arquivo do batch: clear_existing=true. Limpa lixo no edge
          // via SERVICE_ROLE (não depende de RLS do client). Demais arquivos
          // só fazem upsert.
          const { data, error } = await supabase.functions.invoke('import-brendi-xlsx', {
            body: { audit_period_id: p.id, rows, file_name: file.name, clear_existing: i === 0 },
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
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('vendas')) ?? wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          // raw: true = valores nativos (number/Date/string), evita formatação locale
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Aba vazia');

          // Primeiro arquivo: clear_existing=true (RLS bypass via SERVICE_ROLE)
          const { data, error } = await supabase.functions.invoke('import-saipos-xlsx', {
            body: { audit_period_id: p.id, rows, file_name: file.name, clear_existing: i === 0 },
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
