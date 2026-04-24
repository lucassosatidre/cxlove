import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { ArrowLeft, FileSpreadsheet, Loader2, UploadCloud, CheckCircle2, Landmark, Trash2 } from 'lucide-react';

type AuditImport = {
  id: string;
  file_type: string;
  file_name: string;
  status: string;
  imported_rows: number;
  duplicate_rows: number;
  total_rows: number;
  created_at: string;
};

type AuditPeriod = { id: string; month: number; year: number; status: string };

type FileType = 'maquinona' | 'cresol' | 'bb';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const CARD_META: Record<FileType, { title: string; functionName: string; tip: string; icon: any; multi: boolean }> = {
  maquinona: {
    title: 'Maquinona (iFood Portal)',
    functionName: 'import-maquinona',
    tip: '💡 Como exportar do Portal iFood: Financeiro > Relatório de Transações > Exportar em xlsx. Re-importar substitui os dados anteriores.',
    icon: FileSpreadsheet,
    multi: false,
  },
  cresol: {
    title: 'Cresol (Extrato iFood)',
    functionName: 'import-cresol',
    tip: '💡 Importe o extrato do mês de competência + 1 mês após (ex: para Março, importe Março + Abril) para capturar recebimentos atrasados que correspondem a vendas do final do mês.',
    icon: Landmark,
    multi: true,
  },
  bb: {
    title: 'Banco do Brasil (Vouchers)',
    functionName: 'import-bb',
    tip: '💡 Vouchers (Pluxee, Ticket etc.) podem demorar até 10 dias para depositar. Importe o BB do mês + 1 mês para capturar recebimentos atrasados. Categorização Alelo/Ticket/Pluxee/VR/Brendi é automática.',
    icon: Landmark,
    multi: true,
  },
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function parseXlsxFile(file: File, type: FileType): Promise<{ rows: any[]; error?: string }> {
  const buf = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buf, { type: 'array', cellDates: true });
  } catch {
    return { rows: [], error: 'Não foi possível ler o arquivo .xlsx' };
  }

  if (type === 'maquinona') {
    const sheetName = workbook.SheetNames.find(
      n => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'transacoes',
    );
    if (!sheetName) {
      return { rows: [], error: 'Aba "Transações" não encontrada. Exporte novamente do Portal iFood em Financeiro > Relatório de Transações.' };
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: null, raw: false });
    if (!rows.length) return { rows: [], error: 'Aba "Transações" está vazia' };
    return { rows };
  }

  const sheetName =
    type === 'bb'
      ? workbook.SheetNames.find(n => /extrato/i.test(n)) ?? workbook.SheetNames[0]
      : workbook.SheetNames[0];
  if (!sheetName) return { rows: [], error: 'Arquivo sem abas' };
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
  if (!rows.length) return { rows: [], error: 'Arquivo vazio' };
  return { rows };
}

