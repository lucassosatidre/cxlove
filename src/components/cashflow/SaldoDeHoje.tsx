import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet } from 'lucide-react';
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
  const isCresol = key === 'Cresol';
  if (src) {
    return (
      <div className="h-10 w-10 rounded-xl bg-white overflow-hidden flex items-center justify-center shrink-0">
        <img
          src={src}
          alt={name}
          className={cn('h-full w-full object-contain', isCresol ? 'p-0' : 'p-1')}
        />
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
    <div className="rounded-lg border border-border/60 bg-card p-2 flex flex-col items-center gap-2 min-w-0 w-full">
      <div className="flex items-center gap-2 min-w-0 max-w-full">
        <BankLogo bank={acc.bank} name={acc.name} />
        {showName && (
          <div className="text-xs font-medium text-center truncate min-w-0" title={displayName}>
            {displayName}
          </div>
        )}
      </div>
      <div
        className={cn(
          'font-mono text-xs font-semibold tabular-nums text-center break-all leading-tight w-full',
          own < 0 ? 'text-destructive' : 'text-foreground',
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
            <p className="text-xs text-foreground/80 mt-0.5">
              Referência: {fmtDate(asOf)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Grid de balões — quebra em múltiplas linhas quando faltar espaço */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 pb-2 items-stretch">
          {estrelaAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName={false} />
          ))}
          {grupoAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName />
          ))}
          {outrosAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName />
          ))}

          {/* Coluna final: SALDO DE HOJE + LIMITE maximizável */}
          <div className="flex flex-col gap-3 min-w-0">
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-2 flex flex-col items-center gap-2 min-w-0 w-full">
              <div
                className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl"
                aria-label="Saldo de hoje"
                title="Saldo de hoje"
              >
                💰
              </div>
              <div
                className={cn(
                  'font-mono text-xs font-bold tabular-nums text-center break-all leading-tight w-full',
                  negativo ? 'text-destructive' : 'text-foreground',
                )}
              >
                {fmtBRL(ownSum)}
              </div>
              <button
                type="button"
                onClick={() => setLimiteOpen((v) => !v)}
                className="text-sm text-foreground/80 hover:text-foreground transition-colors"
                aria-label={limiteOpen ? 'Ocultar limite' : 'Ver limite'}
                title={limiteOpen ? 'Ocultar limite' : 'Ver limite'}
              >
                {limiteOpen ? '▲' : '▼'}
              </button>
            </div>
            {limiteOpen && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-2 flex flex-col items-center gap-2 min-w-0 w-full">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
                  LIMITE
                </div>
                <div
                  className={cn(
                    'font-mono text-xs font-bold tabular-nums text-center break-all leading-tight w-full',
                    folegoNeg ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {fmtBRL(folego)}
                </div>
              </div>
            )}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
