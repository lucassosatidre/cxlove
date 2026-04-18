import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { Plus, ArrowRight, FileSpreadsheet, Loader2 } from 'lucide-react';

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: 'aberto' | 'importado' | 'conciliado' | 'fechado';
  updated_at: string;
};

type AuditImport = {
  file_type: 'maquinona' | 'cresol' | 'bb';
  status: string;
  file_name: string;
  imported_rows: number;
  created_at: string;
};

type Totals = {
  vendido: number;
  recebido: number;
  custo: number;
  taxaPct: number;
  txCount: number;
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  aberto: { label: 'Aberto', className: 'bg-muted text-muted-foreground' },
  importado: { label: 'Importado', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  conciliado: { label: 'Conciliado', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  fechado: { label: 'Fechado', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
};

const FILE_LABELS: Record<string, string> = {
  maquinona: 'Maquinona',
  cresol: 'Cresol',
  bb: 'Banco do Brasil',
};

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function AuditDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [totals, setTotals] = useState<Totals>({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0 });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const loadPeriodData = async (periodId: string) => {
    const [{ data: imps }, { data: txs }, { data: deps }] = await Promise.all([
      supabase
        .from('audit_imports')
        .select('file_type,status,file_name,imported_rows,created_at')
        .eq('audit_period_id', periodId)
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_card_transactions')
        .select('gross_amount,tax_amount')
        .eq('audit_period_id', periodId),
      supabase
        .from('audit_bank_deposits')
        .select('amount,category')
        .eq('audit_period_id', periodId),
    ]);
    setImports((imps as AuditImport[]) ?? []);
    const rows = (txs as { gross_amount: number; tax_amount: number }[]) ?? [];
    const vendido = rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);

    const depRows = (deps as { amount: number; category: string | null }[]) ?? [];
    const recebido = depRows
      .filter(d => ['ifood', 'alelo', 'ticket', 'pluxee', 'vr'].includes(d.category ?? ''))
      .reduce((s, d) => s + Number(d.amount || 0), 0);
    const custo = Math.max(vendido - recebido, 0);
    const taxaEfetiva = vendido > 0 ? (custo / vendido) * 100 : 0;

    setTotals({
      vendido,
      recebido,
      custo,
      taxaPct: taxaEfetiva,
      txCount: rows.length,
    });
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from('audit_periods')
        .select('*')
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (!active) return;
      setPeriod((p as AuditPeriod) ?? null);

      if (p) {
        await loadPeriodData((p as AuditPeriod).id);
      } else {
        setImports([]);
        setTotals({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0 });
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [month, year, isAdmin]);

  const handleCreatePeriod = async () => {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('audit_periods')
      .insert({ month, year, created_by: user.id })
      .select()
      .single();
    setCreating(false);
    if (error) {
      toast({ title: 'Erro ao criar período', description: error.message, variant: 'destructive' });
      return;
    }
    setPeriod(data as AuditPeriod);
    toast({ title: 'Período criado', description: `${MONTHS[month - 1]} / ${year}` });
  };

  if (roleLoading) {
    return (
      <AppLayout title="Auditoria de Taxas">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Auditoria de Taxas">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const importByType = (t: 'maquinona' | 'cresol' | 'bb') => imports.find(i => i.file_type === t);
  const statusBadge = period ? STATUS_VARIANTS[period.status] : null;

  return (
    <AppLayout title="Auditoria de Taxas" subtitle="Conciliação Maquinona × Bancos">
      <div className="space-y-6">
        {/* Seletor */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <div className="flex items-center gap-2">
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {period && statusBadge && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge className={statusBadge.className} variant="secondary">{statusBadge.label}</Badge>
                  <span className="text-muted-foreground hidden md:inline">
                    Atualizado: {formatDateTime(period.updated_at)}
                  </span>
                </div>
              )}
              {!period && !loading && (
                <Button onClick={handleCreatePeriod} disabled={creating} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Novo Período
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cards de resumo */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard title="Vendido" value={formatCurrency(totals.vendido)} />
          <SummaryCard title="Recebido" value={formatCurrency(0)} />
          <SummaryCard title="Custo" value={formatCurrency(0)} />
          <SummaryCard title="Taxa" value={`${totals.taxaPct.toFixed(2).replace('.', ',')}%`} />
        </div>

        {/* Cards iFood + Voucher */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PlaceholderCard
            title="iFood (Cresol)"
            onOpen={() => navigate('/admin/auditoria/ifood')}
          />
          <PlaceholderCard
            title="Vouchers (BB)"
            onOpen={() => navigate('/admin/auditoria/voucher')}
          />
        </div>

        {/* Importações */}
        <Card>
          <CardHeader><CardTitle className="text-base">Importações do período</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(['maquinona', 'cresol', 'bb'] as const).map(t => {
              const imp = importByType(t);
              const isCompleted = imp?.status === 'completed';
              return (
                <div key={t} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    <span className="font-medium">{FILE_LABELS[t]}</span>
                    {isCompleted && imp ? (
                      <Badge variant="secondary" className="bg-green-500/15 text-green-700 dark:text-green-400">
                        ✓ importado em {formatDateTime(imp.created_at)} ({imp.imported_rows} transações)
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">não importado</Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!period}
                    onClick={() => navigate(`/admin/auditoria/importar?tipo=${t}`)}
                  >
                    {isCompleted ? 'Re-importar' : 'Importar'}
                  </Button>
                </div>
              );
            })}
            {!period && (
              <p className="text-xs text-muted-foreground pt-1">
                Crie o período acima antes de importar arquivos.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">{title}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function PlaceholderCard({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Nenhum dado importado ainda.</p>
        <Button variant="ghost" size="sm" className="gap-1 text-primary" onClick={onOpen}>
          Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
