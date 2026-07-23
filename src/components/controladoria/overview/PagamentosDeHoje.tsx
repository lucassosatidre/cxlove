import { useMemo, useState } from 'react';
import { CalendarCheck, ChevronDown, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtBRL, useCashflowBalances } from '@/hooks/useCashflowBalances';
import { useCtrlUpcomingBillsDaily, type CtrlBillRow } from '@/hooks/useCtrlCashflowAnalytics';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDDMM(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export default function PagamentosDeHoje() {
  const hojeISO = useMemo(() => toISOLocal(new Date()), []);
  const daily = useCtrlUpcomingBillsDaily();
  const balances = useCashflowBalances();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const total = daily.data?.total ?? 0;
  const n = daily.data?.n ?? 0;
  const items: CtrlBillRow[] = daily.data?.items ?? [];

  const ownSum = useMemo(() => {
    if (!balances.data) return null;
    return balances.data
      .filter((a) => !a.is_passthrough)
      .reduce((s, a) => s + Number(a.balance?.own_balance ?? 0), 0);
  }, [balances.data]);

  const projectedSaldo = ownSum === null ? null : ownSum - total;

  const sortedRows = useMemo(() => {
    return [...items].sort((a, b) => b.amount - a.amount);
  }, [items]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['ctrl', 'upcoming-daily'] });
      toast.success('Atualizado');
    } catch (err: any) {
      toast.error(`Falha ao atualizar: ${err?.message || err}`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Pagamentos de hoje</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Vencidos + hoje (contas a pagar)
            </p>
          </div>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="Atualizar"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atualizar</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardHeader>
      <CardContent className="space-y-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'w-full rounded-lg border bg-card text-left p-4 hover:bg-muted/40 transition-colors',
            open ? 'border-primary' : 'border-border/60',
          )}
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Total em aberto (vencidos + hoje)
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {fmtBRL(total)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {n} {n === 1 ? 'conta' : 'contas'}
              </div>
            </div>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              ver detalhes
              <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
            </span>
          </div>
        </button>

        {open && (
          <div className="rounded-lg border border-border/60 bg-card p-4">
            {sortedRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nenhuma conta em aberto.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 w-24">Vencimento</TableHead>
                      <TableHead className="h-8">Descrição</TableHead>
                      <TableHead className="h-8">Categoria</TableHead>
                      <TableHead className="h-8 w-32 text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((r) => {
                      const isVencida = r.vencimento < hojeISO;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="py-2 text-xs">
                            <span className={cn(isVencida && 'text-destructive font-medium')}>
                              {fmtDDMM(r.vencimento)}
                              {isVencida && ' (vencida)'}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-xs" title={r.descricao || r.fornecedor || '—'}>
                            {r.descricao || r.fornecedor || '—'}
                          </TableCell>
                          <TableCell className="py-2 text-xs" title={r.category || 'Sem categoria'}>
                            {r.category || 'Sem categoria'}
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono text-xs whitespace-nowrap">
                            {fmtBRL(r.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="mt-4 border-t border-border/60 pt-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Previsão de saldo ao fim do dia:
                  </span>
                  {projectedSaldo === null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <span
                      className={cn(
                        'font-mono text-sm font-semibold tabular-nums',
                        projectedSaldo < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
                      )}
                    >
                      {fmtBRL(projectedSaldo)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
