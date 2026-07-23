// Controladoria — Saldo de hoje com saldos MANUAIS (ctrl_account_balances).
// Inter continua live via edge inter-saldo.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, RefreshCw, Pencil, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtBRL } from '@/hooks/useCashflowBalances';
import { useCtrlAccountBalances, useUpdateCtrlBalances, type CtrlAccountWithBalance } from '@/hooks/useCtrlAccountBalances';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { parseMoneyBR, formatMoneyBR } from '@/lib/money';
import logoBb from '@/assets/logo-bb.png';
import logoCresol from '@/assets/logo-cresol.webp';
import logoIfood from '@/assets/logo-ifood.png';
import logoSicredi from '@/assets/logo-sicredi.jpeg';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
        <img src={src} alt={name} className={cn('h-full w-full object-contain', isCresol ? 'p-0' : 'p-1')} />
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

function AccountBubble({ acc, showName, hidden }: { acc: CtrlAccountWithBalance; showName: boolean; hidden?: boolean }) {
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
          'font-mono text-xs sm:text-[11px] font-semibold tabular-nums text-center whitespace-nowrap leading-tight w-full min-w-0 max-w-full overflow-hidden',
          own < 0 ? 'text-destructive' : 'text-foreground',
        )}
      >
        {hidden ? 'R$ •••••' : fmtBRL(own)}
      </div>
    </div>
  );
}

function EditBalancesDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: CtrlAccountWithBalance[];
}) {
  const update = useUpdateCtrlBalances();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {};
      for (const a of accounts) {
        init[a.id] = formatMoneyBR(Number(a.balance?.own_balance ?? 0));
      }
      setValues(init);
    }
  }, [open, accounts]);

  const handleSave = async () => {
    try {
      const rows = accounts.map((a) => ({
        account_id: a.id,
        own_balance: parseMoneyBR(values[a.id] ?? '0'),
      }));
      await update.mutateAsync(rows);
      toast.success('Saldos atualizados');
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao salvar: ${e?.message || e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualizar saldos manuais</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {accounts.map((a) => {
            const displayName = DISPLAY_NAME[a.name] ?? a.name;
            return (
              <div key={a.id} className="flex items-center gap-3">
                <BankLogo bank={a.bank} name={a.name} />
                <Label className="flex-1 text-sm">{displayName}</Label>
                <Input
                  className="w-40 font-mono text-right"
                  value={values[a.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                />
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SaldoDeHoje() {
  const { data, isLoading, error } = useCtrlAccountBalances();
  const [inter, setInter] = useState<{ disponivel: number; atualizado_em: string } | null>(null);
  const [interLoading, setInterLoading] = useState(false);
  const [interError, setInterError] = useState(false);
  const [stark, setStark] = useState<{ disponivel: number; atualizado_em: string } | null>(null);
  const [starkLoading, setStarkLoading] = useState(false);
  const [starkError, setStarkError] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem('ctrl_saldo_hidden') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('ctrl_saldo_hidden', String(hidden));
    } catch {
      // ignore storage errors
    }
  }, [hidden]);

  const fetchInter = useCallback(async () => {
    setInterLoading(true);
    setInterError(false);
    try {
      const { data: res, error: err } = await supabase.functions.invoke('inter-saldo', { body: {} });
      if (err) throw err;
      if ((res as any)?.error) throw new Error((res as any).error);
      setInter({
        disponivel: Number((res as any)?.disponivel ?? 0),
        atualizado_em: String((res as any)?.atualizado_em ?? new Date().toISOString()),
      });
    } catch (e) {
      console.error('inter-saldo error', e);
      setInterError(true);
    } finally {
      setInterLoading(false);
    }
  }, []);

  const fetchStark = useCallback(async () => {
    setStarkLoading(true);
    setStarkError(false);
    try {
      const { data: res, error: err } = await supabase.functions.invoke('stark-saldo', { body: {} });
      if (err) throw err;
      if (!(res as any)?.ok) throw new Error((res as any)?.error || 'stark error');
      setStark({
        disponivel: Number((res as any)?.disponivel ?? 0),
        atualizado_em: String((res as any)?.atualizado_em ?? new Date().toISOString()),
      });
    } catch (e) {
      console.error('stark-saldo error', e);
      setStarkError(true);
    } finally {
      setStarkLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInter();
    fetchStark();
  }, [fetchInter, fetchStark]);

  const asOf = useMemo(() => {
    if (!data) return undefined;
    return data.map((d) => d.balance?.as_of).filter(Boolean).sort().pop() as string | undefined;
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Carregando saldos…</CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">Erro ao carregar saldos.</CardContent>
      </Card>
    );
  }

  const ownAccs = data.filter((a) => !a.is_passthrough);
  const manualSum = ownAccs.reduce((s, a) => s + Number(a.balance?.own_balance ?? 0), 0);
  const ownSum = manualSum + (inter ? inter.disponivel : 0) + (stark ? stark.disponivel : 0);
  const limitSum = ownAccs.reduce((s, a) => s + Number(a.overdraft_limit ?? 0), 0);
  const folego = ownSum + limitSum;

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
            <p className="text-xs text-foreground/80 mt-0.5">Referência: {fmtDate(asOf)}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setEditOpen(true)}
          title="Atualizar saldos manualmente"
        >
          <Pencil className="h-3 w-3" />
          Atualizar saldos
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3 pb-2 items-stretch">
          {estrelaAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName={false} />
          ))}
          {grupoAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName />
          ))}
          {outrosAccs.map((a) => (
            <AccountBubble key={a.id} acc={a} showName />
          ))}

          <div className="rounded-lg border border-border/60 bg-card p-2 flex flex-col items-center gap-2 min-w-0 w-full relative">
            <button
              type="button"
              onClick={fetchInter}
              disabled={interLoading}
              className="absolute top-1 right-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label="Atualizar saldo Inter"
              title="Atualizar saldo Inter"
            >
              <RefreshCw className={cn('h-3 w-3', interLoading && 'animate-spin')} />
            </button>
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0 text-sm"
                style={{ backgroundColor: '#FF6B00', color: '#FFFFFF' }}
                aria-label="Banco Inter"
              >
                In
              </div>
              <div className="text-xs font-medium text-center truncate min-w-0" title="Inter">
                Inter
              </div>
            </div>
            {interLoading && !inter ? (
              <Skeleton className="h-4 w-20" />
            ) : interError ? (
              <div className="font-mono text-xs font-semibold text-destructive text-center">Indisponível</div>
            ) : inter ? (
              <>
                <div
                  className={cn(
                    'font-mono text-xs sm:text-[11px] font-semibold tabular-nums text-center whitespace-nowrap leading-tight w-full min-w-0 max-w-full overflow-hidden',
                    inter.disponivel < 0 ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {fmtBRL(inter.disponivel)}
                </div>
                <div className="text-[9px] text-muted-foreground leading-none" title={inter.atualizado_em}>
                  {new Date(inter.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-lg border border-border/60 bg-card p-2 flex flex-col items-center gap-2 min-w-0 w-full relative">
            <button
              type="button"
              onClick={fetchStark}
              disabled={starkLoading}
              className="absolute top-1 right-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label="Atualizar saldo Stark"
              title="Atualizar saldo Stark"
            >
              <RefreshCw className={cn('h-3 w-3', starkLoading && 'animate-spin')} />
            </button>
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center font-bold shrink-0 text-sm"
                style={{ backgroundColor: '#0B7285', color: '#FFFFFF' }}
                aria-label="Stark Bank"
              >
                St
              </div>
              <div className="text-xs font-medium text-center truncate min-w-0" title="Stark">
                Stark
              </div>
            </div>
            {starkLoading && !stark ? (
              <Skeleton className="h-4 w-20" />
            ) : starkError ? (
              <div className="font-mono text-xs font-semibold text-destructive text-center">Indisponível</div>
            ) : stark ? (
              <>
                <div
                  className={cn(
                    'font-mono text-xs sm:text-[11px] font-semibold tabular-nums text-center whitespace-nowrap leading-tight w-full min-w-0 max-w-full overflow-hidden',
                    stark.disponivel < 0 ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {fmtBRL(stark.disponivel)}
                </div>
                <div className="text-[9px] text-muted-foreground leading-none" title={stark.atualizado_em}>
                  {new Date(stark.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            ) : null}
          </div>



          <div className="flex flex-col gap-2 min-w-0">
            <div className="rounded-lg border border-primary/50 bg-primary/10 p-2 flex flex-col items-center gap-1 min-w-0 w-full">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/80 text-center leading-tight">
                <span aria-hidden>💰</span> Pra usar hoje
              </div>
              <div
                className={cn(
                  'font-mono text-xs sm:text-[11px] font-bold tabular-nums text-center whitespace-nowrap leading-tight w-full min-w-0 max-w-full overflow-hidden',
                  folegoNeg ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
                )}
              >
                {fmtBRL(folego)}
              </div>
              <div className="text-[9px] text-muted-foreground leading-none text-center">saldo + limite</div>
            </div>

            <div className="rounded-lg border border-border/60 bg-card p-2 flex flex-col items-center gap-1 min-w-0 w-full">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center leading-tight">
                Saldo próprio
              </div>
              <div
                className={cn(
                  'font-mono text-xs sm:text-[11px] font-bold tabular-nums text-center whitespace-nowrap leading-tight w-full min-w-0 max-w-full overflow-hidden',
                  negativo ? 'text-destructive' : 'text-foreground',
                )}
              >
                {fmtBRL(ownSum)}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-card p-2 flex flex-col items-center gap-1 min-w-0 w-full">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center leading-tight">
                Limite
              </div>
              <div className="font-mono text-xs sm:text-[11px] font-bold tabular-nums text-center whitespace-nowrap leading-tight w-full min-w-0 max-w-full overflow-hidden text-foreground">
                {fmtBRL(limitSum)}
              </div>
              <div className="text-[9px] text-muted-foreground leading-none text-center">contratado</div>
            </div>
          </div>
        </div>
      </CardContent>

      <EditBalancesDialog open={editOpen} onOpenChange={setEditOpen} accounts={data} />
    </Card>
  );
}
