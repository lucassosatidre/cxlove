import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { ArrowLeft, FileSpreadsheet, Loader2, UploadCloud, CheckCircle2, Landmark } from 'lucide-react';

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

const CARD_META: Record<FileType, { title: string; functionName: string; tip: string; icon: any }> = {
  maquinona: {
    title: 'Maquinona (iFood Portal)',
    functionName: 'import-maquinona',
    tip: '💡 Como exportar do Portal iFood: Financeiro > Relatório de Transações > Exportar em xlsx',
    icon: FileSpreadsheet,
  },
  cresol: {
    title: 'Cresol (Extrato iFood)',
    functionName: 'import-cresol',
    tip: '💡 Como exportar da Cresol: Extrato > Exportar > xlsx (período do mês). Apenas depósitos com "IFOOD" no histórico serão importados.',
    icon: Landmark,
  },
  bb: {
    title: 'Banco do Brasil (Vouchers)',
    functionName: 'import-bb',
    tip: '💡 Como exportar do BB: Extrato > Exportar > Excel. Apenas créditos (Entrada) serão importados; categorização automática Alelo/Ticket/Pluxee/VR/Brendi.',
    icon: Landmark,
  },
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}

export default function AuditImport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tipoParam = searchParams.get('tipo') as FileType | null;
  const periodIdParam = searchParams.get('period');
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmReimport, setConfirmReimport] = useState<FileType | null>(null);

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

  const lastImportByType = useMemo(() => {
    const map: Partial<Record<FileType, AuditImport>> = {};
    for (const t of ['maquinona', 'cresol', 'bb'] as FileType[]) {
      map[t] = imports.find(i => i.file_type === t && i.status === 'completed') ?? undefined;
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
      const b64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke(CARD_META[type].functionName, {
        body: { audit_period_id: period.id, file_base64: b64, file_name: file.name },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha na importação');

      let description = '';
      if (type === 'maquinona') {
        description = `${data.imported_rows} transações importadas, ${data.duplicate_rows} duplicadas ignoradas`;
      } else if (type === 'cresol') {
        description = `${data.imported_rows} depósitos iFood importados. ${data.duplicate_rows} duplicadas, ${data.skipped_non_ifood} não-iFood ignorados.`;
      } else if (type === 'bb') {
        const b = data.breakdown_by_category ?? {};
        description = `${data.imported_rows} créditos: ${b.alelo ?? 0} Alelo, ${b.ticket ?? 0} Ticket, ${b.pluxee ?? 0} Pluxee, ${b.vr ?? 0} VR, ${b.brendi ?? 0} Brendi, ${b.outro ?? 0} outros.`;
      }
      toast.success('✓ Importação concluída', { description });
      await refresh(period.id);
      setTimeout(() => {
        navigate('/admin/auditoria', { state: { month: period.month, year: period.year } });
      }, 2000);
    } catch (e: any) {
      toast.error('Erro na importação', { description: e?.message ?? 'Erro inesperado' });
      throw e;
    }
  };

  return (
    <AppLayout title="Importação" subtitle="Auditoria de Taxas">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
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
            lastImport={lastImportByType[t]}
            onImport={(file) => doImport(t, file)}
            onAskReimport={() => setConfirmReimport(t)}
            confirmingReimport={confirmReimport === t}
            onCancelReimport={() => setConfirmReimport(null)}
          />
        ))}

        <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar ao Dashboard
        </Button>
      </div>
    </AppLayout>
  );
}

function ImportCard({
  type, highlight, disabled, lastImport, onImport, onAskReimport, confirmingReimport, onCancelReimport,
}: {
  type: FileType;
  highlight: boolean;
  disabled: boolean;
  lastImport?: AuditImport;
  onImport: (file: File) => Promise<void>;
  onAskReimport: () => void;
  confirmingReimport: boolean;
  onCancelReimport: () => void;
}) {
  const meta = CARD_META[type];
  const Icon = meta.icon;
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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
    } catch {
      // toast já exibido em onImport
    } finally {
      setUploading(false);
    }
  };

  const onClickImport = () => {
    if (!file) {
      toast.error('Selecione um arquivo .xlsx');
      return;
    }
    if (lastImport) onAskReimport();
    else runImport();
  };

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
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-muted-foreground">Status:</span>
            {lastImport ? (
              <Badge variant="secondary" className="bg-green-500/15 text-green-700 dark:text-green-400 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                importado em {fmtDateTime(lastImport.created_at)} ({lastImport.imported_rows} {type === 'maquinona' ? 'transações' : 'depósitos'})
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-muted text-muted-foreground">não importado</Badge>
            )}
          </div>

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
              <p className="text-sm text-foreground">Arraste ou clique para selecionar o arquivo .xlsx</p>
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
            {uploading ? 'Processando...' : (lastImport ? `Re-importar ${type === 'maquinona' ? 'Maquinona' : type === 'cresol' ? 'Cresol' : 'BB'}` : `Importar ${type === 'maquinona' ? 'Maquinona' : type === 'cresol' ? 'Cresol' : 'BB'}`)}
          </Button>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {meta.tip}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmingReimport} onOpenChange={(o) => !o && onCancelReimport()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-importar {meta.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe uma importação para este período. Re-importar vai preservar os registros existentes (deduplicação automática) e adicionar apenas os novos. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onCancelReimport(); runImport(); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
