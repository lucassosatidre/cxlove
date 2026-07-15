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
import { useCashflowUpcomingBillsDaily } from '@/hooks/useCashflowAnalytics';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDDMM(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

const OPEN_START_ISO = '2026-07-14';

type Item = { categoria: string; fornecedor: string | null; descricao: string | null; valor: number };

export default function PagamentosDeHoje() {
  const hojeISO = useMemo(() => toISOLocal(new Date()), []);
  const days = useMemo(() => {
    const start = new Date(`${OPEN_START_ISO}T00:00:00`);
    const today = new Date(`${hojeISO}T00:00:00`);
    const diff = Math.floor((today.getTime() - start.getTime()) / 86400000);
    return Math.max(1, diff + 1);
  }, [hojeISO]);
  // janela: 14/07/2026 → hoje
  const daily = useCashflowUpcomingBillsDaily(OPEN_START_ISO, days);
  const balances = useCashflowBalances();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { total, n, itemsByDay } = useMemo(() => {
    const rows = (daily.data ?? []) as Array<{ date: string; total: number; n: number; items: Item[] }>;
    let tot = 0;
    let nn = 0;
    const byDay: Array<{ date: string; items: Item[] }> = [];
    for (const r of rows) {
      tot += Number(r.total) || 0;
      nn += Number(r.n) || 0;
      byDay.push({ date: r.date, items: r.items ?? [] });
    }
    return { total: tot, n: nn, itemsByDay: byDay };
  }, [daily.data]);

  const ownSum = useMemo(() => {
    if (!balances.data) return null;
    return balances.data
      .filter((a) => !a.is_passthrough)
      .reduce((s, a) => s + Number(a.balance?.own_balance ?? 0), 0);
  }, [balances.data]);

  const projectedSaldo = ownSum === null ? null : ownSum - total;

  const sortedRows = useMemo(() => {
    const rows: Array<{ date: string; item: Item }> = [];
    for (const d of itemsByDay) for (const it of d.items) rows.push({ date: d.date, item: it });
    rows.sort((a, b) => Math.abs(b.item.valor) - Math.abs(a.item.valor));
    return rows;
  }, [itemsByDay]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-saipos-financeiro', { body: {} });
      if (error) throw error;
      toast.success(`Sincronizado: ${data?.total_upserted ?? 0} lançamentos`);
      await queryClient.invalidateQueries({ queryKey: ['cashflow', 'upcoming-bills-daily'] });
    } catch (err: any) {
      toast.error(`Falha ao sincronizar: ${err?.message || err}`);
    } finally {
      setSyncing(false);
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
              Vencidos desde 14/07 + hoje
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
                onClick={handleSync}
                disabled={syncing}
                aria-label="Sincronizar Saipos"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sincronizar Saipos agora</TooltipContent>
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
                Total a pagar (ontem + hoje)
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
              <p className="text-xs text-muted-foreground py-2">Nenhuma conta em aberto de ontem ou hoje.</p>
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
                    {sortedRows.map((r, i) => {
                      const isOntem = r.date === ontemISO;
                      return (
                        <TableRow key={i}>
                          <TableCell className="py-2 text-xs">
                            <span className={cn(isOntem && 'text-amber-600 dark:text-amber-400 font-medium')}>
                              {fmtDDMM(r.date)}
                              {isOntem && ' (ontem)'}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-xs" title={r.item.descricao || r.item.fornecedor || '—'}>
                            {r.item.descricao || r.item.fornecedor || '—'}
                          </TableCell>
                          <TableCell className="py-2 text-xs" title={r.item.categoria || 'Sem categoria'}>
                            {r.item.categoria || 'Sem categoria'}
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono text-xs whitespace-nowrap">
                            {fmtBRL(Math.abs(r.item.valor))}
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
