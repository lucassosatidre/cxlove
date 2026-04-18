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
import { ArrowLeft, FileSpreadsheet, Loader2, UploadCloud, CheckCircle2, Clock } from 'lucide-react';

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

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: string;
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

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
  const tipoParam = searchParams.get('tipo');
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [confirmReimport, setConfirmReimport] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const { data: p } = await supabase
        .from('audit_periods').select('*').eq('month', month).eq('year', year).maybeSingle();
      if (!active) return;
      setPeriod((p as AuditPeriod) ?? null);
      if (p) {
        const { data: imps } = await supabase
          .from('audit_imports').select('*').eq('audit_period_id', p.id)
          .order('created_at', { ascending: false });
        if (active) setImports((imps as AuditImport[]) ?? []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    if (tipoParam === 'maquinona' && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tipoParam, loading]);

  const lastMaquinonaImport = useMemo(
    () => imports.find(i => i.file_type === 'maquinona' && i.status === 'completed') ?? null,
    [imports],
  );

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Arquivo inválido. Selecione um arquivo .xlsx');
      return;
    }
    setFile(f);
  };

  const doImport = async () => {
    if (!file || !period) return;
    setUploading(true);
    setStatusText('Lendo arquivo...');
    try {
      const b64 = await fileToBase64(file);
      setStatusText('Processando transações...');
      const { data, error } = await supabase.functions.invoke('import-maquinona', {
        body: { audit_period_id: period.id, file_base64: b64, file_name: file.name },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha na importação');
      toast.success('Importação concluída', {
        description: `${data.imported_rows} transações importadas, ${data.duplicate_rows} duplicadas ignoradas`,
      });
      setStatusText('');
      setFile(null);
      setTimeout(() => navigate('/admin/auditoria'), 2000);
    } catch (e: any) {
      toast.error('Erro na importação', { description: e?.message ?? 'Erro inesperado' });
      setStatusText('');
    } finally {
      setUploading(false);
    }
  };

  const onClickImport = () => {
    if (!file || !period) {
      toast.error('Selecione um arquivo .xlsx');
      return;
    }
    if (lastMaquinonaImport) setConfirmReimport(true);
    else doImport();
  };

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

  const highlight = tipoParam === 'maquinona';

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

        {/* Maquinona */}
        <Card ref={cardRef} className={highlight ? 'border-primary border-2 shadow-md' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Maquinona (iFood Portal)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              {lastMaquinonaImport ? (
                <Badge variant="secondary" className="bg-green-500/15 text-green-700 dark:text-green-400 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  importado em {fmtDateTime(lastMaquinonaImport.created_at)} ({lastMaquinonaImport.imported_rows} transações)
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
                <p className="text-sm font-medium text-foreground">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-foreground">Arraste ou clique para selecionar o arquivo .xlsx</p>
                  <p className="text-xs text-muted-foreground mt-1">Aba esperada: "Transações"</p>
                </>
              )}
              <input
                ref={inputRef} type="file" accept=".xlsx" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <Button
              onClick={onClickImport}
              disabled={!file || !period || uploading}
              className="w-full sm:w-auto gap-2"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {uploading ? statusText || 'Processando...' : (lastMaquinonaImport ? 'Re-importar Maquinona' : 'Importar Maquinona')}
            </Button>

            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              💡 <strong>Como exportar do Portal iFood:</strong> Financeiro &gt; Relatório de Transações &gt; Exportar em xlsx
            </div>
          </CardContent>
        </Card>

        {/* Cresol em breve */}
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Cresol (em breve)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Funcionalidade será liberada no próximo prompt.</p>
          </CardContent>
        </Card>

        {/* BB em breve */}
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Banco do Brasil (em breve)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Funcionalidade será liberada no próximo prompt.</p>
          </CardContent>
        </Card>

        <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar ao Dashboard
        </Button>
      </div>

      <AlertDialog open={confirmReimport} onOpenChange={setConfirmReimport}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-importar Maquinona?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe uma importação de Maquinona para este período. Re-importar vai preservar as transações já existentes (via transaction_id único) e adicionar apenas as novas. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmReimport(false); doImport(); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
