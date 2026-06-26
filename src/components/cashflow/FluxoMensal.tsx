import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/hooks/useCashflowBalances';
import { useCashflowMonthlySummary, useCashflowMonthlyConsolidated, type MonthlySummaryRow } from '@/hooks/useCashflowAnalytics';

const MESES_LOWER = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fmtMes = (a: number, m: number) => `${MESES[m - 1]}/${String(a).slice(2)}`;
const fmtYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES_LOWER[(m || 1) - 1]}/${String(y).slice(2)}`;
};
const colorClass = (n: number) => (n < 0 ? 'text-destructive font-medium' : n > 0 ? 'text-emerald-700 font-medium' : 'text-muted-foreground');

type MonthAgg = { ano: number; mes: number; entradas: number; saidas: number; sobrou: number };

export default function FluxoMensal() {
  const { data, isLoading } = useCashflowMonthlySummary();
  const { data: consolidated, isLoading: loadingCons } = useCashflowMonthlyConsolidated();
  const [open, setOpen] = useState(false);

  const consolidatedRows = useMemo(() => {
    return (consolidated ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym));
  }, [consolidated]);

  const byCompany = useMemo(() => {
    const rows = data ?? [];
    const map = new Map<string, Map<string, { row: MonthlySummaryRow[] }>>();
    for (const r of rows) {
      const co = r.company ?? '—';
      if (!map.has(co)) map.set(co, new Map());
      const accMap = map.get(co)!;
      const k = r.account_id;
      if (!accMap.has(k)) accMap.set(k, { row: [] });
      accMap.get(k)!.row.push(r);
    }
    return map;
  }, [data]);

  if (isLoading || loadingCons) {
    return (
      <Card className="border-border/60">
        <CardHeader><CardTitle className="text-base">Fluxo mensal</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Carregando…</p></CardContent>
      </Card>
    );
  }

  if (!consolidatedRows.length) {
    return (
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><TrendingUp className="h-5 w-5" /></div>
          <CardTitle className="text-base">Fluxo mensal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
            Importe os extratos na aba Importações para ver o fluxo.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><TrendingUp className="h-5 w-5" /></div>
        <CardTitle className="text-base">Fluxo mensal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Entrou</TableHead>
                <TableHead className="text-right">Saiu</TableHead>
                <TableHead className="text-right">Sobrou</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consolidatedRows.map((m) => {
                const sobrou = m.entradas + m.saidas;
                return (
                  <TableRow key={m.ym}>
                    <TableCell className="font-medium">{fmtYm(m.ym)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', colorClass(m.entradas))}>{fmtBRL(m.entradas)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', colorClass(m.saidas))}>{fmtBRL(m.saidas)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', colorClass(sobrou))}>{fmtBRL(sobrou)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong>Entrou</strong> = dinheiro recebido nas contas (sem empréstimos nem transferências entre suas contas).{' '}
          <strong>Saiu</strong> = pagamentos categorizados (Saipos). Dezembro/25 está incompleto (faltam dados de algumas contas).
        </p>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Detalhar por conta
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-5">
            {Array.from(byCompany.entries()).map(([company, accMap]) => (
              <div key={company} className="space-y-2">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{company}</h4>
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conta</TableHead>
                        <TableHead>Mês</TableHead>
                        <TableHead className="text-right">Entrou</TableHead>
                        <TableHead className="text-right">Saiu</TableHead>
                        <TableHead className="text-right">Sobrou</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from(accMap.values()).flatMap(({ row }) =>
                        row
                          .slice()
                          .sort((a, b) => a.ano - b.ano || a.mes - b.mes)
                          .map((r) => {
                            const sobrou = r.entradas + r.saidas;
                            return (
                              <TableRow key={`${r.account_id}-${r.ano}-${r.mes}`}>
                                <TableCell className="font-medium">{r.account_name}</TableCell>
                                <TableCell>{fmtMes(r.ano, r.mes)}</TableCell>
                                <TableCell className={cn('text-right tabular-nums', colorClass(r.entradas))}>{fmtBRL(r.entradas)}</TableCell>
                                <TableCell className={cn('text-right tabular-nums', colorClass(r.saidas))}>{fmtBRL(r.saidas)}</TableCell>
                                <TableCell className={cn('text-right tabular-nums', colorClass(sobrou))}>{fmtBRL(sobrou)}</TableCell>
                              </TableRow>
                            );
                          })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
