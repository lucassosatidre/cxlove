import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fmtBRL, useCashflowBalances } from '@/hooks/useCashflowBalances';
import { useCashflowStatementCoverage } from '@/hooks/useCashflowAnalytics';
import { cn } from '@/lib/utils';
import logoBb from '@/assets/logo-bb.png';
import logoCresol from '@/assets/logo-cresol.webp';
import logoIfood from '@/assets/logo-ifood.png';
import logoSicredi from '@/assets/logo-sicredi.jpeg';

const BANK_LOGOS: Record<string, string> = {
  BB: logoBb,
  Cresol: logoCresol,
  iFood: logoIfood,
  Sicredi: logoSicredi,
};
const BANK_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  BB: { bg: '#FCEE21', fg: '#0033A0', label: 'BB' },
  Cresol: { bg: '#00995D', fg: '#FFFFFF', label: 'Cr' },
  C6: { bg: '#1A1A1A', fg: '#FFFFFF', label: 'C6' },
  iFood: { bg: '#EA1D2C', fg: '#FFFFFF', label: 'iF' },
  Sicredi: { bg: '#3DAE2B', fg: '#FFFFFF', label: 'Si' },
};

function BankLogoMini({ bank, name }: { bank: string | null; name: string }) {
  const key = bank ?? '';
  const src = BANK_LOGOS[key];
  if (src) {
    return (
      <div className="h-9 w-9 rounded-lg bg-white overflow-hidden flex items-center justify-center shrink-0">
        <img
          src={src}
          alt={name}
          className={cn('h-full w-full object-contain', key === 'Cresol' ? 'p-0' : 'p-1')}
        />
      </div>
    );
  }
  const style = BANK_COLORS[key];
  if (style) {
    return (
      <div
        className="h-9 w-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0"
        style={{ backgroundColor: style.bg, color: style.fg }}
        aria-label={name}
      >
        {style.label}
      </div>
    );
  }
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <div className="h-9 w-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 bg-muted text-muted-foreground">
      {initials}
    </div>
  );
}

function parseBRLInput(s: string): number | null {
  const t = (s || '').trim();
  if (!t) return null;
  // Detect decimal separator: if both . and , present, the last one is decimal
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  let normalized = t;
  if (lastComma > -1 && lastComma > lastDot) {
    // vírgula é decimal, ponto é milhar
    normalized = t.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1 && lastComma > -1) {
    // ponto é decimal, vírgula é milhar
    normalized = t.replace(/,/g, '');
  } else if (lastComma > -1) {
    normalized = t.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const PAGE = 50;

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtDDMM(iso?: string | null) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const past = new Date(y, (m || 1) - 1, d || 1);
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.floor((today.getTime() - past.getTime()) / (1000 * 60 * 60 * 24));
}
function hoursSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60));
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

type TxRow = {
  id: string;
  tx_date: string;
  description: string | null;
  detail: string | null;
  amount: number;
  running_balance: number | null;
  is_internal_transfer: boolean;
  source_seq: number;
};

