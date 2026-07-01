import { useMemo, useState } from 'react';
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
import { fmtBRL } from '@/hooks/useCashflowBalances';
import {
  useCashflowUpcomingBills,
  useCashflowCategorySummary,
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

export default function ProximosPagamentos() {
  const today = useMemo(() => new Date(), []);
  const bills = useCashflowUpcomingBills();
  const inicioMesISO = useMemo(() => toISOLocal(new Date(today.getFullYear(), today.getMonth(), 1)), [today]);
  const hojeISO = useMemo(() => toISOLocal(today), [today]);
  const pagoMes = useCashflowCategorySummary(inicioMesISO, hojeISO);
  const totalPagoMes = useMemo(
    () => (pagoMes.data ?? []).reduce((s, r) => s + Math.abs(Number(r.total) || 0), 0),
    [pagoMes.data],
  );

  const [openFaixa, setOpenFaixa] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const { faixas, depois28 } = useMemo(() => {
    const rows = bills.data ?? [];
    const faixaDefs = [
      { key: 'w1', label: 'Vence em até 7 dias', weekIdx: 1 },
      { key: 'w2', label: 'Em 8 a 14 dias', weekIdx: 2 },
      { key: 'w3', label: 'Em 15 a 21 dias', weekIdx: 3 },
      { key: 'w4', label: 'Em 22 a 28 dias', weekIdx: 4 },
    ];

    function addDays(base: Date, days: number): Date {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      return d;
    }

    const ranges = faixaDefs.map(({ weekIdx }) => {
      const start = addDays(today, (weekIdx - 1) * 7 + 1);
      const end = addDays(today, weekIdx * 7);
      return `${fmtDDMM(toISOLocal(start))} a ${fmtDDMM(toISOLocal(end))}`;
    });

    const f: Record<string, Faixa> = {};
    faixaDefs.forEach(({ key, label }, i) => {
      f[key] = { key, label, rangeLabel: ranges[i], total: 0, n: 0, items: [] };
    });
    const depois: UpcomingBillRow[] = [];
    for (const r of rows) {
      const d = diffDays(parseISODateLocal(r.vencimento), today);
      const val = Math.abs(Number(r.amount) || 0);
      if (d < 1) continue; // hoje ou passado não entra na timeline futura
      const weekIdx = Math.ceil(d / 7);
      if (weekIdx >= 1 && weekIdx <= 4) {
        const key = faixaDefs[weekIdx - 1].key;
        f[key].total += val;
        f[key].n += 1;
        f[key].items.push(r);
      } else {
        depois.push(r);
      }
    }
    return { faixas: [f.w1, f.w2, f.w3, f.w4], depois28: depois };
  }, [bills.data, today]);


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
              {" "}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Card valor pago no mês oculto por solicitacao (2026-06-30) */}
        {/* <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 flex flex-col justify-between">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Valor pago durante esse mês
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">
              {fmtBRL(totalPagoMes)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">até hoje</div>
          </div>
        </div> */}


        {/* Timeline de 4 semanas futuras */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
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
                    {f.rangeLabel}
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

        {/* Tudo o que está lançado depois de 28 dias */}
        {depois28.length > 0 && (
          <Collapsible open={showAll} onOpenChange={setShowAll}>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              ver tudo o que está lançado ({depois28.length} contas depois de 28 dias)
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
                    {[...depois28]
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
