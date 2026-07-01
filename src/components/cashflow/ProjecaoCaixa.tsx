import { useMemo, useState } from 'react';
import { ChevronDown, TrendingUp, AlertTriangle, CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { fmtBRL, useCashflowBalances } from '@/hooks/useCashflowBalances';
import {
  useCashflowMonthlyConsolidated,
  useCashflowUpcomingBills,
  type UpcomingBillRow,
} from '@/hooks/useCashflowAnalytics';

const MONTH_LABEL = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmtMonthLabel(year: number, month0: number) {
  return `${MONTH_LABEL[month0]}/${String(year).slice(-2)}`;
}

function fmtDateBR(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(-2)}`;
}

// Mon-Sun week: returns the Monday (UTC-agnostic, using local date)
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0 sun .. 6 sat
  const diff = (dow + 6) % 7; // days since Monday
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

export default function ProjecaoCaixa() {
  const balances = useCashflowBalances();
  const consolidated = useCashflowMonthlyConsolidated();
  const bills = useCashflowUpcomingBills();

  // Saldo + limite total
  const { saldoAtual, limiteTotal, asOf } = useMemo(() => {
    const accs = balances.data ?? [];
    let saldo = 0;
    let limite = 0;
    let mostRecent: string | null = null;
    for (const a of accs) {
      const own = Number(a.balance?.own_balance ?? 0);
      saldo += own;
      limite += Number(a.overdraft_limit ?? 0);
      const ao = a.balance?.as_of ?? null;
      if (ao && (!mostRecent || ao > mostRecent)) mostRecent = ao;
    }
    return { saldoAtual: saldo, limiteTotal: limite, asOf: mostRecent };
  }, [balances.data]);

  // Médias últimos 3 meses (consolidado já exclui transferências internas)
  const { avgEntra, avgSai } = useMemo(() => {
    const rows = (consolidated.data ?? []).slice(-3);
    if (rows.length === 0) return { avgEntra: 0, avgSai: 0 };
    const e = rows.reduce((s, r) => s + (r.entradas || 0), 0) / rows.length;
    const s = rows.reduce((acc, r) => acc + Math.abs(r.saidas || 0), 0) / rows.length;
    return { avgEntra: Math.round(e), avgSai: Math.round(s) };
  }, [consolidated.data]);

  const [entraEdit, setEntraEdit] = useState<string>('');
  const [saiEdit, setSaiEdit] = useState<string>('');

  const entraMes = entraEdit === '' ? avgEntra : Number(entraEdit) || 0;
  const saiMes = saiEdit === '' ? avgSai : Number(saiEdit) || 0;

  // Projeção mês a mês até dezembro do ano corrente
  const today = new Date();
  const projecao = useMemo(() => {
    const rows: { label: string; entra: number; sai: number; saldoFim: number; isCurrent: boolean }[] = [];
    let saldo = saldoAtual;
    const y = today.getFullYear();
    const startMonth = today.getMonth(); // 0-11
    for (let m = startMonth; m <= 11; m++) {
      const isCurrent = m === startMonth;
      let entraM = entraMes;
      let saiM = saiMes;
      if (isCurrent) {
        const lastDay = new Date(y, m + 1, 0).getDate();
        const remaining = lastDay - today.getDate() + 1;
        const frac = Math.max(0, Math.min(1, remaining / lastDay));
        entraM = entraMes * frac;
        saiM = saiMes * frac;
      }
      saldo = saldo + entraM - saiM;
      rows.push({
        label: fmtMonthLabel(y, m),
        entra: entraM,
        sai: saiM,
        saldoFim: saldo,
        isCurrent,
      });
    }
    return rows;
  }, [saldoAtual, entraMes, saiMes, today.getMonth(), today.getFullYear(), today.getDate()]);

  // Contas a pagar próximas 8 semanas
  const weeks = useMemo(() => {
    const start = startOfWeek(today);
    const buckets: {
      key: string;
      start: Date;
      end: Date;
      total: number;
      items: UpcomingBillRow[];
    }[] = [];
    for (let i = 0; i < 8; i++) {
      const s = addDays(start, i * 7);
      buckets.push({
        key: weekKey(s),
        start: s,
        end: addDays(s, 6),
        total: 0,
        items: [],
      });
    }
    const map = new Map(buckets.map((b) => [b.key, b]));
    for (const bill of bills.data ?? []) {
      const d = parseISODateLocal(bill.vencimento);
      const k = weekKey(d);
      const b = map.get(k);
      if (!b) continue;
      b.total += Math.abs(bill.amount);
      b.items.push(bill);
    }
    for (const b of buckets) b.items.sort((a, z) => Math.abs(z.amount) - Math.abs(a.amount));
    return buckets;
  }, [bills.data, today.getDate(), today.getMonth(), today.getFullYear()]);

  const nextWeek = weeks[1];

  return (
    <section className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-4 w-4" /> Projeção rolante de saldo
        </h3>
      </div>

      {/* Saldo + Limite */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-muted/30 p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Saldo atual do grupo
          </div>
          <div className="mt-1 font-brand text-3xl text-primary">{fmtBRL(saldoAtual)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {asOf ? `saldo do último extrato — ${fmtDateBR(asOf)}` : 'sem extrato carregado'}
          </div>
        </div>
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Limite total disponível
          </div>
          <div className="mt-1 font-brand text-3xl text-primary">{fmtBRL(limiteTotal)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            soma de cheque especial das contas (BB + Cresol + …)
          </div>
        </div>
      </div>

      {/* Editáveis */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <Label htmlFor="entra-mes" className="text-xs uppercase tracking-wider text-muted-foreground">
            Entra por mês (média)
          </Label>
          <Input
            id="entra-mes"
            type="number"
            inputMode="decimal"
            value={entraEdit}
            placeholder={String(avgEntra)}
            onChange={(e) => setEntraEdit(e.target.value)}
            className="mt-2 font-mono"
          />
          <div className="mt-1 text-xs text-muted-foreground">
            default: média dos últimos 3 meses ({fmtBRL(avgEntra)})
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <Label htmlFor="sai-mes" className="text-xs uppercase tracking-wider text-muted-foreground">
            Sai por mês (média)
          </Label>
          <Input
            id="sai-mes"
            type="number"
            inputMode="decimal"
            value={saiEdit}
            placeholder={String(avgSai)}
            onChange={(e) => setSaiEdit(e.target.value)}
            className="mt-2 font-mono"
          />
          <div className="mt-1 text-xs text-muted-foreground">
            default: média dos últimos 3 meses ({fmtBRL(avgSai)})
          </div>
        </div>
      </div>

      {/* Projeção mensal */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="border-b border-border/60 bg-muted/30 px-4 py-3">
          <div className="text-sm font-semibold">Projeção mês a mês (até dezembro)</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Entra</TableHead>
              <TableHead className="text-right">Sai</TableHead>
              <TableHead className="text-right">Saldo projetado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projecao.map((r) => {
              const negativo = r.saldoFim < 0;
              const estoura = r.saldoFim < -limiteTotal;
              return (
                <TableRow key={r.label}>
                  <TableCell className="font-medium">
                    {r.label}
                    {r.isCurrent && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        parcial
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {fmtBRL(r.entra)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-destructive">
                    −{fmtBRL(r.sai)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono font-semibold ${
                      negativo ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    <div className="flex items-center justify-end gap-2">
                      {fmtBRL(r.saldoFim)}
                      {estoura && (
                        <Badge variant="destructive" className="text-[10px]">
                          🚨 estoura o limite
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Contas a pagar por semana */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <CalendarDays className="h-4 w-4" /> Contas a pagar — próximas 8 semanas
          </h4>
        </div>

        {nextWeek && (
          <div className="mb-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Semana que vem ({fmtDateBR(toISO(nextWeek.start))} a {fmtDateBR(toISO(nextWeek.end))})
            </div>
            <div className="mt-1 font-brand text-2xl text-primary">
              {fmtBRL(nextWeek.total)} a pagar
            </div>
          </div>
        )}

        <div className="space-y-2">
          {weeks.map((w) => (
            <Collapsible key={w.key}>
              <div className="rounded-lg border border-border/60 bg-card">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex h-auto w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
                    disabled={w.items.length === 0}
                  >
                    <div className="flex items-center gap-3">
                      <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                      <span className="text-sm font-medium">
                        Semana de {fmtDateBR(toISO(w.start))}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({w.items.length} {w.items.length === 1 ? 'conta' : 'contas'})
                      </span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-destructive">
                      {w.total > 0 ? `−${fmtBRL(w.total)}` : '—'}
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {w.items.length > 0 && (
                    <div className="border-t border-border/60 px-4 py-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-8">Venc.</TableHead>
                            <TableHead className="h-8">Categoria</TableHead>
                            <TableHead className="h-8">Descrição</TableHead>
                            <TableHead className="h-8 text-right">Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {w.items.slice(0, 15).map((it, i) => (
                            <TableRow key={i}>
                              <TableCell className="py-2 font-mono text-xs">
                                {fmtDateBR(it.vencimento)}
                              </TableCell>
                              <TableCell className="py-2 text-xs">
                                {it.category || '—'}
                              </TableCell>
                              <TableCell className="py-2 text-xs">
                                {it.descricao || it.fornecedor || '—'}
                              </TableCell>
                              <TableCell className="py-2 text-right font-mono text-xs text-destructive">
                                −{fmtBRL(Math.abs(it.amount))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {w.items.length > 15 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          + {w.items.length - 15} contas menores
                        </div>
                      )}
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <strong>Saldo</strong> = do último extrato que você subiu. <strong>Entra/Sai</strong> = média
        dos últimos 3 meses (ajustável acima). <strong>Contas a pagar</strong> = o que já está
        lançado no Saipos (pode entrar mais ao longo do mês).
      </div>

      {(saldoAtual < 0 || projecao.some((p) => p.saldoFim < 0)) && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Atenção: a projeção indica saldo negativo em algum mês. Reveja as médias ou antecipe
            recebíveis.
          </span>
        </div>
      )}
    </section>
  );
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
