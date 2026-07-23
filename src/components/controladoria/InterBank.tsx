import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Loader2, RefreshCw, Landmark, Wallet, Receipt, FileText, Send, Layers,
  AlertCircle, Inbox, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { isAprovadorUI } from '@/lib/aprovadores';
import { parseMoneyBR, formatMoneyBR } from '@/lib/money';

type SaldoResp = {
  disponivel?: number; bloqueado?: number; limite?: number; saldo_total?: number;
  atualizado_em?: string; error?: string;
};

type Tx = {
  idTransacao?: string;
  dataInclusao?: string;
  dataTransacao?: string;
  tipoTransacao?: string;
  tipoOperacao?: 'C' | 'D' | string;
  valor?: number;
  titulo?: string;
  descricao?: string;
  detalhes?: any;
};

const fmtDateTime = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const daysAgoISO = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function parseFunctionError(error: any): Promise<Error> {
  let msg = error?.message ?? 'Erro';
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) msg = body.error;
    }
  } catch {/* mantém */}
  return new Error(msg);
}

// Mascara últimas posições (linha digitável / chave Pix) para o rastro.
function maskDestino(v: string, keep = 4) {
  const s = String(v || '').trim();
  if (!s) return '—';
  if (s.length <= keep) return s;
  return `…${s.slice(-keep)}`;
}

async function logInterPagamento(row: {
  tipo: string;
  descricao?: string | null;
  valor?: number | null;
  destino?: string | null;
  status: 'enviado' | 'erro';
  retorno?: any;
}) {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    await (supabase as any).from('inter_pagamentos').insert({
      tipo: row.tipo,
      descricao: row.descricao ?? null,
      valor: row.valor ?? null,
      destino: row.destino ?? null,
      status: row.status,
      retorno: row.retorno ?? null,
      created_by: userRes?.user?.id ?? null,
    });
    window.dispatchEvent(new CustomEvent('inter-pagamentos:refresh'));
  } catch {
    /* silencioso — não bloqueia o pagamento */
  }
}