export default function ExtratosPorConta() {
  const cov = useCashflowStatementCoverage();
  const bal = useCashflowBalances();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState<string>('');
  const [showInternal, setShowInternal] = useState<boolean>(false);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const queryClient = useQueryClient();
  const [reconfirmAccountId, setReconfirmAccountId] = useState<string | null>(null);
  const [reconfirmValue, setReconfirmValue] = useState<string>('');
  const [reconfirmSubmitting, setReconfirmSubmitting] = useState(false);

  // saldo da conta (de balances) por account_id
  const balanceById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const a of bal.data ?? []) {
      m.set(a.id, a.balance ? Number(a.balance.own_balance ?? 0) : null);
    }
    return m;
  }, [bal.data]);

  // última sincronização Open Finance por cashflow_account_id
  const [ofSyncById, setOfSyncById] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from('pluggy_accounts')
        .select('cashflow_account_id, last_synced_at')
        .not('cashflow_account_id', 'is', null);
      if (cancel || error || !data) return;
      const m = new Map<string, string>();
      for (const row of data as Array<{ cashflow_account_id: string | null; last_synced_at: string | null }>) {
        if (!row.cashflow_account_id || !row.last_synced_at) continue;
        const prev = m.get(row.cashflow_account_id);
        if (!prev || row.last_synced_at > prev) m.set(row.cashflow_account_id, row.last_synced_at);
      }
      setOfSyncById(m);
    })();
    return () => { cancel = true; };
  }, []);

  // auto-seleciona primeira conta com lançamentos
  useEffect(() => {
    if (selectedId || !cov.data?.length) return;
    const first = cov.data.find((r) => r.n > 0);
    if (first) setSelectedId(first.account_id);
  }, [cov.data, selectedId]);

  async function fetchPage(reset: boolean) {
    if (!selectedId) return;
    setLoading(true);
    const newOffset = reset ? 0 : offset;
    let query = supabase
      .from('cashflow_transactions')
      .select('id, tx_date, description, detail, amount, running_balance, is_internal_transfer, source_seq')
      .eq('account_id', selectedId)
      .order('tx_date', { ascending: false })
      .order('source_seq', { ascending: false })
      .range(newOffset, newOffset + PAGE - 1);

    if (!showInternal) query = query.eq('is_internal_transfer', false);
    if (from) query = query.gte('tx_date', from);
    if (to) query = query.lte('tx_date', to);
    if (q.trim()) {
      const term = `%${q.trim()}%`;
      query = query.or(`description.ilike.${term},detail.ilike.${term}`);
    }

    const { data, error } = await query;
    setLoading(false);
    if (error) return;
    const list = (data ?? []) as TxRow[];
    setHasMore(list.length === PAGE);
    setRows(reset ? list : [...rows, ...list]);
    setOffset(newOffset + list.length);
  }

  // reset/refetch quando filtros mudam
  useEffect(() => {
    if (!selectedId) return;
    setRows([]);
    setOffset(0);
    setHasMore(false);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, from, to, showInternal]);

  const selectedAcc = cov.data?.find((r) => r.account_id === selectedId);

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Cobertura dos extratos</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Até que dia cada conta foi importada. Clique no cartão para abrir o extrato detalhado.
          </p>
        </CardHeader>
        <CardContent>
          {cov.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
              {(cov.data ?? []).map((r) => {
                const balAcc = (bal.data ?? []).find((a) => a.id === r.account_id);
                const bank = balAcc?.bank ?? null;
                const ofSync = ofSyncById.get(r.account_id);
                const isOF = Boolean(ofSync);

                let dotClass = 'bg-emerald-500';
                let ageLabel: string | null = null;
                let ageTone: 'ok' | 'warn' | 'bad' = 'ok';

                if (isOF) {
                  const hrs = hoursSince(ofSync);
                  if (hrs === null) dotClass = 'bg-muted-foreground/40';
                  else if (hrs > 48) { dotClass = 'bg-destructive'; ageTone = 'bad'; }
                  else if (hrs > 24) { dotClass = 'bg-amber-500'; ageTone = 'warn'; }
                } else {
                  const age = daysSince(r.max_tx);
                  if (age === null) dotClass = 'bg-muted-foreground/40';
                  else if (age > 7) { dotClass = 'bg-destructive'; ageTone = 'bad'; ageLabel = `${age} dias atrás`; }
                  else if (age > 3) { dotClass = 'bg-amber-500'; ageTone = 'warn'; ageLabel = `${age} dias atrás`; }
                  else if (age > 0) { ageLabel = `${age} dia${age > 1 ? 's' : ''} atrás`; }
                }

                const saldo =
                  balanceById.get(r.account_id) ??
                  (r.saldo_final != null ? r.saldo_final : null);
                const saldoNeg = saldo != null && saldo < 0;
                const isSel = selectedId === r.account_id;

                return (
                  <button
                    key={r.account_id}
                    type="button"
                    onClick={() => setSelectedId(r.account_id)}
                    className={cn(
                      'group text-left rounded-xl border p-3 flex flex-col gap-2 min-w-0 transition-colors',
                      'bg-card hover:bg-muted/40',
                      isSel ? 'border-primary ring-1 ring-primary/40' : 'border-border/60',
                      ageTone === 'bad' && !isSel && 'border-destructive/40',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BankLogoMini bank={bank} name={r.account_name} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate" title={r.account_name}>
                          {r.account_name}
                        </div>
                        {r.company && (
                          <div className="text-[10px] text-muted-foreground truncate uppercase tracking-wide">
                            {r.company}
                          </div>
                        )}
                      </div>
                      {isOF && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[9px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        >
                          OF
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', dotClass)} />
                      <span className="text-foreground/90">Até {fmtDate(r.max_tx)}</span>
                      {ageLabel && (
                        <span
                          className={cn(
                            'text-[10px]',
                            ageTone === 'bad' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400',
                          )}
                        >
                          ({ageLabel})
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline justify-between gap-2 border-t border-border/50 pt-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo</span>
                      <span
                        className={cn(
                          'font-mono text-sm font-semibold tabular-nums whitespace-nowrap',
                          saldoNeg ? 'text-destructive' : 'text-foreground',
                        )}
                      >
                        {saldo == null ? '—' : fmtBRL(saldo)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{r.n} lançamento{r.n === 1 ? '' : 's'}</span>
                      {isOF && ofSync && (
                        <span title={new Date(ofSync).toLocaleString('pt-BR')}>
                          Sync {fmtDateTime(ofSync)}
                        </span>
                      )}
                    </div>

                    <div className="pt-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-full text-[10px] text-muted-foreground hover:text-foreground border border-dashed border-border/60"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReconfirmAccountId(r.account_id);
                                setReconfirmValue(
                                  saldo == null
                                    ? ''
                                    : saldo.toLocaleString('pt-BR', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      }),
                                );
                              }}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Reconfirmar saldo
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Use quando o saldo estiver diferente do app do banco
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {(() => {
        const acc = cov.data?.find((r) => r.account_id === reconfirmAccountId);
        const currentSaldo = reconfirmAccountId
          ? balanceById.get(reconfirmAccountId) ?? (acc?.saldo_final ?? null)
          : null;
        const parsed = parseBRLInput(reconfirmValue);
        return (
          <Dialog
            open={reconfirmAccountId !== null}
            onOpenChange={(open) => {
              if (!open && !reconfirmSubmitting) {
                setReconfirmAccountId(null);
                setReconfirmValue('');
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Reconfirmar saldo{acc ? ` — ${acc.account_name}` : ''}
                </DialogTitle>
                <DialogDescription>
                  Saldo atual no Vigia:{' '}
                  <span className="font-mono">
                    {currentSaldo == null ? '—' : fmtBRL(currentSaldo)}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="reconfirm-balance" className="text-xs">
                  Saldo real (do app do banco)
                </Label>
                <Input
                  id="reconfirm-balance"
                  autoFocus
                  value={reconfirmValue}
                  onChange={(e) => setReconfirmValue(e.target.value)}
                  placeholder="Ex.: 12.345,67 ou -28899,99"
                  disabled={reconfirmSubmitting}
                />
                <p className="text-[11px] text-muted-foreground">
                  Use valor negativo se a conta estiver no vermelho / usando cheque especial. Ex.: -28899,99
                </p>
                {reconfirmValue && parsed == null && (
                  <p className="text-[11px] text-destructive">Valor inválido.</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setReconfirmAccountId(null);
                    setReconfirmValue('');
                  }}
                  disabled={reconfirmSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  disabled={reconfirmSubmitting || parsed == null || !reconfirmAccountId}
                  onClick={async () => {
                    if (!reconfirmAccountId || parsed == null) return;
                    setReconfirmSubmitting(true);
                    try {
                      const { data, error } = await supabase.functions.invoke('reconfirmar-saldo', {
                        body: { account_id: reconfirmAccountId, balance: parsed },
                      });
                      if (error) throw error;
                      if (data?.error) throw new Error(data.error);
                      toast.success('Saldo reconfirmado!');
                      setReconfirmAccountId(null);
                      setReconfirmValue('');
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['cashflow', 'balances', 'latest'] }),
                        queryClient.invalidateQueries({ queryKey: ['cashflow', 'statement-coverage'] }),
                      ]);
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      toast.error(`Erro ao reconfirmar saldo: ${msg}`);
                    } finally {
                      setReconfirmSubmitting(false);
                    }
                  }}
                >
                  {reconfirmSubmitting && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Confirmar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">
            Extrato detalhado{selectedAcc ? ` — ${selectedAcc.account_name}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Buscar (descrição / detalhe)</Label>
              <div className="flex gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setRows([]);
                      setOffset(0);
                      fetchPage(true);
                    }
                  }}
                  placeholder="ex: aluguel, fornecedor…"
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRows([]);
                    setOffset(0);
                    fetchPage(true);
                  }}
                >
                  Buscar
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-internal"
              checked={showInternal}
              onCheckedChange={setShowInternal}
            />
            <Label htmlFor="show-internal" className="text-xs text-muted-foreground">
              Mostrar transferências internas
            </Label>
          </div>

          {!selectedId ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Selecione uma conta acima.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Detalhe</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Saldo após</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 && !loading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          Nenhum lançamento.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => {
                        const neg = r.amount < 0;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs">{fmtDDMM(r.tx_date)}</TableCell>
                            <TableCell className="text-xs">{r.description || '—'}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {r.detail || '—'}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right font-mono text-xs',
                                neg
                                  ? 'text-destructive'
                                  : 'text-emerald-700 dark:text-emerald-400',
                              )}
                            >
                              {neg ? '−' : '+'}
                              {fmtBRL(Math.abs(r.amount))}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {r.running_balance == null ? '—' : fmtBRL(Number(r.running_balance))}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{rows.length} linhas carregadas</span>
                {hasMore && (
                  <Button variant="outline" size="sm" onClick={() => fetchPage(false)} disabled={loading}>
                    {loading ? 'Carregando…' : 'Carregar mais'}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
