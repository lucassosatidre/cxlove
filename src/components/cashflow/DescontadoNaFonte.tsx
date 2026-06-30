import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Scissors } from 'lucide-react';
import { fmtBRL } from '@/hooks/useCashflowBalances';
import { useCashflowRetidoSummary } from '@/hooks/useCashflowAnalytics';

function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DescontadoNaFonte() {
  const { inicioMes, fimMes } = useMemo(() => {
    const now = new Date();
    const ini = new Date(now.getFullYear(), now.getMonth(), 1);
    const fim = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { inicioMes: toISOLocal(ini), fimMes: toISOLocal(fim) };
  }, []);

  const { data, isLoading } = useCashflowRetidoSummary(inicioMes, fimMes);

  const rows = useMemo(() => (data ?? []).slice().sort((a, b) => b.total - a.total), [data]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);

  return (
    <Card className="border-border/60 bg-muted/20">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-muted p-2 text-muted-foreground">
            <Scissors className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Descontado na fonte (não é conta que você paga)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tarifas e comissões já descontadas direto do repasse do iFood/cartão/Brendi — o dinheiro nem chega na conta, então não é uma conta a pagar (só pra você ver o custo).
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total descontado no mês</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-muted-foreground">
            {fmtBRL(total)}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada descontado na fonte neste mês.</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60 bg-card">
            {rows.map((r) => (
              <li key={r.category} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-foreground">{r.category}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{fmtBRL(r.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
