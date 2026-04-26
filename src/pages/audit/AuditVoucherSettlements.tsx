import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { ArrowLeft, Loader2, Receipt, ListChecks } from 'lucide-react';
import { toast } from 'sonner';

type Operadora = 'pluxee' | 'alelo' | 'vr' | 'ticket';

type Lot = {
  id: string;
  operadora: string;
  external_id: string;
  data_pagamento: string;
  gross_amount: number;
  net_amount: number;
  fee_admin: number;
  fee_anticipation: number;
  fee_management: number;
  fee_other: number;
  modalidade: string | null;
  status: string;
  bb_deposit_id: string | null;
};

type Item = {
  id: string;
  lot_id: string;
  match_status: string;
  gross_amount: number;
};

type Adjustment = {
  id: string;
  operadora: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: string | null;
};

type Period = { id: string; month: number; year: number; status: string };

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const OP_LABEL: Record<Operadora, string> = {
  pluxee: 'Pluxee',
  alelo: 'Alelo',
  vr: 'VR',
  ticket: 'Ticket',
};

const fmtMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (n: number) => (n * 100).toFixed(2) + '%';

export default function AuditVoucherSettlements() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const periodIdParam = searchParams.get('period');
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const { isAdmin, loading: roleLoading } = useUserRole();

  const [period, setPeriod] = useState<Period | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNeutras, setShowNeutras] = useState(false);
  const [matching, setMatching] = useState(false);

  const backUrl = useMemo(() => {
    const m = monthParam ?? (period ? String(period.month) : '');
    const y = yearParam ?? (period ? String(period.year) : '');
    return m && y ? `/admin/auditoria/importar?month=${m}&year=${y}` : '/admin/auditoria';
  }, [monthParam, yearParam, period]);

  const load = async (periodId: string) => {
    const [{ data: lotsData }, { data: adjData }] = await Promise.all([
      supabase.from('voucher_lots').select('*').eq('audit_period_id', periodId).order('data_pagamento'),
      supabase.from('voucher_adjustments').select('*').eq('audit_period_id', periodId).order('data'),
    ]);
    const allLots = (lotsData as Lot[]) ?? [];
    setLots(allLots);
    setAdjustments((adjData as Adjustment[]) ?? []);

    if (allLots.length > 0) {
      const lotIds = allLots.map(l => l.id);
      const { data: itemsData } = await supabase
        .from('voucher_lot_items')
        .select('id,lot_id,match_status,gross_amount')
        .in('lot_id', lotIds);
      setItems((itemsData as Item[]) ?? []);
    } else {
      setItems([]);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      let p: Period | null = null;
      if (periodIdParam) {
        const { data } = await supabase.from('audit_periods').select('*').eq('id', periodIdParam).maybeSingle();
        p = (data as Period) ?? null;
      } else {
        const now = new Date();
        const { data } = await supabase.from('audit_periods').select('*')
          .eq('month', now.getMonth() + 1).eq('year', now.getFullYear()).maybeSingle();
        p = (data as Period) ?? null;
      }
      if (!active) return;
      setPeriod(p);
      if (p) await load(p.id);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, periodIdParam]);

  const runMatch = async () => {
    if (!period) return;
    setMatching(true);
    try {
      const { data, error } = await supabase.rpc('match_voucher_lots', { p_period_id: period.id });
      if (error) throw error;
      toast.success('✓ Conciliação rodada', {
        description: `${(data as any)?.matched_items ?? 0} itens, ${(data as any)?.matched_lots ?? 0} lotes ↔ BB`,
      });
      await load(period.id);
    } catch (e: any) {
      toast.error('Erro', { description: e?.message });
    } finally {
      setMatching(false);
    }
  };

  // Stats agregados por operadora
  const summary = useMemo(() => {
    const byOp: Record<Operadora, {
      grossLots: number;
      netLots: number;
      feeAdmin: number;
      feeAntecip: number;
      feeMgmt: number;
      feeOther: number;
      lotCount: number;
      bbMatched: number;
      itemMatched: number;
      itemTotal: number;
    }> = {
      pluxee: empty(), alelo: empty(), vr: empty(), ticket: empty(),
    };

    for (const l of lots) {
      const op = l.operadora as Operadora;
      if (!byOp[op]) continue;
      byOp[op].grossLots += Number(l.gross_amount);
      byOp[op].netLots += Number(l.net_amount);
      byOp[op].feeAdmin += Number(l.fee_admin || 0);
      byOp[op].feeAntecip += Number(l.fee_anticipation || 0);
      byOp[op].feeMgmt += Number(l.fee_management || 0);
      byOp[op].feeOther += Number(l.fee_other || 0);
      byOp[op].lotCount += 1;
      if (l.bb_deposit_id) byOp[op].bbMatched += 1;
    }

    const lotOpById = new Map(lots.map(l => [l.id, l.operadora as Operadora]));
    for (const it of items) {
      const op = lotOpById.get(it.lot_id);
      if (!op || !byOp[op]) continue;
      byOp[op].itemTotal += 1;
      if (it.match_status === 'matched') byOp[op].itemMatched += 1;
    }

    return byOp;
  }, [lots, items]);

  if (roleLoading || loading) {
    return (
      <AppLayout title="Voucher Settlements">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Voucher Settlements">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  if (!period) {
    return (
      <AppLayout title="Voucher Settlements">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Período não encontrado.</CardContent></Card>
      </AppLayout>
    );
  }

  const visibleAdjustments = adjustments.filter(a => showNeutras || a.tipo !== 'compensacao_neutra');

  return (
    <AppLayout title="Voucher Settlements" subtitle="Auditoria de Taxas — Extratos das Operadoras">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate(`/admin/auditoria?month=${period.month}&year=${period.year}`)} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate(backUrl)} className="cursor-pointer">Importação</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Voucher Settlements</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            Período: <span className="font-medium text-foreground">{MONTHS[period.month - 1]} {period.year}</span>
          </p>
          <Button onClick={runMatch} disabled={matching || lots.length === 0} size="sm" className="gap-2">
            {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
            Reconciliar
          </Button>
        </div>

        {lots.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhum extrato importado neste período. Volte para Importação e faça o upload dos arquivos das operadoras.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(Object.keys(summary) as Operadora[]).map(op => {
                const s = summary[op];
                if (s.lotCount === 0) return (
                  <Card key={op} className="opacity-60">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>{OP_LABEL[op]}</span>
                        <Badge variant="secondary" className="text-muted-foreground">sem dados</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      Importe o extrato {OP_LABEL[op]} para ver os números.
                    </CardContent>
                  </Card>
                );
                const fee = s.feeAdmin + s.feeAntecip + s.feeMgmt + s.feeOther;
                const efetiva = s.grossLots > 0 ? fee / s.grossLots : 0;
                return (
                  <Card key={op}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>{OP_LABEL[op]}</span>
                        <Badge variant="secondary" className={efetiva > 0.15 ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400' : 'bg-green-500/10 text-green-700 dark:text-green-400'}>
                          Taxa efetiva {fmtPct(efetiva)}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="Bruto" value={fmtMoney(s.grossLots)} />
                        <Stat label="Líquido" value={fmtMoney(s.netLots)} />
                        <Stat label="Custo total" value={fmtMoney(fee)} />
                        <Stat label="Lotes" value={`${s.lotCount} (${s.bbMatched} ↔ BB)`} />
                      </div>
                      <div className="rounded-md bg-muted/40 p-2 text-xs space-y-0.5">
                        <Decomp label="Admin" value={s.feeAdmin} />
                        {s.feeAntecip > 0 && <Decomp label="Antecipação" value={s.feeAntecip} />}
                        {s.feeMgmt > 0 && <Decomp label="Gestão (R$ fixo)" value={s.feeMgmt} />}
                        {s.feeOther > 0 && <Decomp label="Outras" value={s.feeOther} />}
                      </div>
                      {s.itemTotal > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Itens reconhecidos com Maquinona: <strong className="text-foreground">{s.itemMatched}</strong> de {s.itemTotal}
                          {' '}({((s.itemMatched / s.itemTotal) * 100).toFixed(0)}%)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Tarifas avulsas (Adjustments) */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Receipt className="h-4 w-4 text-primary" />
                    Tarifas avulsas e ajustes
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Switch id="show-neutras" checked={showNeutras} onCheckedChange={setShowNeutras} />
                    <Label htmlFor="show-neutras" className="text-xs cursor-pointer">Mostrar compensações neutras</Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {visibleAdjustments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum ajuste {showNeutras ? '' : 'não-neutro '}registrado.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Operadora</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleAdjustments.map(a => (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm font-mono-tabular">{formatDateBR(a.data)}</TableCell>
                          <TableCell><Badge variant="secondary">{OP_LABEL[a.operadora as Operadora] ?? a.operadora}</Badge></TableCell>
                          <TableCell className="text-sm">{a.descricao}</TableCell>
                          <TableCell>
                            <Badge variant={
                              a.tipo === 'anuidade' || a.tipo === 'mensalidade' ? 'destructive' :
                              a.tipo === 'compensacao_neutra' ? 'outline' : 'secondary'
                            } className="text-xs">
                              {a.tipo ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-right font-mono-tabular ${Number(a.valor) < 0 ? 'text-destructive' : 'text-foreground'}`}>
                            {fmtMoney(Number(a.valor))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Button variant="outline" onClick={() => navigate(backUrl)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar para Importação
        </Button>
      </div>
    </AppLayout>
  );
}

function empty() {
  return { grossLots: 0, netLots: 0, feeAdmin: 0, feeAntecip: 0, feeMgmt: 0, feeOther: 0, lotCount: 0, bbMatched: 0, itemMatched: 0, itemTotal: 0 };
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold font-mono-tabular text-foreground">{value}</p>
    </div>
  );
}
function Decomp({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono-tabular text-foreground">{fmtMoney(value)}</span>
    </div>
  );
}
function formatDateBR(s: string) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
