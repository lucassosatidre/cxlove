import { useMemo, useState } from 'react';
import { CalendarCheck, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDDMM(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export default function PagamentosDeHoje() {
  const hojeISO = useMemo(() => toISOLocal(new Date()), []);
  const daily = useCashflowUpcomingBillsDaily(hojeISO, 1);
  const balances = useCashflowBalances();
  const [open, setOpen] = useState(false);

  const { total, n, items } = useMemo(() => {
    const row = (daily.data ?? [])[0];
    if (!row) return { total: 0, n: 0, items: [] as Array<{ categoria: string; fornecedor: string | null; descricao: string | null; valor: number }> };
    return { total: Number(row.total) || 0, n: Number(row.n) || 0, items: row.items ?? [] };
  }, [daily.data]);

  const ownSum = useMemo(() => {
    if (!balances.data) return null;
    return balances.data
      .filter((a) => !a.is_passthrough)
      .reduce((s, a) => s + Number(a.balance?.own_balance ?? 0), 0);
  }, [balances.data]);

  const projectedSaldo = ownSum === null ? null : ownSum - total;

  const sorted = useMemo(
    () => [...items].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    [items],
  );

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Pagamentos de hoje</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Vencendo em {fmtDDMM(hojeISO)}</p>
          </div>
        </div>
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
                Total a pagar hoje
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
            {sorted.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nenhuma conta vencendo hoje.</p>
            ) : (
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
                  {sorted.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="py-2 text-xs">{fmtDDMM(hojeISO)}</TableCell>
                      <TableCell className="py-2 text-xs" title={it.descricao || it.fornecedor || '—'}>
                        {it.descricao || it.fornecedor || '—'}
                      </TableCell>
                      <TableCell className="py-2 text-xs" title={it.categoria || 'Sem categoria'}>
                        {it.categoria || 'Sem categoria'}
                      </TableCell>
                      <TableCell className="py-2 text-right font-mono text-xs whitespace-nowrap">
                        {fmtBRL(Math.abs(it.valor))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