export default function InterBank() {
  const [saldo, setSaldo] = useState<SaldoResp | null>(null);
  const [saldoLoading, setSaldoLoading] = useState(false);
  const [saldoError, setSaldoError] = useState<string | null>(null);

  const [range, setRange] = useState<7 | 30>(7);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txsLoading, setTxsLoading] = useState(false);
  const [txsError, setTxsError] = useState<string | null>(null);

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    setSaldoError(null);
    try {
      const { data, error } = await supabase.functions.invoke('inter-saldo');
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      setSaldo(data as SaldoResp);
    } catch (e: any) {
      const msg = e?.message ?? 'Falha na conexão';
      setSaldo(null);
      setSaldoError(msg);
    } finally {
      setSaldoLoading(false);
    }
  }, []);

  const loadTxs = useCallback(async (days: 7 | 30) => {
    setTxsLoading(true);
    setTxsError(null);
    try {
      const { data, error } = await supabase.functions.invoke('inter-extrato-completo', {
        body: { data_inicio: daysAgoISO(days), data_fim: todayISO(), pagina: 0, tamanhoPagina: 100 },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      setTxs(((data as any)?.transacoes ?? []) as Tx[]);
    } catch (e: any) {
      const msg = e?.message ?? 'Erro no extrato Inter';
      setTxsError(msg);
      setTxs([]);
    } finally {
      setTxsLoading(false);
    }
  }, []);

  useEffect(() => { loadSaldo(); }, [loadSaldo]);
  // Efeito único: dispara ao mudar range (inclui o mount).
  useEffect(() => { loadTxs(range); }, [range, loadTxs]);

  const conectado = !saldoLoading && !saldoError && saldo != null;

  return (
    <div className="space-y-6">
      {/* Grid: Status + Saldo */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Landmark className="h-4 w-4 mt-0.5 text-accent" aria-hidden="true" />
                <div>
                  <CardTitle className="font-brand">Banco Inter</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Banco Inter Empresas
                  </p>
                </div>
              </div>
              {saldoLoading ? (
                <Badge variant="outline"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Conectando…</Badge>
              ) : conectado ? (
                <Badge className="bg-success text-success-foreground hover:bg-success border border-accent/40">
                  Conectado · Produção
                </Badge>
              ) : (
                <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive">
                  Sem conexão
                </Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Saldo */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-accent" aria-hidden="true" />
              <CardTitle className="font-brand">Saldo disponível</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadSaldo}
              disabled={saldoLoading}
              aria-label="Atualizar saldo"
              title="Atualizar saldo"
            >
              {saldoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Atualizar</span>
            </Button>
          </CardHeader>
          <CardContent>
            {saldoLoading ? (
              <Skeleton className="h-10 w-40" />
            ) : saldoError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" aria-hidden="true" />
                <div className="text-sm">
                  <p className="text-destructive font-medium">Não deu para ler o saldo</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{saldoError}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={loadSaldo}>
                    <RefreshCw className="h-3 w-3 mr-1" />Tentar de novo
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-4xl font-bold font-mono-tabular text-accent">
                  {formatMoneyBR(saldo?.disponivel ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground mt-2 space-x-3">
                  {(saldo?.bloqueado ?? 0) > 0 && <span>Bloqueado {formatMoneyBR(saldo!.bloqueado!)}</span>}
                  {(saldo?.limite ?? 0) > 0 && <span>Limite {formatMoneyBR(saldo!.limite!)}</span>}
                  <span>Atualizado {fmtDateTime(saldo?.atualizado_em)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Extrato */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-accent" aria-hidden="true" />
              <div>
                <CardTitle className="font-brand">Extrato</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Movimentações recentes da conta Inter.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant={range === 7 ? 'default' : 'outline'} size="sm" onClick={() => setRange(7)}>7 dias</Button>
              <Button variant={range === 30 ? 'default' : 'outline'} size="sm" onClick={() => setRange(30)}>30 dias</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadTxs(range)}
                disabled={txsLoading}
                aria-label="Recarregar extrato"
                title="Recarregar extrato"
              >
                {txsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {txsError ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mb-2" aria-hidden="true" />
              <p className="font-medium text-destructive">Erro ao carregar o extrato</p>
              <p className="text-xs text-muted-foreground mt-1">{txsError}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => loadTxs(range)}>
                <RefreshCw className="h-3 w-3 mr-1" />Tentar de novo
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right w-[140px]">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={`sk-${i}`}>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-full max-w-[420px]" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : txs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <Inbox className="h-10 w-10 text-muted-foreground mb-2" aria-hidden="true" />
                          <p className="font-medium">Sem movimentações no período</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Tente aumentar o intervalo para 30 dias.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : txs.map((t, i) => {
                    const isDebit = (t.tipoOperacao === 'D');
                    const valor = Number(t.valor ?? 0) * (isDebit ? -1 : 1);
                    const desc = t.descricao || t.titulo || t.tipoTransacao || '—';
                    return (
                      <TableRow key={t.idTransacao || `${t.dataTransacao}-${i}`}>
                        <TableCell className="text-xs">{fmtDateTime(t.dataInclusao || t.dataTransacao)}</TableCell>
                        <TableCell className="text-sm">{desc}</TableCell>
                        <TableCell className={`text-right font-mono-tabular font-medium ${valor < 0 ? 'text-destructive' : 'text-success'}`}>
                          {formatMoneyBR(valor)}
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

      {/* Pagamentos */}
      <InterPagamentosCard />
    </div>
  );
}

function InterPagamentosCard() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail((data?.user?.email || '').toLowerCase() || null);
    });
  }, []);
  // Estética apenas — a segurança real está nas edges inter-pagar-* / inter-pix (checagem APROVADORES).
  const isAprovador = isAprovadorUI(userEmail);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-2">
            <Send className="h-4 w-4 mt-0.5 text-accent" aria-hidden="true" />
            <div>
              <CardTitle className="font-brand">Pagamentos</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Envio direto pelo Inter — boletos, DARF, Pix e lote.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isAprovador ? (
            <>
              <div className="flex flex-wrap gap-2">
                <BoletoDialog />
                <DarfDialog />
                <PixDialog />
                <LoteDialog />
              </div>
              <p className="text-xs text-muted-foreground pt-2 border-t">
                A liberação final acontece na fila de aprovação do app do Banco Inter.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pagamentos disponíveis apenas para aprovadores.
            </p>
          )}
        </CardContent>
      </Card>

      {isAprovador && <InterPagamentosHistoricoCard />}
    </>
  );
}

/* ---------------- Histórico local (inter_pagamentos) ---------------- */

type InterPag = {
  id: string;
  tipo: string;
  descricao: string | null;
  valor: number | null;
  destino: string | null;
  status: string;
  created_at: string;
};

function pagStatusBadge(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'enviado') return <Badge className="bg-info text-info-foreground hover:bg-info">Enviado</Badge>;
  if (s === 'erro') return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive">Erro</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function InterPagamentosHistoricoCard() {
  const [rows, setRows] = useState<InterPag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await (supabase as any)
        .from('inter_pagamentos')
        .select('id, tipo, descricao, valor, destino, status, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setRows((data ?? []) as InterPag[]);
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('inter-pagamentos:refresh', handler);
    return () => window.removeEventListener('inter-pagamentos:refresh', handler);
  }, [load]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2">
            <History className="h-4 w-4 mt-0.5 text-accent" aria-hidden="true" />
            <div>
              <CardTitle className="font-brand">Pagamentos enviados (Inter)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Rastro dos últimos 20 envios pelo Inter (só aparece para aprovadores).
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            aria-label="Atualizar histórico Inter"
            title="Atualizar histórico"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" aria-hidden="true" />
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={load}>
              <RefreshCw className="h-3 w-3 mr-1" />Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Data</TableHead>
                  <TableHead className="w-[90px]">Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-[120px]">Destino</TableHead>
                  <TableHead className="text-right w-[120px]">Valor</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`hp-${i}`}>
                      <TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Inbox className="h-8 w-8 text-muted-foreground mb-2" aria-hidden="true" />
                        <p className="text-sm font-medium">Nenhum pagamento enviado ainda</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Envios pelo Inter aparecem aqui automaticamente.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{fmtDateTime(p.created_at)}</TableCell>
                    <TableCell className="text-xs uppercase">{p.tipo}</TableCell>
                    <TableCell className="text-sm">{p.descricao || '—'}</TableCell>
                    <TableCell className="text-xs font-mono">{p.destino || '—'}</TableCell>
                    <TableCell className="text-right font-mono-tabular">
                      {p.valor != null ? formatMoneyBR(Number(p.valor)) : '—'}
                    </TableCell>
                    <TableCell>{pagStatusBadge(p.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/* ---------------- Boleto ---------------- */
function BoletoDialog() {
  const [open, setOpen] = useState(false);
  const [codigoBarras, setCodigoBarras] = useState('');
  const [valor, setValor] = useState('');
  const [dataPagamento, setDataPagamento] = useState(todayISO());
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const valorNumLive = valor ? parseMoneyBR(valor) : 0;
  const ok = codigoBarras.replace(/\D/g, '').length >= 44 && !!dataPagamento && isFinite(valorNumLive) && valorNumLive > 0;

  async function pagar() {
    setLoading(true);
    const cb = codigoBarras.replace(/\D/g, '');
    const valorNum = valor ? parseMoneyBR(valor) : undefined;
    const descricao = desc || 'Boleto Inter';
    try {
      const { data, error } = await supabase.functions.invoke('inter-pagar-boleto', {
        body: {
          codigo_barras: cb,
          data_vencimento: dataPagamento,
          valor_pagar: valorNum,
          descricao: desc || undefined,
        },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Boleto enviado para pagamento');
      await logInterPagamento({
        tipo: 'boleto',
        descricao,
        valor: valorNum ?? null,
        destino: maskDestino(cb),
        status: 'enviado',
        retorno: data,
      });
      setOpen(false); setCodigoBarras(''); setValor(''); setDesc('');
    } catch (e: any) {
      toast.error(`Falha no pagamento: ${e?.message || e}`);
      await logInterPagamento({
        tipo: 'boleto',
        descricao,
        valor: valorNum ?? null,
        destino: maskDestino(cb),
        status: 'erro',
        retorno: { message: e?.message ?? String(e) },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Receipt className="h-4 w-4 mr-2" />Pagar boleto</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pagar boleto</DialogTitle>
          <DialogDescription>Cole a linha digitável / código de barras (44 dígitos).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="i-cb">Código de barras / linha digitável</Label>
            <Textarea id="i-cb" value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)}
              className="font-mono text-xs h-20" placeholder="Com ou sem espaços" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="i-v">Valor (R$)</Label>
              <Input id="i-v" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="i-dp">Vencimento do boleto</Label>
              <Input id="i-dp" type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="i-desc">Descrição (opcional)</Label>
            <Input id="i-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!ok || loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Pagar agora
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar pagamento</AlertDialogTitle>
                <AlertDialogDescription>
                  Debitar da conta Inter em {dataPagamento} — {valor ? `R$ ${valor}` : 'valor do boleto'}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={pagar}>Pagar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- DARF ---------------- */
function DarfDialog() {
  const [open, setOpen] = useState(false);
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [codigoReceita, setCodigoReceita] = useState('');
  const [dataApuracao, setDataApuracao] = useState('');
  const [dataVencimento, setDataVencimento] = useState('');
  const [valorPrincipal, setValorPrincipal] = useState('');
  const [valorMulta, setValorMulta] = useState('');
  const [valorJuros, setValorJuros] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const ok = cnpjCpf.replace(/\D/g, '').length >= 11 && !!codigoReceita
    && !!dataApuracao && !!dataVencimento
    && parseMoneyBR(valorPrincipal) > 0;

  async function pagar() {
    setLoading(true);
    const cnpjClean = cnpjCpf.replace(/\D/g, '');
    const principal = parseMoneyBR(valorPrincipal);
    const total = principal + parseMoneyBR(valorMulta) + parseMoneyBR(valorJuros);
    const descricao = desc || `DARF ${codigoReceita}`;
    try {
      const { data, error } = await supabase.functions.invoke('inter-pagar-darf', {
        body: {
          cnpj_cpf: cnpjClean,
          codigo_receita: codigoReceita,
          data_apuracao: dataApuracao,
          data_vencimento: dataVencimento,
          valor_principal: principal,
          valor_multa: valorMulta ? parseMoneyBR(valorMulta) : undefined,
          valor_juros: valorJuros ? parseMoneyBR(valorJuros) : undefined,
          descricao: desc || undefined,
        },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('DARF enviado para pagamento');
      await logInterPagamento({
        tipo: 'darf',
        descricao,
        valor: total,
        destino: maskDestino(cnpjClean),
        status: 'enviado',
        retorno: data,
      });
      setOpen(false);
    } catch (e: any) {
      toast.error(`Falha no DARF: ${e?.message || e}`);
      await logInterPagamento({
        tipo: 'darf',
        descricao,
        valor: total,
        destino: maskDestino(cnpjClean),
        status: 'erro',
        retorno: { message: e?.message ?? String(e) },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><FileText className="h-4 w-4 mr-2" />Pagar DARF</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pagar DARF</DialogTitle>
          <DialogDescription>Preencha os dados do DARF sem código de barras.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>CNPJ / CPF</Label><Input value={cnpjCpf} onChange={(e) => setCnpjCpf(e.target.value)} /></div>
          <div><Label>Código da receita</Label><Input value={codigoReceita} onChange={(e) => setCodigoReceita(e.target.value)} placeholder="ex: 0220" /></div>
          <div><Label>Data de apuração</Label><Input type="date" value={dataApuracao} onChange={(e) => setDataApuracao(e.target.value)} /></div>
          <div><Label>Data de vencimento</Label><Input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} /></div>
          <div><Label>Valor principal (R$)</Label><Input inputMode="decimal" value={valorPrincipal} onChange={(e) => setValorPrincipal(e.target.value)} /></div>
          <div><Label>Multa (R$) — opcional</Label><Input inputMode="decimal" value={valorMulta} onChange={(e) => setValorMulta(e.target.value)} /></div>
          <div><Label>Juros (R$) — opcional</Label><Input inputMode="decimal" value={valorJuros} onChange={(e) => setValorJuros(e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Descrição (opcional)</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!ok || loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Pagar DARF
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar DARF</AlertDialogTitle>
                <AlertDialogDescription>
                  Debitar R$ {valorPrincipal} (+ multa/juros) no vencimento {dataVencimento}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={pagar}>Pagar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Pix ---------------- */
function PixDialog() {
  const [open, setOpen] = useState(false);
  const [chave, setChave] = useState('');
  const [valor, setValor] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const ok = !!chave && parseMoneyBR(valor) > 0;

  async function enviar() {
    setLoading(true);
    const chaveTrim = chave.trim();
    const valorNum = parseMoneyBR(valor);
    const descricao = desc || 'Pix Inter';
    try {
      const { data, error } = await supabase.functions.invoke('inter-pix', {
        body: {
          chave_pix: chaveTrim,
          valor: valorNum,
          descricao: desc || undefined,
        },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      const codigo = (data as any)?.codigoSolicitacao ?? (data as any)?.endToEnd ?? '(sem código)';
      toast.success(`Pix enviado (${codigo})`);
      await logInterPagamento({
        tipo: 'pix',
        descricao,
        valor: valorNum,
        destino: maskDestino(chaveTrim),
        status: 'enviado',
        retorno: data,
      });
      setOpen(false); setChave(''); setValor(''); setDesc('');
    } catch (e: any) {
      toast.error(`Falha Pix: ${e?.message || e}`);
      await logInterPagamento({
        tipo: 'pix',
        descricao,
        valor: valorNum,
        destino: maskDestino(chaveTrim),
        status: 'erro',
        retorno: { message: e?.message ?? String(e) },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Send className="h-4 w-4 mr-2" />Enviar Pix</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar Pix</DialogTitle>
          <DialogDescription>Chave Pix do destinatário.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Chave Pix (email, CPF/CNPJ, telefone ou aleatória)</Label>
            <Input value={chave} onChange={(e) => setChave(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Valor (R$)</Label><Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
            <div><Label>Descrição (opcional)</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={140} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!ok || loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Enviar Pix
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar Pix</AlertDialogTitle>
                <AlertDialogDescription>Enviar R$ {valor} para <b>{chave}</b>?</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={enviar}>Enviar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Lote ---------------- */
function LoteDialog() {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState('');
  const [data, setData] = useState(todayISO());
  const [valorPadrao, setValorPadrao] = useState('');
  const [loading, setLoading] = useState(false);
  const [ultimo, setUltimo] = useState<{ id: string; total: number } | null>(null);

  async function processar() {
    setLoading(true);
    let total = 0;
    let idLote: string | undefined;
    try {
      const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const pagamentos: any[] = [];
      for (const l of linhas) {
        const [cbRaw, vRaw] = l.split(/[;\t,|]/).map((x) => x?.trim());
        const cb = String(cbRaw ?? '').replace(/\D/g, '');
        if (!cb) continue;
        const v = vRaw ? parseMoneyBR(vRaw) : parseMoneyBR(valorPadrao || '0');
        pagamentos.push({ codigo_barras: cb, data_pagamento: data, valor_pagar: v });
      }
      if (pagamentos.length === 0) throw new Error('Nenhum boleto válido no lote');
      if (pagamentos.length > 100) throw new Error('Máximo 100 boletos por lote');
      const semValor = pagamentos.filter((p) => !isFinite(p.valor_pagar) || p.valor_pagar <= 0);
      if (semValor.length > 0) throw new Error(`${semValor.length} boleto(s) sem valor.`);

      total = pagamentos.reduce((acc, p) => acc + Number(p.valor_pagar || 0), 0);
      const { data: resp, error } = await supabase.functions.invoke('inter-pagar-lote', { body: { pagamentos } });
      if (error) throw await parseFunctionError(error);
      if ((resp as any)?.error) throw new Error((resp as any).error);
      idLote = (resp as any)?.idLote ?? (resp as any)?.meuIdentificador;
      setUltimo({ id: String(idLote), total: pagamentos.length });
      toast.success(`Lote enviado (${pagamentos.length} boletos)`);
      await logInterPagamento({
        tipo: 'lote',
        descricao: `Lote de ${pagamentos.length} boleto(s)`,
        valor: total,
        destino: idLote ? maskDestino(String(idLote), 6) : null,
        status: 'enviado',
        retorno: resp,
      });
      setTexto('');
    } catch (e: any) {
      toast.error(`Falha lote: ${e?.message || e}`);
      await logInterPagamento({
        tipo: 'lote',
        descricao: 'Pagamento em lote',
        valor: total || null,
        destino: null,
        status: 'erro',
        retorno: { message: e?.message ?? String(e) },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Layers className="h-4 w-4 mr-2" />Pagamento em lote</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pagamento em lote</DialogTitle>
          <DialogDescription>
            Um código de barras por linha; adicione o valor após “;” se quiser (ex.: <code>34191...;150.00</code>). Máx. 100.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)}
            className="font-mono text-xs" placeholder="34191...;150.00&#10;34192...;89.90" />
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Data de pagamento</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
            <div><Label>Valor padrão (R$) — opcional</Label><Input inputMode="decimal" value={valorPadrao} onChange={(e) => setValorPadrao(e.target.value)} /></div>
          </div>
          {ultimo && (
            <p className="text-xs text-muted-foreground">
              Último lote — <b>{ultimo.total}</b> boletos — id: <code className="font-mono">{ultimo.id}</code>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!texto.trim() || loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Processar lote
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar pagamento em lote</AlertDialogTitle>
                <AlertDialogDescription>Enviar todos os boletos para pagamento em {data}.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={processar}>Processar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
