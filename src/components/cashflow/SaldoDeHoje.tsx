import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Wallet, AlertTriangle, Info } from 'lucide-react';
import { useCashflowBalances, fmtBRL, type AccountWithBalance } from '@/hooks/useCashflowBalances';
import { cn } from '@/lib/utils';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const moneyClass = (n: number) =>
  n < 0 ? 'text-destructive' : n > 0 ? 'text-foreground' : 'text-muted-foreground';

function AccountRow({ acc }: { acc: AccountWithBalance }) {
  const b = acc.balance;
  const own = Number(b?.own_balance ?? 0);
  const prov = Number(b?.provisioned ?? 0);
  const limit = Number(acc.overdraft_limit ?? 0);
  const limAvail = Number(b?.limit_available ?? 0);
  const limUsed = Math.max(0, limit - limAvail);
  const limPct = limit > 0 ? Math.min(100, (limUsed / limit) * 100) : 0;

  const realAfterProv = own - prov;
  const limiteEsgotado = limAvail === 0 && own < 0 && limit > 0;
  const vaiEstourar = realAfterProv < -limit;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm">{acc.name}</h4>
            {acc.bank && <Badge variant="outline" className="text-[10px]">{acc.bank}</Badge>}
            {acc.is_passthrough && <Badge variant="secondary" className="text-[10px]">passagem</Badge>}
            {limiteEsgotado && (
              <Badge variant="destructive" className="text-[10px]">🚨 limite esgotado</Badge>
            )}
            {vaiEstourar && !limiteEsgotado && (
              <Badge variant="destructive" className="text-[10px]">⚠ vai estourar o limite</Badge>
            )}
          </div>
          {b?.note && (
            <p className="text-[11px] text-muted-foreground mt-1 italic">{b.note}</p>
          )}
        </div>
        <div className={cn('text-right font-mono text-lg font-semibold tabular-nums', moneyClass(own))}>
          {fmtBRL(own)}
        </div>
      </div>

      {limit > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Limite usado</span>
            <span className="font-mono">
              {fmtBRL(limUsed)} de {fmtBRL(limit)}
            </span>
          </div>
          <Progress value={limPct} className="h-1.5" />
        </div>
      )}

      {prov > 0 && (
        <div className="flex items-center justify-between rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
          <span className="text-xs font-medium text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            A pagar hoje
          </span>
          <span className="font-mono text-sm font-semibold text-destructive">{fmtBRL(prov)}</span>
        </div>
      )}
    </div>
  );
}

export default function SaldoDeHoje() {
  const { data, isLoading, error } = useCashflowBalances();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Carregando saldos…
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">
          Erro ao carregar saldos.
        </CardContent>
      </Card>
    );
  }

  const totals = data.reduce(
    (acc, a) => {
      const b = a.balance;
      if (!b) return acc;
      acc.own += Number(b.own_balance ?? 0);
      acc.prov += Number(b.provisioned ?? 0);
      acc.limAvail += Number(b.limit_available ?? 0);
      return acc;
    },
    { own: 0, prov: 0, limAvail: 0 }
  );
  const real = totals.own - totals.prov;

  const asOf = data.map((d) => d.balance?.as_of).filter(Boolean).sort().pop() as string | undefined;

  // Group by company
  const groups = new Map<string, AccountWithBalance[]>();
  for (const a of data) {
    const key = a.company || 'Outros';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const companyOrder = ['Estrela', 'Propósito', 'Proposito', 'Prover'];
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const ia = companyOrder.indexOf(a[0]);
    const ib = companyOrder.indexOf(b[0]);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">Saldo de hoje</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Referência: {fmtDate(asOf)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Painel-resumo do grupo */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Caixa próprio agora
            </div>
            <div className={cn('mt-2 font-mono text-2xl font-bold tabular-nums', moneyClass(totals.own))}>
              {fmtBRL(totals.own)}
            </div>
          </div>
          <div className="rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4">
            <div className="text-[11px] uppercase tracking-wider text-destructive font-medium">
              Depois do que já vai sair hoje
            </div>
            <div className={cn('mt-2 font-mono text-2xl font-bold tabular-nums', moneyClass(real))}>
              {fmtBRL(real)}
            </div>
          </div>
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Limite ainda disponível no grupo
            </div>
            <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-foreground">
              {fmtBRL(totals.limAvail)}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Limite não é dinheiro, é dívida.</strong> O valor "depois do que já vai sair" é
            o que realmente sobra do nosso caixa próprio depois das contas já provisionadas.
          </span>
        </div>

        {/* Contas agrupadas por empresa */}
        <div className="space-y-5">
          {sortedGroups.map(([company, accs]) => (
            <div key={company} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {company}
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {accs.map((a) => (
                  <AccountRow key={a.id} acc={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
