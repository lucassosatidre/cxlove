import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useReconcileSaidas, type ReconRow } from '@/hooks/useCashflowAnalytics';
import { fmtBRL } from '@/hooks/useCashflowBalances';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const MESES_LBL = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function lastDay(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}
function fmtDDMM(iso?: string | null) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function buildMonths(): { key: string; label: string; ini: string; fim: string }[] {
  const today = new Date();
  const out = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const ini = `${y}-${pad(m)}-01`;
    const fim = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
    out.push({ key: `${y}-${pad(m)}`, label: `${MESES_LBL[m - 1]}/${String(y).slice(-2)}`, ini, fim });
  }
  return out;
}

async function setConferido(kind: 'saipos' | 'banco', id: string, value: boolean) {
  const { error } = await (supabase.rpc as any)('set_conferido', { p_kind: kind, p_id: id, p_value: value });
  if (error) throw error;
}

export default function ConferenciaSaiposBanco() {
  const months = useMemo(buildMonths, []);
  const [monthKey, setMonthKey] = useState<string>(months[1]?.key ?? months[0].key);
  const sel = months.find((m) => m.key === monthKey)!;
  const { data, isLoading } = useReconcileSaidas(sel.ini, sel.fim);
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['cashflow', 'reconcile'] });

  const handleToggle = async (kind: 'saipos' | 'banco', id: string | null, value: boolean) => {
    if (!id) return;
    try {
      await setConferido(kind, id, value);
      invalidate();
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message ?? e));
    }
  };

  const handleBulk = async (rows: ReconRow[], kind: 'saipos' | 'banco', value: boolean) => {
    const ids = rows
      .map((r) => (kind === 'saipos' ? r.saipos_id : r.tx_id))
      .filter((x): x is string => Boolean(x));
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => setConferido(kind, id, value)));
      invalidate();
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message ?? e));
    }
  };

  const [creditTotal, setCreditTotal] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('saipos_fin_transactions')
        .select('amount')
        .or('desc_store_payment_method.ilike.%cart%,desc_store_payment_method.ilike.%crédito%')
        .lt('amount', 0)
        .gte('date', sel.ini)
        .lte('date', sel.fim);
      if (error || cancelled) return;
      const total = (data ?? []).reduce((s: number, r: any) => s + Math.abs(Number(r.amount) || 0), 0);
      setCreditTotal(total);
    })();
    return () => {
      cancelled = true;
    };
  }, [sel.ini, sel.fim]);

  const rows = data ?? [];
  const casado = rows.filter((r) => r.tipo === 'casado');
  const aVerificar = rows.filter((r) => r.tipo === 'saipos_sem_banco');
  const noBanco = rows.filter((r) => r.tipo === 'banco_sem_saipos');

  const aVerifPend = aVerificar.filter((r) => !r.conferido);
  const aVerifConf = aVerificar.filter((r) => r.conferido);
  const noBancoPend = noBanco.filter((r) => !r.conferido);
  const noBancoConf = noBanco.filter((r) => r.conferido);

  const totSaipos = casado.length + aVerifPend.length;
  const valSaipos = [...casado, ...aVerifPend].reduce((s, r) => s + r.valor, 0);
  const valCasado = casado.reduce((s, r) => s + r.valor, 0);

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader className="space-y-3">
          <div className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Conferência Saipos × Banco</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Confere, por mês de vencimento, se as contas que o Saipos diz que pagou
                realmente saíram do extrato bancário.
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Atualiza automaticamente com cada novo sync de banco e Saipos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['cashflow', 'reconcile'] })}
                aria-label="Atualizar"
                title="Atualizar"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Select value={monthKey} onValueChange={setMonthKey}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <p className="text-sm">
              No mês, o Saipos diz que pagou <strong>{totSaipos}</strong> contas (
              <strong>{fmtBRL(valSaipos)}</strong>) por banco. Casaram com o extrato:{' '}
              <strong>{casado.length}</strong> (<strong>{fmtBRL(valCasado)}</strong>). No Saipos, sem banco:{' '}
              <strong>{aVerifPend.length}</strong>. E há <strong>{noBancoPend.length}</strong> débitos no
              banco que o Saipos não explica.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="casado">
        <TabsList>
          <TabsTrigger value="casado">Casado ({casado.length})</TabsTrigger>
          <TabsTrigger value="verif">
            No Saipos, sem banco ({aVerifPend.length})
            {aVerifConf.length > 0 && (
              <span className="ml-1 text-muted-foreground">· {aVerifConf.length} conferidos</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="banco">
            No banco, sem Saipos ({noBancoPend.length})
            {noBancoConf.length > 0 && (
              <span className="ml-1 text-muted-foreground">· {noBancoConf.length} conferidos</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="casado">
          <Card className="border-border/60">
            <CardContent className="pt-6">
              <CasadoTable rows={casado} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verif">
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6 space-y-3">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Constam como pagas no Saipos mas não achei um débito 1-a-1 no extrato. Causas
                comuns: pagamentos em lote (folha, adiantamento, pró-labore, empréstimo pagos em
                várias transferências), boletos pagos com juros/desconto (valor ficou diferente),
                ou taxas definidas pelo banco. É <strong>"verificar"</strong>, não erro.
              </p>
              <FolhaAdiantHint rows={aVerificar} />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulk(aVerifPend, 'saipos', true)}
                  disabled={aVerifPend.length === 0}
                >
                  Marcar todos como conferido
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulk(aVerifConf, 'saipos', false)}
                  disabled={aVerifConf.length === 0}
                >
                  Desmarcar todos
                </Button>
              </div>
              <SaiposSemBancoTable
                rows={aVerificar}
                onToggle={(id, v) => handleToggle('saipos', id, v)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="banco">
          <Card className="border-border/60 bg-muted/30">
            <CardContent className="pt-6 space-y-3">
              <p className="text-xs text-muted-foreground">
                Débitos no extrato que nenhum lançamento do Saipos explica (ex.: empréstimos em
                débito automático, transferências).
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulk(noBancoPend, 'banco', true)}
                  disabled={noBancoPend.length === 0}
                >
                  Marcar todos como conferido
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulk(noBancoConf, 'banco', false)}
                  disabled={noBancoConf.length === 0}
                >
                  Desmarcar todos
                </Button>
              </div>
              <BancoSemSaiposTable
                rows={noBanco}
                onToggle={(id, v) => handleToggle('banco', id, v)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="border-border/60 bg-muted/30">
        <CardContent className="pt-6">
          <p className="text-sm">
            <strong>Cartão de crédito:</strong> conferido por fatura à parte (envie o PDF da
            fatura) — fica fora desta conferência 1-a-1.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Total lançado no Saipos como cartão de crédito em {sel.label}:{' '}
            <span className="font-mono">{fmtBRL(creditTotal)}</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function FolhaAdiantHint({ rows }: { rows: ReconRow[] }) {
  const folha = rows
    .filter((r) => (r.categoria || '').toLowerCase().includes('folha'))
    .reduce((s, r) => s + r.valor, 0);
  const adiant = rows
    .filter((r) => (r.categoria || '').toLowerCase().includes('adiant'))
    .reduce((s, r) => s + r.valor, 0);
  if (folha <= 0 && adiant <= 0) return null;
  const parts: string[] = [];
  if (folha > 0) parts.push(`Folha lançada no Saipos: ${fmtBRL(folha)}`);
  if (adiant > 0) parts.push(`Adiantamentos: ${fmtBRL(adiant)}`);
  return (
    <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
      {parts.join(' · ')}. No banco isso sai como transferências individuais por funcionário (+ Luis
      Carlos do Nascimento, o único pago pelo Banco do Brasil). Confira o total e marque como
      conferido.
    </div>
  );
}

function CasadoTable({ rows }: { rows: ReconRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nenhum lançamento casado neste mês.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vencimento</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Data no banco</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows
            .slice()
            .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''))
            .map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{fmtDDMM(r.vencimento)}</TableCell>
                <TableCell className="text-xs">{r.descricao || r.fornecedor || '—'}</TableCell>
                <TableCell className="text-xs">{r.categoria || 'Sem categoria'}</TableCell>
                <TableCell className="text-right font-mono text-xs">{fmtBRL(r.valor)}</TableCell>
                <TableCell className="text-xs">{fmtDDMM(r.tx_date)}</TableCell>
                <TableCell>
                  {r.confianca === 'ALTA' ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px]">
                      data exata
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-[10px]">
                      ±3 dias
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SaiposSemBancoTable({
  rows,
  onToggle,
}: {
  rows: ReconRow[];
  onToggle: (id: string | null, value: boolean) => void;
}) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nada a verificar neste mês 🎉</p>;
  }
  const sorted = rows
    .slice()
    .sort((a, b) => {
      if (Number(a.conferido) !== Number(b.conferido)) return Number(a.conferido) - Number(b.conferido);
      return b.valor - a.valor;
    });
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[90px]">Conferido</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={r.saipos_id ?? i} className={r.conferido ? 'opacity-50' : ''}>
              <TableCell>
                <Checkbox
                  checked={r.conferido}
                  onCheckedChange={(v) => onToggle(r.saipos_id, Boolean(v))}
                />
              </TableCell>
              <TableCell className="text-xs">{fmtDDMM(r.vencimento)}</TableCell>
              <TableCell className="text-xs">{r.descricao || r.fornecedor || '—'}</TableCell>
              <TableCell className="text-xs">{r.categoria || 'Sem categoria'}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtBRL(r.valor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BancoSemSaiposTable({
  rows,
  onToggle,
}: {
  rows: ReconRow[];
  onToggle: (id: string | null, value: boolean) => void;
}) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nenhum débito sem explicação.</p>;
  }
  const sorted = rows
    .slice()
    .sort((a, b) => {
      if (Number(a.conferido) !== Number(b.conferido)) return Number(a.conferido) - Number(b.conferido);
      return (a.tx_date || '').localeCompare(b.tx_date || '');
    });
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[90px]">Conferido</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Conta</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, i) => (
            <TableRow key={r.tx_id ?? i} className={r.conferido ? 'opacity-50' : ''}>
              <TableCell>
                <Checkbox
                  checked={r.conferido}
                  onCheckedChange={(v) => onToggle(r.tx_id, Boolean(v))}
                />
              </TableCell>
              <TableCell className="text-xs">{fmtDDMM(r.tx_date)}</TableCell>
              <TableCell className="text-xs">{r.account_name || '—'}</TableCell>
              <TableCell className="text-xs">{r.descricao_banco || '—'}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtBRL(r.valor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
