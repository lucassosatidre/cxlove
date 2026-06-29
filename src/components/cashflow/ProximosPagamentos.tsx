import { useMemo, useState, useEffect } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { fmtBRL, useCashflowBalances } from '@/hooks/useCashflowBalances';
import {
  useCashflowUpcomingBills,
  type UpcomingBillRow,
} from '@/hooks/useCashflowAnalytics';
import { cn } from '@/lib/utils';

function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function diffDays(target: Date, base: Date): number {
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  return Math.round((t - b) / (1000 * 60 * 60 * 24));
}
function fmtDDMM(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

type Faixa = {
  key: string;
  label: string;
  rangeLabel: string;
  total: number;
  n: number;
  items: UpcomingBillRow[];
};

type OverdueAggr = { count: number; total: number; items: UpcomingBillRow[] };

export default function ProximosPagamentos() {
  const today = useMemo(() => new Date(), []);
  const balances = useCashflowBalances();
  const bills = useCashflowUpcomingBills();

  const [openFaixa, setOpenFaixa] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);

  const [overdue, setOverdue] = useState<OverdueAggr>({ count: 0, total: 0, items: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hojeISO = toISOLocal(today);
      const { data, error } = await supabase
        .from('cashflow_saipos')
        .select('vencimento, amount, category, fornecedor, is_frente_caixa, paid')
        .eq('paid', false)
        .lt('amount', 0)
        .lt('vencimento', hojeISO)
        .order('vencimento', { ascending: false })
        .limit(500);
      if (error || cancelled) return;
      const rows = (data ?? []).filter((r: any) => !r.is_frente_caixa);
      const total = rows.reduce((s: number, r: any) => s + Math.abs(Number(r.amount) || 0), 0);
      setOverdue({
        count: rows.length,
        total,
        items: rows.map((r: any) => ({
          vencimento: String(r.vencimento),
          amount: Number(r.amount) || 0,
          category: r.category ?? null,
          fornecedor: r.fornecedor ?? null,
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const folego = useMemo(() => {
    const accs = (balances.data ?? []).filter((a) => !a.is_passthrough);
    let own = 0;
    let lim = 0;
    for (const a of accs) {
      own += Number(a.balance?.own_balance ?? 0);
      lim += Number(a.overdraft_limit ?? 0);
    }
    return own + lim;
  }, [balances.data]);

  const { faixas, depois30 } = useMemo(() => {
    const rows = bills.data ?? [];
    const f: Record<string, Faixa> = {
      a: { key: 'a', label: 'Vence em até 7 dias', rangeLabel: 'hoje até +7', total: 0, n: 0, items: [] },
      b: { key: 'b', label: 'Em 8 a 14 dias', rangeLabel: '+8 a +14', total: 0, n: 0, items: [] },
      c: { key: 'c', label: 'Em 15 a 30 dias', rangeLabel: '+15 a +30', total: 0, n: 0, items: [] },
    };
    const depois: UpcomingBillRow[] = [];
    for (const r of rows) {
      const d = diffDays(parseISODateLocal(r.vencimento), today);
      const val = Math.abs(Number(r.amount) || 0);
      if (d < 0) continue; // overdue tratado à parte
      if (d <= 7) {
        f.a.total += val;
        f.a.n += 1;
        f.a.items.push(r);
      } else if (d <= 14) {
        f.b.total += val;
        f.b.n += 1;
        f.b.items.push(r);
      } else if (d <= 30) {
        f.c.total += val;
        f.c.n += 1;
        f.c.items.push(r);
      } else {
        depois.push(r);
      }
    }
    return { faixas: [f.a, f.b, f.c], depois30: depois };
  }, [bills.data, today]);

  const total7 = faixas[0].total;
  const falta = Math.max(0, total7 - folego);
  const folegoCobre = folego >= total7;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Próximos pagamentos</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mostra só as saídas já agendadas no Saipos; não inclui o que vai entrar (recebíveis).
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Linha-resumo (única que pode ficar vermelha) */}
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            folegoCobre
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          Pra cobrir os próximos 7 dias (<strong>{fmtBRL(total7)}</strong>) você tem{' '}
          <strong>{fmtBRL(folego)}</strong> de fôlego (caixa + limite).{' '}
          {folegoCobre ? (
            <span>E o fôlego cobre.</span>
          ) : (
            <span>
              Faltam <strong>{fmtBRL(falta)}</strong>.
            </span>
          )}
        </div>

        {/* 3 caixas neutras */}
        <div className="grid gap-3 md:grid-cols-3">
          {faixas.map((f) => {
            const isOpen = openFaixa === f.key;
            return (
              <div key={f.key} className="rounded-lg border border-border/60 bg-card">
                <button
                  type="button"
                  onClick={() => setOpenFaixa(isOpen ? null : f.key)}
                  className="w-full text-left p-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {f.label}
                  </div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">
                    {fmtBRL(f.total)}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {f.n} {f.n === 1 ? 'conta' : 'contas'}
                    </span>
                    <span className="flex items-center gap-1">
                      ver detalhes
                      <ChevronDown
                        className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')}
                      />
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border/60 px-4 py-3">
                    {f.items.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        Nenhuma conta nesta faixa.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-8">Vencimento</TableHead>
                            <TableHead className="h-8">Fornecedor</TableHead>
                            <TableHead className="h-8">Categoria</TableHead>
                            <TableHead className="h-8 text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...f.items]
                            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                            .slice(0, 30)
                            .map((it, i) => (
                              <TableRow key={i}>
                                <TableCell className="py-2 text-xs">
                                  {fmtDDMM(it.vencimento)}
                                </TableCell>
                                <TableCell className="py-2 text-xs">
                                  {it.fornecedor || '—'}
                                </TableCell>
                                <TableCell className="py-2 text-xs">
                                  {it.category || 'Sem categoria'}
                                </TableCell>
                                <TableCell className="py-2 text-right font-mono text-xs">
                                  {fmtBRL(Math.abs(it.amount))}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Vencidas em card neutro */}
        {overdue.count > 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/30">
            <button
              type="button"
              onClick={() => setOverdueOpen((v) => !v)}
              className="w-full text-left p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Contas vencidas ainda não pagas: {overdue.count} contas ·{' '}
                    <span className="font-mono">{fmtBRL(overdue.total)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Provavelmente lançamentos antigos sem baixa no Saipos — confira.
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    overdueOpen && 'rotate-180',
                  )}
                />
              </div>
            </button>
            {overdueOpen && (
              <div className="border-t border-border/60 px-4 py-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8">Vencimento</TableHead>
                      <TableHead className="h-8">Fornecedor</TableHead>
                      <TableHead className="h-8">Categoria</TableHead>
                      <TableHead className="h-8 text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...overdue.items]
                      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                      .slice(0, 50)
                      .map((it, i) => (
                        <TableRow key={i}>
                          <TableCell className="py-2 text-xs">{fmtDDMM(it.vencimento)}</TableCell>
                          <TableCell className="py-2 text-xs">{it.fornecedor || '—'}</TableCell>
                          <TableCell className="py-2 text-xs">
                            {it.category || 'Sem categoria'}
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono text-xs">
                            {fmtBRL(Math.abs(it.amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Tudo o que está lançado depois de 30 dias */}
        {depois30.length > 0 && (
          <Collapsible open={showAll} onOpenChange={setShowAll}>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              ver tudo o que está lançado ({depois30.length} contas depois de 30 dias)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8">Vencimento</TableHead>
                      <TableHead className="h-8">Fornecedor</TableHead>
                      <TableHead className="h-8">Categoria</TableHead>
                      <TableHead className="h-8 text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...depois30]
                      .sort(
                        (a, b) =>
                          parseISODateLocal(a.vencimento).getTime() -
                          parseISODateLocal(b.vencimento).getTime(),
                      )
                      .map((it, i) => (
                        <TableRow key={i}>
                          <TableCell className="py-2 text-xs">{fmtDDMM(it.vencimento)}</TableCell>
                          <TableCell className="py-2 text-xs">{it.fornecedor || '—'}</TableCell>
                          <TableCell className="py-2 text-xs">
                            {it.category || 'Sem categoria'}
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono text-xs">
                            {fmtBRL(Math.abs(it.amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
