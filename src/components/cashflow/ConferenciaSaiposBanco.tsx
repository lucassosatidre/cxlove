import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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

export default function ConferenciaSaiposBanco() {
  const months = useMemo(buildMonths, []);
  // default = mês passado (índice 1)
  const [monthKey, setMonthKey] = useState<string>(months[1]?.key ?? months[0].key);
  const sel = months.find((m) => m.key === monthKey)!;
  const { data, isLoading } = useReconcileSaidas(sel.ini, sel.fim);

  const [creditTotal, setCreditTotal] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('cashflow_saipos')
        .select('amount')
        .ilike('payment_method', '%crédito%')
        .lt('amount', 0)
        .gte('vencimento', sel.ini)
        .lte('vencimento', sel.fim);
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

  const totSaipos = casado.length + aVerificar.length;
  const valSaipos = [...casado, ...aVerificar].reduce((s, r) => s + r.valor, 0);
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
            </div>
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
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <p className="text-sm">
              No mês, o Saipos diz que pagou <strong>{totSaipos}</strong> contas (
              <strong>{fmtBRL(valSaipos)}</strong>) por banco. Casaram com o extrato:{' '}
              <strong>{casado.length}</strong> (<strong>{fmtBRL(valCasado)}</strong>). A verificar:{' '}
              <strong>{aVerificar.length}</strong>. E há <strong>{noBanco.length}</strong> débitos no
              banco que o Saipos não explica.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="casado">
        <TabsList>
          <TabsTrigger value="casado">Casado ({casado.length})</TabsTrigger>
          <TabsTrigger value="verif">A verificar ({aVerificar.length})</TabsTrigger>
          <TabsTrigger value="banco">No banco, sem Saipos ({noBanco.length})</TabsTrigger>
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
                Constam como pagas no Saipos mas não achei um débito igual no extrato. Causas
                comuns: valor mudou por juros/taxa do boleto, data fora de ±3 dias, ou o extrato
                ainda não foi importado. É <strong>"verificar"</strong>, não erro.
              </p>
              <SaiposSemBancoTable rows={aVerificar} />
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
              <BancoSemSaiposTable rows={noBanco} />
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

function SaiposSemBancoTable({ rows }: { rows: ReconRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nada a verificar neste mês 🎉</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vencimento</TableHead>
            <TableHead>Fornecedor</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows
            .slice()
            .sort((a, b) => b.valor - a.valor)
            .map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{fmtDDMM(r.vencimento)}</TableCell>
                <TableCell className="text-xs">{r.fornecedor || '—'}</TableCell>
                <TableCell className="text-xs">{r.categoria || 'Sem categoria'}</TableCell>
                <TableCell className="text-right font-mono text-xs">{fmtBRL(r.valor)}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BancoSemSaiposTable({ rows }: { rows: ReconRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nenhum débito sem explicação.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Conta</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows
            .slice()
            .sort((a, b) => (a.tx_date || '').localeCompare(b.tx_date || ''))
            .map((r, i) => (
              <TableRow key={i}>
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
