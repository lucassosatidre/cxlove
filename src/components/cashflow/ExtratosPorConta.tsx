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
            Até que dia cada conta foi importada. Clique para abrir o extrato detalhado.
          </p>
        </CardHeader>
        <CardContent>
          {cov.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Atualizado até</TableHead>
                    <TableHead className="text-right">Lançamentos</TableHead>
                    <TableHead className="text-right">Saldo da conta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(cov.data ?? []).map((r) => {
                    const ofSync = ofSyncById.get(r.account_id);
                    const isOF = Boolean(ofSync);

                    // Frescor: OF usa last_synced_at (horas); Manual usa max_tx (dias)
                    let dot = 'bg-emerald-500';
                    let rowTint = '';
                    let freshnessNode: React.ReactNode = null;

                    if (isOF) {
                      const hrs = hoursSince(ofSync);
                      if (hrs === null) {
                        dot = 'bg-muted-foreground/40';
                      } else if (hrs > 48) {
                        dot = 'bg-destructive';
                        rowTint = 'bg-destructive/5';
                      } else if (hrs > 24) {
                        dot = 'bg-amber-500';
                      }
                      freshnessNode = (
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-2 text-sm">
                            <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
                            {fmtDate(r.max_tx)}
                          </span>
                          <span className="text-[10px] text-muted-foreground pl-4">
                            Sincronizado automaticamente • {fmtDateTime(ofSync)}
                          </span>
                        </div>
                      );
                    } else {
                      const age = daysSince(r.max_tx);
                      if (age === null) {
                        dot = 'bg-muted-foreground/40';
                      } else if (age > 7) {
                        dot = 'bg-destructive';
                        rowTint = 'bg-destructive/5';
                      } else if (age > 3) {
                        dot = 'bg-amber-500';
                        rowTint = 'bg-amber-500/5';
                      }
                      freshnessNode = (
                        <span className="flex items-center gap-2 text-sm">
                          <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
                          {fmtDate(r.max_tx)}
                          {age !== null && age > 3 && (
                            <span
                              className={cn(
                                'text-[11px]',
                                age > 7 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400',
                              )}
                            >
                              ({age} dias atrás)
                            </span>
                          )}
                        </span>
                      );
                    }

                    const saldo =
                      balanceById.get(r.account_id) ??
                      (r.saldo_final != null ? r.saldo_final : null);
                    const isSel = selectedId === r.account_id;
                    return (
                      <TableRow
                        key={r.account_id}
                        onClick={() => setSelectedId(r.account_id)}
                        className={cn(
                          'cursor-pointer hover:bg-muted/50',
                          rowTint,
                          isSel && 'bg-primary/10 hover:bg-primary/15',
                        )}
                      >
                        <TableCell className="font-medium">
                          {r.account_name}
                          {r.company && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {r.company}
                            </Badge>
                          )}
                          {isOF && (
                            <Badge variant="outline" className="ml-2 text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                              Open Finance
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.min_tx ? `${fmtDate(r.min_tx)} → ${fmtDate(r.max_tx)}` : '—'}
                        </TableCell>
                        <TableCell>{freshnessNode}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{r.n}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {saldo == null ? '—' : fmtBRL(saldo)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
