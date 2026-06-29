import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { fmtBRL, useCashflowBalances } from '@/hooks/useCashflowBalances';
import {
  useCashflowUpcomingBills,
  useCashflowUpcomingBillsDaily,
  type UpcomingBillRow,
  type UpcomingBillDayRow,
} from '@/hooks/useCashflowAnalytics';

type ViewMode = 'dia' | 'semana' | 'mes';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// === Helpers (mesma matemática local de ProjecaoCaixa.tsx) ===
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  const diff = (dow + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function weekKey(d: Date): string {
  const m = startOfWeek(d);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}
function parseISODateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDDMM(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Bucket = {
  key: string;
  label: string;
  total: number;
  n: number;
  saldoApos: number;
  items: { categoria: string; fornecedor: string | null; valor: number }[];
};

export default function ProximosPagamentos() {
  const [view, setView] = useState<ViewMode>('dia');

  const balances = useCashflowBalances();
  const today = new Date();
  const hojeISO = toISOLocal(today);

  const daily = useCashflowUpcomingBillsDaily(hojeISO, 14);
  const bills = useCashflowUpcomingBills();

  const { saldoAtual, limiteTotal } = useMemo(() => {
    const accs = balances.data ?? [];
    let s = 0;
    let l = 0;
    for (const a of accs) {
      s += Number(a.balance?.own_balance ?? 0);
      l += Number(a.overdraft_limit ?? 0);
    }
    return { saldoAtual: s, limiteTotal: l };
  }, [balances.data]);

  const folgaInicial = saldoAtual + limiteTotal;

  const buckets: Bucket[] = useMemo(() => {
    let running = folgaInicial;

    if (view === 'dia') {
      const rows = daily.data ?? [];
      const amanha = toISOLocal(addDays(today, 1));
      return rows.map((r: UpcomingBillDayRow) => {
        const d = parseISODateLocal(r.date);
        let label: string;
        if (r.date === hojeISO) label = 'Hoje';
        else if (r.date === amanha) label = 'Amanhã';
        else label = `${DIAS_SEM[d.getDay()]} ${fmtDDMM(d)}`;
        const saldoApos = running - r.total;
        running = saldoApos;
        return {
          key: r.date,
          label,
          total: r.total,
          n: r.n,
          saldoApos,
          items: r.items.map((it) => ({
            categoria: it.categoria,
            fornecedor: it.fornecedor,
            valor: it.valor,
          })),
        };
      });
    }

    if (view === 'semana') {
      const start = startOfWeek(today);
      const slots: { key: string; start: Date; end: Date; items: UpcomingBillRow[] }[] = [];
      for (let i = 0; i < 8; i++) {
        const s = addDays(start, i * 7);
        slots.push({ key: weekKey(s), start: s, end: addDays(s, 6), items: [] });
      }
      const map = new Map(slots.map((b) => [b.key, b]));
      for (const bill of bills.data ?? []) {
        const d = parseISODateLocal(bill.vencimento);
        const k = weekKey(d);
        const b = map.get(k);
        if (!b) continue;
        b.items.push(bill);
      }
      return slots.map((b) => {
        const sorted = [...b.items].sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
        const total = sorted.reduce((s, it) => s + Math.abs(it.amount), 0);
        const saldoApos = running - total;
        running = saldoApos;
        return {
          key: b.key,
          label: `Semana de ${fmtDDMM(b.start)}`,
          total,
          n: sorted.length,
          saldoApos,
          items: sorted.map((it) => ({
            categoria: it.category || 'Sem categoria',
            fornecedor: it.fornecedor,
            valor: Math.abs(it.amount),
          })),
        };
      });
    }

    // mes
    const byMonth = new Map<string, UpcomingBillRow[]>();
    for (const bill of bills.data ?? []) {
      const k = bill.vencimento.slice(0, 7);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k)!.push(bill);
    }
    const keys = Array.from(byMonth.keys()).sort();
    return keys.map((k) => {
      const items = (byMonth.get(k) ?? []).sort(
        (x, y) => Math.abs(y.amount) - Math.abs(x.amount),
      );
      const total = items.reduce((s, it) => s + Math.abs(it.amount), 0);
      const [y, m] = k.split('-').map(Number);
      const label = `${MESES[(m || 1) - 1]}/${String(y).slice(-2)}`;
      const saldoApos = running - total;
      running = saldoApos;
      return {
        key: k,
        label,
        total,
        n: items.length,
        saldoApos,
        items: items.map((it) => ({
          categoria: it.category || 'Sem categoria',
          fornecedor: it.fornecedor,
          valor: Math.abs(it.amount),
        })),
      };
    });
  }, [view, daily.data, bills.data, folgaInicial, hojeISO]);

  const totalPeriodo = buckets.reduce((s, b) => s + b.total, 0);
  const isLoading = view === 'dia' ? daily.isLoading : bills.isLoading;

  const periodoLabel =
    view === 'dia' ? 'próximos 14 dias' : view === 'semana' ? 'próximas 8 semanas' : 'próximos meses';

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex flex-row items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Próximos pagamentos</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mostra só as <strong>saídas já agendadas no Saipos</strong>. O saldo projetado é
                caixa próprio + limite menos as contas que vencem — ainda <strong>não</strong>{' '}
                inclui o que vai entrar (recebíveis).
              </p>
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            {(['dia', 'semana', 'mes'] as ViewMode[]).map((v) => (
              <Button
                key={v}
                variant={view === v ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView(v)}
              >
                {v === 'dia' ? 'Dia' : v === 'semana' ? 'Semana' : 'Mês'}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              A pagar nos {periodoLabel}
            </div>
            <div className="mt-1 font-mono text-xl font-semibold text-destructive">
              −{fmtBRL(totalPeriodo)}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Saldo + limite hoje
            </div>
            <div className="mt-1 font-mono text-xl font-semibold text-foreground">
              {fmtBRL(folgaInicial)}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : buckets.length === 0 || (view !== 'dia' && totalPeriodo === 0) ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma conta agendada no Saipos para este período.
          </div>
        ) : (
          <div className="space-y-2">
            {buckets.map((b) => {
              const empty = b.total <= 0;
              const negativo = b.saldoApos < 0;
              const trigger = (
                <Button
                  variant="ghost"
                  className="flex h-auto w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
                  disabled={empty}
                >
                  <div className="flex items-center gap-3">
                    {!empty && (
                      <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                    )}
                    {empty && <span className="inline-block w-4" />}
                    <span className={`text-sm font-medium ${empty ? 'text-muted-foreground' : ''}`}>
                      {b.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {empty
                        ? 'sem contas'
                        : `(${b.n} ${b.n === 1 ? 'conta' : 'contas'})`}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span
                      className={`font-mono text-sm font-semibold ${
                        empty ? 'text-muted-foreground' : 'text-destructive'
                      }`}
                    >
                      {empty ? '—' : `−${fmtBRL(b.total)}`}
                    </span>
                    {!empty && (
                      <span
                        className={`flex items-center gap-1 text-[11px] font-mono ${
                          negativo
                            ? 'text-destructive'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        sobra projetada: {fmtBRL(b.saldoApos)}
                        {negativo && (
                          <Badge variant="destructive" className="text-[10px]">
                            🚨
                          </Badge>
                        )}
                      </span>
                    )}
                  </div>
                </Button>
              );

              return (
                <Collapsible key={b.key}>
                  <div
                    className={`rounded-lg border bg-card ${
                      empty ? 'border-border/40 opacity-70' : 'border-border/60'
                    }`}
                  >
                    {empty ? (
                      trigger
                    ) : (
                      <>
                        <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t border-border/60 px-4 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="h-8">Categoria</TableHead>
                                  <TableHead className="h-8">Fornecedor</TableHead>
                                  <TableHead className="h-8 text-right">Valor</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {b.items.slice(0, 15).map((it, i) => (
                                  <TableRow key={i}>
                                    <TableCell className="py-2 text-xs">
                                      {it.categoria}
                                    </TableCell>
                                    <TableCell className="py-2 text-xs">
                                      {it.fornecedor || '—'}
                                    </TableCell>
                                    <TableCell className="py-2 text-right font-mono text-xs text-destructive">
                                      −{fmtBRL(it.valor)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {b.items.length > 15 && (
                              <div className="mt-2 text-xs text-muted-foreground">
                                + {b.items.length - 15} contas menores
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </>
                    )}
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
