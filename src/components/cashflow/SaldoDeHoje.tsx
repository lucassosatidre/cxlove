import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useCashflowBalances, fmtBRL, type AccountWithBalance } from '@/hooks/useCashflowBalances';
import { cn } from '@/lib/utils';
import logoBb from '@/assets/logo-bb.png';
import logoCresol from '@/assets/logo-cresol.webp';
import logoIfood from '@/assets/logo-ifood.png';
import logoSicredi from '@/assets/logo-sicredi.jpeg';

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

const BANK_LOGOS: Record<string, string> = {
  BB: logoBb,
  Cresol: logoCresol,
  iFood: logoIfood,
  Sicredi: logoSicredi,
};

const BANK_STYLES: Record<string, { bg: string; fg: string; label: string; textSize: string }> = {
  BB:      { bg: '#FCEE21', fg: '#0033A0', label: 'BB',     textSize: 'text-sm' },
  Cresol:  { bg: '#00995D', fg: '#FFFFFF', label: 'Cresol', textSize: 'text-[10px]' },
  C6:      { bg: '#1A1A1A', fg: '#FFFFFF', label: 'C6',     textSize: 'text-sm' },
  iFood:   { bg: '#EA1D2C', fg: '#FFFFFF', label: 'iF',     textSize: 'text-sm' },
  Sicredi: { bg: '#3DAE2B', fg: '#FFFFFF', label: 'Si',     textSize: 'text-sm' },
};

const DISPLAY_NAME: Record<string, string> = {
  'C6 Propósito': 'Propósito',
  'C6 Prover': 'Prover\u00a0',
};

function BankLogo({ bank, name }: { bank: string | null | undefined; name: string }) {
  const key = bank ?? '';
  const src = BANK_LOGOS[key];
  if (src) {
    return (
      <div className="h-10 w-10 rounded-xl bg-white overflow-hidden flex items-center justify-center shrink-0">
        <img src={src} alt={name} className="h-full w-full object-contain p-1" />
      </div>
    );
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
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <div className="h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0 text-sm bg-muted text-muted-foreground">
      {initials}
    </div>
  );
}

function AccountBubble({ acc, showName }: { acc: AccountWithBalance; showName: boolean }) {
  const own = Number(acc.balance?.own_balance ?? 0);
  const displayName = DISPLAY_NAME[acc.name] ?? acc.name;
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 flex flex-col items-center gap-2 min-w-[150px] shrink-0">
      <div className="flex items-center gap-2">
        <BankLogo bank={acc.bank} name={acc.name} />
        {showName && (
          <div className="text-xs font-medium text-center truncate max-w-[90px]" title={displayName}>
            {displayName}
          </div>
        )}
      </div>
      <div
        className={cn(
          'font-mono text-base font-semibold tabular-nums',
          own < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {fmtBRL(own)}
      </div>
      {acc.is_passthrough && null}
    </div>
  );
}

export default function SaldoDeHoje() {
  const { data, isLoading, error } = useCashflowBalances();
  const [limiteOpen, setLimiteOpen] = useState(false);

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

  const ownAccs = data.filter((a) => !a.is_passthrough);
  const ownSum = ownAccs.reduce((s, a) => s + Number(a.balance?.own_balance ?? 0), 0);
  const limitSum = ownAccs.reduce((s, a) => s + Number(a.overdraft_limit ?? 0), 0);
  const folego = ownSum + limitSum;

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

  const isEstrela = (raw: string | null | undefined) => (raw || '').toLowerCase().trim() === 'estrela';
  const isGrupo = (raw: string | null | undefined) => {
    const k = (raw || '').toLowerCase().trim();
    return k === 'proposito' || k === 'propósito' || k === 'prover';
  };
  const estrelaAccs = data.filter((a) => isEstrela(a.company));
  const grupoAccs = data.filter((a) => isGrupo(a.company));
  const outrosAccs = data.filter((a) => !isEstrela(a.company) && !isGrupo(a.company));

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
      <CardContent className="space-y-4">
        {/* Linha única de balões */}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {estrelaAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName={false} />
          ))}
          {grupoAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName />
          ))}
          {outrosAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName />
          ))}

          {/* Coluna final: SALDO DE HOJE + LIMITE */}
          <div className="flex flex-col gap-3 shrink-0">
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 flex flex-col items-center gap-2 min-w-[190px] shrink-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Saldo de hoje
              </div>
              <div
                className={cn(
                  'font-mono text-xl font-bold tabular-nums',
                  negativo ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
                )}
              >
                {fmtBRL(ownSum)}
              </div>
            </div>
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 flex flex-col items-center gap-2 min-w-[190px] shrink-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                LIMITE
              </div>
              <div
                className={cn(
                  'font-mono text-xl font-bold tabular-nums',
                  folegoNeg ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
                )}
              >
                {fmtBRL(folego)}
              </div>
            </div>
          </div>
        </div>

        {/* Aviso defasagem */}
        {staleOwn.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Atenção: {staleOwn.length} conta(s) com saldo de há {maxStaleDays} dias — o caixa
              pode estar incompleto. ({staleOwn.map((a) => a.name).join(', ')})
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
