import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PieChart, Info } from 'lucide-react';
import { fmtBRL } from '@/hooks/useCashflowBalances';
import { useCashflowCategorySummary } from '@/hooks/useCashflowAnalytics';

function rangeFor(option: string): { start: string; end: string; label: string } {
  const today = new Date();
  if (option === '6m') {
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: 'Últimos 6 meses' };
  }
  // last month
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: 'Mês passado' };
}

export default function ParaOndeFoi() {
  const [opt, setOpt] = useState<string>('6m');
  const { start, end, label } = useMemo(() => rangeFor(opt), [opt]);
  const { data, isLoading } = useCashflowCategorySummary(start, end);

  const rows = useMemo(() => {
    const arr = (data ?? []).slice().sort((a, b) => a.total - b.total);
    return arr;
  }, [data]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);
  const maxAbs = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.total))), [rows]);

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><PieChart className="h-5 w-5" /></div>
            <CardTitle className="text-base">Para onde foi o dinheiro</CardTitle>
          </div>
          <Select value={opt} onValueChange={setOpt}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="last">Mês passado</SelectItem>
              <SelectItem value="6m">Últimos 6 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Não inclui transferências internas nem o "Frente de Caixa" (que é o fechamento das vendas, não um gasto).
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !rows.length ? (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
            Importe os extratos na aba Importações para ver o fluxo.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{label} · {rows.length} categorias</span>
              <span className="font-semibold tabular-nums text-destructive">{fmtBRL(total)}</span>
            </div>
            <ul className="space-y-2">
              {rows.map((r, i) => {
                const pct = Math.min(100, (Math.abs(r.total) / maxAbs) * 100);
                return (
                  <li key={`${r.company}-${r.category}-${i}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-medium">{r.category}</span>
                        {r.company && <Badge variant="outline" className="text-[10px]">{r.company}</Badge>}
                        <span className="text-xs text-muted-foreground shrink-0">({r.n})</span>
                      </div>
                      <span className="font-semibold tabular-nums text-destructive shrink-0">{fmtBRL(r.total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-[hsl(var(--accent))]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
