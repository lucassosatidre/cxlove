import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, AlertTriangle } from 'lucide-react';
import { useCashflowBalances, fmtBRL, type AccountWithBalance } from '@/hooks/useCashflowBalances';
import { cn } from '@/lib/utils';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const past = new Date(y, (m || 1) - 1, d || 1);
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((t.getTime() - past.getTime()) / (1000 * 60 * 60 * 24));
}

// Mapa de logos — vazio por enquanto, fácil de preencher depois com import de assets.
const BANK_LOGOS: Record<string, string> = {};

const BANK_STYLES: Record<string, { bg: string; fg: string; label: string; textSize: string }> = {
  BB:      { bg: '#FCEE21', fg: '#0033A0', label: 'BB',     textSize: 'text-sm' },
  Cresol:  { bg: '#00995D', fg: '#FFFFFF', label: 'Cresol', textSize: 'text-[10px]' },
  C6:      { bg: '#1A1A1A', fg: '#FFFFFF', label: 'C6',     textSize: 'text-sm' },
  iFood:   { bg: '#EA1D2C', fg: '#FFFFFF', label: 'iF',     textSize: 'text-sm' },
  Sicredi: { bg: '#3DAE2B', fg: '#FFFFFF', label: 'Si',     textSize: 'text-sm' },
};

function BankLogo({ bank, name }: { bank: string | null | undefined; name: string }) {
  const key = bank ?? '';
  const src = BANK_LOGOS[key];
  if (src) {
    return <img src={src} alt={name} className="h-10 w-10 object-contain" />;
  }
  const style = BANK_STYLES[key];
  if (style) {
    return (
      <div
        className={cn('h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0', style.textSize)}
        style={{ backgroundColor: style.bg, color: style.fg }}
        aria-label={name}
      >
        {style.label}
      </div>
    );
  }
  // Fallback genérico
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <div className="h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0 text-sm bg-muted text-muted-foreground">
      {initials}
    </div>
  );
}

function AccountRow({ acc }: { acc: AccountWithBalance }) {
  const b = acc.balance;
  const own = Number(b?.own_balance ?? 0);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <BankLogo bank={acc.bank} name={acc.name} />
        <h4 className="font-medium text-sm truncate">{acc.name}</h4>
      </div>
      <div className="text-right shrink-0">
        <div
          className={cn(
            'font-mono text-lg font-semibold tabular-nums',
            own < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
          )}
        >
          {fmtBRL(own)}
        </div>
        {acc.is_passthrough && (
          <div className="text-[10px] text-muted-foreground mt-0.5">conta de passagem</div>
        )}
      </div>
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

  // Apenas contas que NÃO são de passagem entram no caixa próprio
  const ownAccs = data.filter((a) => !a.is_passthrough);
  const ownSum = ownAccs.reduce((s, a) => s + Number(a.balance?.own_balance ?? 0), 0);
  const limitSum = ownAccs.reduce((s, a) => s + Number(a.overdraft_limit ?? 0), 0);
  const folego = ownSum + limitSum;

  // contas com saldo defasado (>3 dias) que entram na soma
  const staleOwn = ownAccs.filter((a) => {
    const d = daysSince(a.balance?.as_of);
    return d !== null && d > 3;
  });
  const maxStaleDays = staleOwn.reduce((m, a) => {
    const d = daysSince(a.balance?.as_of) ?? 0;
    return d > m ? d : m;
  }, 0);

  const asOf = data.map((d) => d.balance?.as_of).filter(Boolean).sort().pop() as
    | string
    | undefined;

  // Group by company
  // Normaliza nome da empresa: "estrela" → "Estrela", "proposito" → "Propósito", "prover" → "Prover"
  const companyLabel = (raw: string | null | undefined): string => {
    const k = (raw || '').toLowerCase().trim();
    if (k === 'estrela') return 'Estrela';
    if (k === 'proposito' || k === 'propósito') return 'Propósito';
    if (k === 'prover') return 'Prover';
    return raw || 'Outros';
  };
  const groups = new Map<string, AccountWithBalance[]>();
  for (const a of data) {
    const key = companyLabel(a.company);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const companyOrder = ['Estrela', 'Propósito', 'Prover'];
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const ia = companyOrder.indexOf(a[0]);
    const ib = companyOrder.indexOf(b[0]);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const negativo = ownSum < 0;
  const folegoNeg = folego < 0;

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
        {/* 2 grandes números */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Dinheiro próprio hoje
            </div>
            <div
              className={cn(
                'mt-2 font-mono text-3xl font-bold tabular-nums',
                negativo ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {fmtBRL(ownSum)}
            </div>
            <p
              className={cn(
                'mt-1 text-xs',
                negativo ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {negativo
                ? `A empresa está NEGATIVA em ${fmtBRL(Math.abs(ownSum))} (usando cheque especial)`
                : `A empresa tem ${fmtBRL(ownSum)} em caixa`}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Fôlego com o limite
            </div>
            <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-foreground">
              {fmtBRL(folego)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {folegoNeg
                ? `Mesmo somando o cheque especial dos bancos (${fmtBRL(limitSum)}), ainda falta ${fmtBRL(Math.abs(folego))} pra zerar`
                : `Com o cheque especial, há ${fmtBRL(folego)} disponíveis`}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              O limite é dívida, não é dinheiro seu.
            </p>
          </div>
        </div>

        {/* Aviso CALMO (amarelo) sobre defasagem */}
        {staleOwn.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Atenção: {staleOwn.length} conta(s) com saldo de há {maxStaleDays} dias — o caixa
              pode estar incompleto. ({staleOwn.map((a) => a.name).join(', ')})
            </span>
          </div>
        )}

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
