import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

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

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

export default function InterBank() {
  const [saldo, setSaldo] = useState<SaldoResp | null>(null);
  const [saldoLoading, setSaldoLoading] = useState(false);

  const [range, setRange] = useState<7 | 30>(7);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txsLoading, setTxsLoading] = useState(false);

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-saldo');
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      setSaldo(data as SaldoResp);
    } catch (e: any) {
      setSaldo({ error: e?.message ?? 'Falha na conexão' });
    } finally {
      setSaldoLoading(false);
    }
  }, []);

  const loadTxs = useCallback(async (days: 7 | 30) => {
    setTxsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-extrato-completo', {
        body: { data_inicio: daysAgoISO(days), data_fim: todayISO(), pagina: 0, tamanhoPagina: 100 },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      setTxs(((data as any)?.transacoes ?? []) as Tx[]);
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro no extrato Inter');
      setTxs([]);
    } finally {
      setTxsLoading(false);
    }
  }, []);

  useEffect(() => { loadSaldo(); loadTxs(7); }, [loadSaldo, loadTxs]);
  useEffect(() => { loadTxs(range); }, [range, loadTxs]);

  const conectado = !saldoLoading && !saldo?.error && saldo != null;

  return (
    <div className="space-y-6">
      {/* Grid: Status + Saldo */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Landmark className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Banco Inter</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Banco Inter Empresas · certificado mTLS
                  </p>
                </div>
              </div>
              {saldoLoading ? (
                <Badge variant="outline"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Conectando…</Badge>
              ) : conectado ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Conectado · Produção</Badge>
              ) : (
                <Badge className="bg-rose-600 hover:bg-rose-600 text-white">
                  Sem conexão{saldo?.error ? ` · ${saldo.error}` : ''}
                </Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Saldo */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm text-muted-foreground">Saldo disponível</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={loadSaldo} disabled={saldoLoading}>
              {saldoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Atualizar</span>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tabular-nums">
              {conectado ? fmtBRL(saldo?.disponivel ?? 0) : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-2 space-x-3">
              {(saldo?.bloqueado ?? 0) > 0 && <span>Bloqueado {fmtBRL(saldo!.bloqueado!)}</span>}
              {(saldo?.limite ?? 0) > 0 && <span>Limite {fmtBRL(saldo!.limite!)}</span>}
              <span>Atualizado {fmtDateTime(saldo?.atualizado_em)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Extrato */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Extrato</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Movimentações recentes da conta Inter.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant={range === 7 ? 'default' : 'outline'} size="sm" onClick={() => setRange(7)}>7 dias</Button>
              <Button variant={range === 30 ? 'default' : 'outline'} size="sm" onClick={() => setRange(30)}>30 dias</Button>
              <Button variant="ghost" size="sm" onClick={() => loadTxs(range)} disabled={txsLoading}>
                {txsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
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
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : txs.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Sem movimentações no período.</TableCell></TableRow>
                ) : txs.map((t, i) => {
                  const isDebit = (t.tipoOperacao === 'D');
                  const valor = Number(t.valor ?? 0) * (isDebit ? -1 : 1);
                  const desc = t.descricao || t.titulo || t.tipoTransacao || '—';
                  return (
                    <TableRow key={t.idTransacao || `${t.dataTransacao}-${i}`}>
                      <TableCell className="text-xs">{fmtDateTime(t.dataInclusao || t.dataTransacao)}</TableCell>
                      <TableCell className="text-sm">{desc}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${valor < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {fmtBRL(valor)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagamentos */}
      <InterPagamentosCard />
    </div>
  );
}

function InterPagamentosCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-2">
          <Send className="h-4 w-4 mt-0.5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Pagamentos</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Envio direto pelo Inter — boletos, DARF, Pix e lote.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <BoletoDialog />
          <DarfDialog />
          <PixDialog />
          <LoteDialog />
        </div>
        <p className="text-xs text-muted-foreground pt-2 border-t">
          A liberação final acontece na fila de aprovação do app do Banco Inter.
        </p>
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

  const ok = codigoBarras.replace(/\D/g, '').length >= 44 && !!dataPagamento;

  async function pagar() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-pagar-boleto', {
        body: {
          codigo_barras: codigoBarras.replace(/\D/g, ''),
          data_vencimento: dataPagamento,
          valor_pagar: valor ? Number(valor.replace(',', '.')) : undefined,
          descricao: desc || undefined,
        },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Boleto enviado para pagamento');
      setOpen(false); setCodigoBarras(''); setValor(''); setDesc('');
    } catch (e: any) {
      toast.error(`Falha no pagamento: ${e?.message || e}`);
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
              <Label htmlFor="i-v">Valor (R$) — opcional</Label>
              <Input id="i-v" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="usa o do boleto" />
            </div>
            <div>
              <Label htmlFor="i-dp">Data do pagamento</Label>
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
    && Number(valorPrincipal.replace(',', '.')) > 0;

  async function pagar() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-pagar-darf', {
        body: {
          cnpj_cpf: cnpjCpf.replace(/\D/g, ''),
          codigo_receita: codigoReceita,
          data_apuracao: dataApuracao,
          data_vencimento: dataVencimento,
          valor_principal: Number(valorPrincipal.replace(',', '.')),
          valor_multa: valorMulta ? Number(valorMulta.replace(',', '.')) : undefined,
          valor_juros: valorJuros ? Number(valorJuros.replace(',', '.')) : undefined,
          descricao: desc || undefined,
        },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('DARF enviado para pagamento');
      setOpen(false);
    } catch (e: any) {
      toast.error(`Falha no DARF: ${e?.message || e}`);
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

  const ok = !!chave && Number(valor.replace(',', '.')) > 0;

  async function enviar() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-pix', {
        body: {
          chave_pix: chave.trim(),
          valor: Number(valor.replace(',', '.')),
          descricao: desc || undefined,
        },
      });
      if (error) throw await parseFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      const codigo = (data as any)?.codigoSolicitacao ?? (data as any)?.endToEnd ?? '(sem código)';
      toast.success(`Pix enviado (${codigo})`);
      setOpen(false); setChave(''); setValor(''); setDesc('');
    } catch (e: any) {
      toast.error(`Falha Pix: ${e?.message || e}`);
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
    try {
      const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const pagamentos: any[] = [];
      for (const l of linhas) {
        const [cbRaw, vRaw] = l.split(/[;\t,|]/).map((x) => x?.trim());
        const cb = String(cbRaw ?? '').replace(/\D/g, '');
        if (!cb) continue;
        const v = vRaw ? Number(vRaw.replace(',', '.')) : Number((valorPadrao || '0').replace(',', '.'));
        pagamentos.push({ codigo_barras: cb, data_pagamento: data, valor_pagar: v });
      }
      if (pagamentos.length === 0) throw new Error('Nenhum boleto válido no lote');
      if (pagamentos.length > 100) throw new Error('Máximo 100 boletos por lote');
      const semValor = pagamentos.filter((p) => !isFinite(p.valor_pagar) || p.valor_pagar <= 0);
      if (semValor.length > 0) throw new Error(`${semValor.length} boleto(s) sem valor.`);

      const { data: resp, error } = await supabase.functions.invoke('inter-pagar-lote', { body: { pagamentos } });
      if (error) throw await parseFunctionError(error);
      if ((resp as any)?.error) throw new Error((resp as any).error);
      const idLote = (resp as any)?.idLote ?? (resp as any)?.meuIdentificador;
      setUltimo({ id: String(idLote), total: pagamentos.length });
      toast.success(`Lote enviado (${pagamentos.length} boletos)`);
      setTexto('');
    } catch (e: any) {
      toast.error(`Falha lote: ${e?.message || e}`);
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