export default function AuditImport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tipoParam = searchParams.get('tipo') as FileType | null;
  const periodIdParam = searchParams.get('period');
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmReimportMaquinona, setConfirmReimportMaquinona] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const backUrl = useMemo(() => {
    const m = monthParam ?? (period ? String(period.month) : '');
    const y = yearParam ?? (period ? String(period.year) : '');
    return m && y ? `/admin/auditoria?month=${m}&year=${y}` : '/admin/auditoria';
  }, [monthParam, yearParam, period]);

  const refresh = async (periodId: string) => {
    const { data: imps } = await supabase
      .from('audit_imports').select('*').eq('audit_period_id', periodId)
      .order('created_at', { ascending: false });
    setImports((imps as AuditImport[]) ?? []);
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      let p: AuditPeriod | null = null;
      if (periodIdParam) {
        const { data } = await supabase
          .from('audit_periods').select('*').eq('id', periodIdParam).maybeSingle();
        p = (data as AuditPeriod) ?? null;
      } else {
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const { data } = await supabase
          .from('audit_periods').select('*').eq('month', month).eq('year', year).maybeSingle();
        p = (data as AuditPeriod) ?? null;
      }
      if (!active) return;
      setPeriod(p);
      if (p) await refresh(p.id);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, periodIdParam]);

  const importsByType = useMemo(() => {
    const map: Record<FileType, AuditImport[]> = { maquinona: [], cresol: [], bb: [] };
    for (const i of imports) {
      if (i.status === 'completed' && (i.file_type === 'maquinona' || i.file_type === 'cresol' || i.file_type === 'bb')) {
        map[i.file_type as FileType].push(i);
      }
    }
    return map;
  }, [imports]);

  if (roleLoading || loading) {
    return (
      <AppLayout title="Importação">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Importação">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const doImport = async (type: FileType, file: File) => {
    if (!period) return;
    try {
      const { rows, error: parseErr } = await parseXlsxFile(file, type);
      if (parseErr) throw new Error(parseErr);

      const { data, error } = await supabase.functions.invoke(CARD_META[type].functionName, {
        body: { audit_period_id: period.id, rows, file_name: file.name },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha na importação');

      let description = '';
      if (type === 'maquinona') {
        description = `${data.imported_rows} novas transações, ${data.duplicate_rows} duplicadas ignoradas`;
      } else if (type === 'cresol') {
        description = `${data.imported_rows} depósitos iFood importados. ${data.duplicate_rows} duplicadas, ${data.skipped_non_ifood} não-iFood ignorados.`;
      } else if (type === 'bb') {
        const b = data.breakdown_by_category ?? {};
        description = `${data.imported_rows} créditos: ${b.alelo ?? 0} Alelo, ${b.ticket ?? 0} Ticket, ${b.pluxee ?? 0} Pluxee, ${b.vr ?? 0} VR, ${b.brendi ?? 0} Brendi, ${b.outro ?? 0} outros.`;
      }
      toast.success('✓ Importação concluída', { description });
      await refresh(period.id);
    } catch (e: any) {
      toast.error('Erro na importação', { description: e?.message ?? 'Erro inesperado' });
      throw e;
    }
  };

  const removeImport = async (importId: string) => {
    setRemovingId(importId);
    try {
      // Cascade deletes deposits via FK ON DELETE CASCADE for cresol/bb (import_id column)
      const { error } = await supabase.from('audit_imports').delete().eq('id', importId);
      if (error) throw error;
      toast.success('✓ Importação removida');
      if (period) await refresh(period.id);
    } catch (e: any) {
      toast.error('Erro ao remover', { description: e?.message ?? 'Erro inesperado' });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <AppLayout title="Importação" subtitle="Auditoria de Taxas">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate(backUrl)} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Importação</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {period ? (
          <p className="text-sm text-muted-foreground">
            Período: <span className="font-medium text-foreground">{MONTHS[period.month - 1]} {period.year}</span>
          </p>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Nenhum período aberto para o mês atual. Crie um período no Dashboard primeiro.
            </CardContent>
          </Card>
        )}

        {(['maquinona', 'cresol', 'bb'] as FileType[]).map((t) => (
          <ImportCard
            key={t}
            type={t}
            highlight={tipoParam === t}
            disabled={!period}
            existingImports={importsByType[t]}
            onImport={(file) => doImport(t, file)}
            onAskReimportMaquinona={() => setConfirmReimportMaquinona(true)}
            confirmingReimportMaquinona={t === 'maquinona' && confirmReimportMaquinona}
            onCancelReimportMaquinona={() => setConfirmReimportMaquinona(false)}
            onRemove={removeImport}
            removingId={removingId}
          />
        ))}

        <Button variant="outline" onClick={() => navigate(backUrl)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar ao Dashboard
        </Button>
      </div>
    </AppLayout>
  );
}

function ImportCard({
  type, highlight, disabled, existingImports, onImport,
  onAskReimportMaquinona, confirmingReimportMaquinona, onCancelReimportMaquinona,
  onRemove, removingId,
}: {
  type: FileType;
  highlight: boolean;
  disabled: boolean;
  existingImports: AuditImport[];
  onImport: (file: File) => Promise<void>;
  onAskReimportMaquinona: () => void;
  confirmingReimportMaquinona: boolean;
  onCancelReimportMaquinona: () => void;
  onRemove: (importId: string) => Promise<void>;
  removingId: string | null;
}) {
  const meta = CARD_META[type];
  const Icon = meta.icon;
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    if (highlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Arquivo inválido. Selecione um arquivo .xlsx');
      return;
    }
    setFile(f);
  };

  const runImport = async () => {
    if (!file) return;
    setUploading(true);
    try {
      await onImport(file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      // toast already shown
    } finally {
      setUploading(false);
    }
  };

  const onClickImport = () => {
    if (!file) {
      toast.error('Selecione um arquivo .xlsx');
      return;
    }
    // Maquinona: confirm re-import (replaces). Cresol/BB: just add.
    if (type === 'maquinona' && existingImports.length > 0) {
      onAskReimportMaquinona();
    } else {
      runImport();
    }
  };

  const buttonLabel = (() => {
    if (uploading) return 'Processando...';
    if (type === 'maquinona') {
      return existingImports.length > 0 ? 'Re-importar Maquinona' : 'Importar Maquinona';
    }
    return existingImports.length > 0
      ? `Adicionar outro extrato ${type === 'cresol' ? 'Cresol' : 'BB'}`
      : `Importar ${type === 'cresol' ? 'Cresol' : 'BB'}`;
  })();

  return (
    <>
      <Card ref={cardRef} className={highlight ? 'border-primary border-2 shadow-md' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-5 w-5 text-primary" />
            {meta.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing imports list */}
          {existingImports.length === 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant="secondary" className="bg-muted text-muted-foreground">não importado</Badge>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">
                {meta.multi ? 'Arquivos importados neste período:' : 'Arquivo importado:'}
              </p>
              {existingImports.map((imp) => (
                <div key={imp.id} className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <span className="font-medium truncate">{imp.file_name}</span>
                    <span className="text-muted-foreground text-xs flex-shrink-0">
                      — {imp.imported_rows} {type === 'maquinona' ? 'transações' : 'depósitos'} · {fmtDateTime(imp.created_at)}
                    </span>
                  </div>
                  {meta.multi && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-7 px-2"
                      onClick={() => setConfirmRemove(imp.id)}
                      disabled={removingId === imp.id}
                    >
                      {removingId === imp.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => inputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
            }`}
          >
            <UploadCloud className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            {file ? (
              <div className="text-sm">
                <p className="font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            ) : (
              <p className="text-sm text-foreground">
                {meta.multi && existingImports.length > 0
                  ? 'Arraste outro extrato .xlsx ou clique para selecionar'
                  : 'Arraste ou clique para selecionar o arquivo .xlsx'}
              </p>
            )}
            <input
              ref={inputRef} type="file" accept=".xlsx" className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <Button
            onClick={onClickImport}
            disabled={!file || disabled || uploading}
            className="w-full sm:w-auto gap-2"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {buttonLabel}
          </Button>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {meta.tip}
          </div>
        </CardContent>
      </Card>

      {/* Maquinona re-import confirmation */}
      <AlertDialog open={confirmingReimportMaquinona} onOpenChange={(o) => !o && onCancelReimportMaquinona()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-importar Maquinona?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe uma importação Maquinona para este período. Re-importar vai preservar os registros existentes (deduplicação automática) e adicionar apenas os novos. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onCancelReimportMaquinona(); runImport(); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove file confirmation */}
      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover este extrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Os depósitos vinculados a este arquivo serão apagados. Esta ação não pode ser desfeita. Recomenda-se reexecutar a Conciliação após remover.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmRemove) onRemove(confirmRemove);
                setConfirmRemove(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
