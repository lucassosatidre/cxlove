import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { useCashflowLoans } from '@/hooks/useCashflowLoans';
import { fmtBRL } from '@/hooks/useCashflowBalances';

const fmtMonth = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const fmtMonthFromISO = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${m}/${y}`;
};

export default function ProjecaoAlertas() {
  const { data, isLoading, error } = useCashflowLoans();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Projeção e alertas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Carregando…</CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Projeção e alertas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-destructive">Erro ao carregar empréstimos.</CardContent>
      </Card>
    );
  }

  const { loans, installments } = data;

  // A) Total da dívida
  const totalDebt = loans.reduce((s, l) => s + (Number(l.outstanding_balance) || 0), 0);

  // B) Próximos 12 meses (do mês atual em diante), apenas não pagas
  const now = new Date();
  const startKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: fmtMonth(d) });
  }
  const totalsByMonth = new Map<string, number>();
  for (const inst of installments) {
    if (inst.paid) continue;
    const key = inst.due_date.slice(0, 7); // YYYY-MM
    if (key < startKey) continue;
    totalsByMonth.set(key, (totalsByMonth.get(key) || 0) + Number(inst.amount || 0));
  }
  const timeline = months.map((m) => ({ ...m, total: totalsByMonth.get(m.key) || 0 }));
  const next6 = timeline.slice(0, 6).reduce((s, m) => s + m.total, 0);
  const maxInTimeline = Math.max(1, ...timeline.map((m) => m.total));

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <CardTitle className="text-base font-semibold">Projeção e alertas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* A) Suas dívidas hoje */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Suas dívidas hoje
          </h3>
          <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Total da dívida
            </div>
            <div className="mt-1 font-brand text-3xl text-primary">{fmtBRL(totalDebt)}</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {loans.map((l) => (
              <div key={l.id} className="rounded-xl border border-border/60 bg-card p-4">
                <div className="font-semibold">{l.name}</div>
                {l.contract && (
                  <div className="text-xs text-muted-foreground">{l.contract}</div>
                )}
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Saldo devedor</dt>
                    <dd className="font-medium">
                      {l.outstanding_balance != null ? fmtBRL(Number(l.outstanding_balance)) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Parcela mensal</dt>
                    <dd className="font-medium">
                      {l.monthly_payment != null ? fmtBRL(Number(l.monthly_payment)) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Restantes</dt>
                    <dd className="font-medium">{l.remaining_installments ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Termina</dt>
                    <dd className="font-medium">{l.last_due ? fmtMonthFromISO(l.last_due) : '—'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>

        {/* B) Compromissos próximos meses */}
        <section>
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Compromissos dos próximos meses (só empréstimos)
            </h3>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Próximos 6 meses
            </div>
            <div className="mt-1 font-brand text-2xl text-primary">{fmtBRL(next6)}</div>
          </div>

          <ul className="mt-4 space-y-1.5">
            {timeline.map((m) => (
              <li key={m.key} className="flex items-center gap-3 text-sm">
                <span className="w-16 font-mono text-xs text-muted-foreground">{m.label}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${(m.total / maxInTimeline) * 100}%` }}
                  />
                </div>
                <span className="w-32 text-right font-medium">{fmtBRL(m.total)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* C) Aviso */}
        <p className="rounded-md border border-dashed border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          Esta é a parte de <strong>dívidas</strong>. A projeção completa de caixa — tudo que entra
          menos tudo que sai, mês a mês, com alerta de quando o saldo vai apertar — entra quando
          carregarmos o histórico e os lançamentos futuros do Saipos.
        </p>
      </CardContent>
    </Card>
  );
}
