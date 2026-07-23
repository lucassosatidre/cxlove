import { useState, useEffect, useCallback } from 'react';
import { isAprovadorUI } from '@/lib/aprovadores';
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
  Loader2, RefreshCw, QrCode, Copy, ExternalLink, Ban,
  Landmark, Wallet, FileText, Send, Receipt, AlertCircle, Inbox,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { parseMoneyBR, formatMoneyBR } from '@/lib/money';

type SaldoResp = { ok: boolean; disponivel?: number; moeda?: string; atualizado_em?: string; error?: string };
type Tx = { id: string; amount: number; description: string; fee: number; source: string; created: string; balance: number | null };
type Invoice = {
  id: string; amount: number; nominalAmount: number | null; fee: number | null;
  name: string; taxId: string; status: string; brcode: string; link: string; due?: string; created?: string;
};

const fmtDateTime = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
};

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
};

function statusBadge(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return <Badge className="bg-success text-success-foreground hover:bg-success">Pago</Badge>;
  if (s === 'created') return <Badge className="bg-warning text-warning-foreground hover:bg-warning">Aguardando</Badge>;
  if (s === 'expired') return <Badge variant="secondary">Expirada</Badge>;
  if (s === 'canceled') return <Badge variant="secondary">Cancelada</Badge>;
  if (s === 'overdue') return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive">Vencida</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function StarkBank() {
  const [saldo, setSaldo] = useState<SaldoResp | null>(null);
  const [saldoLoading, setSaldoLoading] = useState(false);

  const [range, setRange] = useState<7 | 30>(7);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txsLoading, setTxsLoading] = useState(false);
  const [txsError, setTxsError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [due, setDue] = useState('');
  const [description, setDescription] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('stark-saldo');
      if (error) throw error;
      setSaldo(data as SaldoResp);
    } catch (e: any) {
      setSaldo({ ok: false, error: e?.message ?? 'Falha na conexão' });
    } finally {
      setSaldoLoading(false);
    }
  }, []);

  const loadTxs = useCallback(async (days: 7 | 30) => {
    setTxsLoading(true);
    setTxsError(null);
    try {
      const { data, error } = await supabase.functions.invoke('stark-extrato', {
        body: { after: daysAgoISO(days), limit: 100 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro ao carregar extrato');
      setTxs(data.transactions ?? []);
    } catch (e: any) {
      setTxsError(e?.message ?? 'Erro no extrato Stark');
      setTxs([]);
    } finally {
      setTxsLoading(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const { data, error } = await supabase.functions.invoke('stark-cobrancas', {
        body: { action: 'list' },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro ao carregar cobranças');
      setInvoices(data.invoices ?? []);
    } catch (e: any) {
      setInvoicesError(e?.message ?? 'Erro nas cobranças Stark');
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => { loadSaldo(); loadInvoices(); }, [loadSaldo, loadInvoices]);
  // Efeito único: dispara no mount e ao trocar range (evita fetch duplicado).
  useEffect(() => { loadTxs(range); }, [range, loadTxs]);

  async function handleCreate() {
    const val = parseMoneyBR(amount);
    if (!val || val <= 0) { toast.error('Informe um valor válido'); return; }
    if (!name.trim()) { toast.error('Nome do pagador é obrigatório'); return; }
    const cleanTax = taxId.replace(/\D/g, '');
    if (cleanTax.length !== 11 && cleanTax.length !== 14) { toast.error('CPF/CNPJ inválido'); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('stark-cobrancas', {
        body: {
          action: 'create',
          amount: val,
          name: name.trim(),
          taxId: cleanTax,
          due: due || undefined,
          description: description || undefined,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro ao criar cobrança');
      setCreatedInvoice(data.invoice as Invoice);
      toast.success('Cobrança Pix criada');
      loadInvoices();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao criar cobrança');
    } finally {
      setCreating(false);
    }
  }

  function resetDialog() {
    setAmount(''); setName(''); setTaxId(''); setDue(''); setDescription('');
    setCreatedInvoice(null);
  }

  async function copy(text: string, label = 'Copiado') {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Falha ao copiar');
    }
  }

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  async function handleCancel(id: string) {
    setCancelingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('stark-cobrancas', {
        body: { action: 'cancel', id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro ao cancelar cobrança');
      toast.success('Cobrança cancelada');
      loadInvoices();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao cancelar cobrança');
    } finally {
      setCancelingId(null);
    }
  }

  const conectado = !saldoLoading && saldo?.ok;

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
                  <CardTitle className="font-brand">Stark Bank</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Conta digital</p>
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
            ) : !saldo?.ok ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" aria-hidden="true" />
                <div className="text-sm">
                  <p className="text-destructive font-medium">Não deu para ler o saldo</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{saldo?.error ?? 'Falha na conexão'}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={loadSaldo}>
                    <RefreshCw className="h-3 w-3 mr-1" />Tentar de novo
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-4xl font-bold font-mono-tabular text-accent">
                  {formatMoneyBR(saldo.disponivel ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Atualizado em {fmtDateTime(saldo?.atualizado_em)}
                </p>
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
                <p className="text-xs text-muted-foreground mt-1">Movimentações recentes da conta Stark.</p>
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
                          <p className="text-xs text-muted-foreground mt-1">Tente 30 dias.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : txs.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs">{fmtDateTime(t.created)}</TableCell>
                      <TableCell className="text-sm">{t.description || t.source}</TableCell>
                      <TableCell className={`text-right font-mono-tabular font-medium ${t.amount < 0 ? 'text-destructive' : 'text-success'}`}>
                        {formatMoneyBR(t.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receber (Cobranças Pix) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <QrCode className="h-4 w-4 mt-0.5 text-accent" aria-hidden="true" />
              <div>
                <CardTitle className="font-brand">Receber (Cobranças Pix)</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Gere cobranças com QR Code / Pix Copia e Cola.</p>
              </div>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetDialog(); }}>
              <DialogTrigger asChild>
                <Button size="sm"><QrCode className="h-4 w-4 mr-2" />Gerar cobrança Pix</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Nova cobrança Pix</DialogTitle>
                  <DialogDescription>Preencha os dados do pagador.</DialogDescription>
                </DialogHeader>

                {createdInvoice ? (
                  <div className="space-y-3">
                    <div className="text-sm">
                      <div className="text-muted-foreground">Valor</div>
                      <div className="text-xl font-bold font-mono-tabular">{formatMoneyBR(createdInvoice.amount)}</div>
                    </div>
                    <div>
                      <Label className="text-xs">Pix Copia e Cola</Label>
                      <div className="flex gap-2 mt-1">
                        <Textarea readOnly value={createdInvoice.brcode} className="font-mono text-xs h-24" />
                      </div>
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => copy(createdInvoice.brcode, 'Pix Copia e Cola copiado')}>
                        <Copy className="h-4 w-4 mr-2" />Copiar código
                      </Button>
                    </div>
                    {createdInvoice.link && (
                      <div>
                        <Label className="text-xs">Link</Label>
                        <div className="flex gap-2 mt-1">
                          <Input readOnly value={createdInvoice.link} className="text-xs" />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copy(createdInvoice.link, 'Link copiado')}
                            aria-label="Copiar link"
                            title="Copiar link"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={createdInvoice.link}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Abrir link em nova aba"
                              title="Abrir link"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => { resetDialog(); }}>Nova cobrança</Button>
                      <Button onClick={() => setDialogOpen(false)}>Fechar</Button>
                    </DialogFooter>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="stark-amount">Valor (R$)</Label>
                      <Input id="stark-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="stark-name">Nome do pagador</Label>
                      <Input id="stark-name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="stark-tax">CPF/CNPJ</Label>
                      <Input id="stark-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Só dígitos ou formatado" />
                    </div>
                    <div>
                      <Label htmlFor="stark-due">Vencimento (opcional)</Label>
                      <Input id="stark-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value ? new Date(e.target.value).toISOString() : '')} />
                    </div>
                    <div>
                      <Label htmlFor="stark-desc">Descrição (opcional)</Label>
                      <Input id="stark-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                      <Button onClick={handleCreate} disabled={creating}>
                        {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Criar cobrança
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {invoicesError ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <AlertCircle className="h-10 w-10 text-destructive mb-2" aria-hidden="true" />
              <p className="font-medium text-destructive">Erro ao carregar cobranças</p>
              <p className="text-xs text-muted-foreground mt-1">{invoicesError}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={loadInvoices}>
                <RefreshCw className="h-3 w-3 mr-1" />Tentar de novo
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pagador</TableHead>
                    <TableHead className="w-[140px] text-right">Valor</TableHead>
                    <TableHead className="w-[140px]">Vencimento</TableHead>
                    <TableHead className="w-[140px]">Status</TableHead>
                    <TableHead className="w-[80px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoicesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={`ivsk-${i}`}>
                        <TableCell colSpan={5}><Skeleton className="h-5 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <QrCode className="h-10 w-10 text-muted-foreground mb-2" aria-hidden="true" />
                          <p className="font-medium">Nenhuma cobrança emitida ainda</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Clique em "Gerar cobrança Pix" para criar a primeira.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : invoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="text-sm">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{i.taxId}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono-tabular">{formatMoneyBR(i.amount)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(i.due)}</TableCell>
                      <TableCell>{statusBadge(i.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {i.brcode && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copy(i.brcode, 'Pix Copia e Cola copiado')}
                              aria-label="Copiar Pix Copia e Cola"
                              title="Copiar Pix Copia e Cola"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          {i.status?.toLowerCase() === 'created' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={cancelingId === i.id}
                                  aria-label="Cancelar cobrança"
                                  title="Cancelar cobrança"
                                >
                                  {cancelingId === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4 text-destructive" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Cancelar cobrança?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {i.name} · {formatMoneyBR(i.amount)}. Essa ação não pode ser desfeita.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleCancel(i.id)}>
                                    Cancelar cobrança
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagamentos com aprovação */}
      <StarkPagamentosCard />
    </div>
  );
}

function mapErroPagamento(raw: string | null | undefined): string {
  const s = (raw || '').toLowerCase();
  if (!s) return 'Não foi possível pagar. Confira o código e tente novamente.';
  if (s.includes('invalidbarcode') || s.includes('bar code') || s.includes('barcode')) return 'Código de barras inválido';
  if (s.includes('insufficientfunds') || s.includes('saldo')) return 'Saldo insuficiente na conta';
  if (s.includes('invalidjson') || s.includes('taxid')) return 'Dados do boleto incompletos';
  if (s.includes('expired') || s.includes('overdue')) return 'Boleto vencido';
  return 'Não foi possível pagar. Confira o código e tente novamente.';
}


type Pagamento = {
  id: string;
  tipo: string;
  linha: string;
  description: string | null;
  amount_reais: number | null;
  beneficiario: string | null;
  status: string;
  erro: string | null;
  stark_id: string | null;
  created_at: string;
  approved_at: string | null;
  processed_at: string | null;
};

function pagStatusBadge(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'aguardando_aprovacao') return <Badge className="bg-warning text-warning-foreground hover:bg-warning">Aguardando aprovação</Badge>;
  if (s === 'aprovado') return <Badge className="bg-info text-info-foreground hover:bg-info">Aprovado — na fila</Badge>;
  if (s === 'processando') return <Badge className="bg-info text-info-foreground hover:bg-info animate-pulse">Processando…</Badge>;
  if (s === 'sucesso') return <Badge className="bg-success text-success-foreground hover:bg-success">Pago</Badge>;
  if (s === 'falha') return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive">Falhou</Badge>;
  if (s === 'recusado') return <Badge variant="secondary">Recusado</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// A lista de aprovadores é SÓ ESTÉTICA (esconde botões pra quem não é aprovador).
// A segurança real está na edge stark-aprovar: whitelist + senha validadas no servidor.

function StarkPagamentosCard() {
  const [list, setList] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [linha, setLinha] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [aprovarDialog, setAprovarDialog] = useState<Pagamento | null>(null);
  const [senha, setSenha] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail((data?.user?.email || '').toLowerCase() || null);
    });
  }, []);

  const isAprovador = isAprovadorUI(userEmail);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await (supabase as any)
        .from('stark_pagamentos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setList((data ?? []) as Pagamento[]);
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar pagamentos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('stark_pagamentos_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stark_pagamentos' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function submit() {
    const raw = linha.trim();
    const hasLetters = /[A-Za-z]/.test(raw);
    let payload = '';
    if (hasLetters) {
      const compact = raw.replace(/\s+/g, '');
      if (compact.length < 30) { toast.error('Pix copia-e-cola inválido'); return; }
      payload = compact;
    } else {
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 20) { toast.error('Linha digitável inválida'); return; }
      payload = digits;
    }
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from('stark_pagamentos').insert({
        tipo: 'boleto',
        linha: payload,
        description: desc.trim() || 'Pagamento Vigia',
        created_by: userRes?.user?.id ?? null,
      });
      if (error) throw error;
      toast.success('Enviado para aprovação');
      setOpen(false); setLinha(''); setDesc('');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao enviar');
    } finally {
      setSaving(false);
    }
  }


  async function confirmarAprovacao() {
    if (!aprovarDialog) return;
    if (!senha) { toast.error('Informe a senha'); return; }
    setActingId(aprovarDialog.id);
    try {
      const { data, error } = await supabase.functions.invoke('stark-aprovar', {
        body: { id: aprovarDialog.id, decisao: 'aprovar', senha },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.error || 'Falha ao aprovar');
        setSenha('');
        return;
      }
      toast.success('Aprovado — porteiro executa em até 1 minuto');
      setAprovarDialog(null);
      setSenha('');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao aprovar');
      setSenha('');
    } finally {
      setActingId(null);
    }
  }

  async function recusar(id: string) {
    setActingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('stark-aprovar', {
        body: { id, decisao: 'recusar' },
      });
      if (error) throw error;
      if (!data?.ok) { toast.error(data?.error || 'Falha ao recusar'); return; }
      toast.success('Pagamento recusado');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao recusar');
    } finally {
      setActingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2">
            <Send className="h-4 w-4 mt-0.5 text-accent" aria-hidden="true" />
            <div>
              <CardTitle className="font-brand">Pagamentos (com aprovação)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Envie boletos ou Pix copia-e-cola para a fila. A execução acontece após aprovação.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={load}
              disabled={loading}
              aria-label="Atualizar pagamentos"
              title="Atualizar pagamentos"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Receipt className="h-4 w-4 mr-2" />Pagar conta</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Novo pagamento</DialogTitle>
                  <DialogDescription>
                    Cole a linha digitável (boleto, consumo, tributo) ou um Pix copia-e-cola. O tipo é detectado automaticamente.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="pag-linha">Linha digitável ou Pix copia-e-cola</Label>
                    <Textarea
                      id="pag-linha"
                      value={linha}
                      onChange={(e) => setLinha(e.target.value)}
                      className="font-mono text-xs h-24"
                      placeholder="Com ou sem pontuação"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pag-desc">Descrição (opcional)</Label>
                    <Input
                      id="pag-desc"
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      placeholder="Pagamento Vigia"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button onClick={submit} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Enviar para aprovação
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
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
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right w-[120px]">Valor</TableHead>
                  <TableHead className="w-[190px]">Status</TableHead>
                  <TableHead className="w-[170px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`pgsk-${i}`}>
                      <TableCell colSpan={5}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <Receipt className="h-10 w-10 text-muted-foreground mb-2" aria-hidden="true" />
                        <p className="font-medium">Nenhum pagamento ainda</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Clique em "Pagar conta" para enviar o primeiro para aprovação.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : list.map((p) => {
                  const titulo = p.beneficiario || p.description || '—';
                  const subtitulo = p.beneficiario && p.description && p.description !== p.beneficiario ? p.description : null;
                  return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{fmtDateTime(p.created_at)}</TableCell>
                    <TableCell className="text-sm">
                      <div>{titulo}</div>
                      {subtitulo && <div className="text-xs text-muted-foreground">{subtitulo}</div>}
                      {p.status === 'falha' && p.erro && <div className="text-xs text-destructive mt-1">{mapErroPagamento(p.erro)}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono-tabular">{p.amount_reais != null ? formatMoneyBR(Number(p.amount_reais)) : '—'}</TableCell>
                    <TableCell>{pagStatusBadge(p.status)}</TableCell>
                    <TableCell className="text-right">
                      {p.status === 'aguardando_aprovacao' && isAprovador && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-success text-success-foreground hover:bg-success/90"
                            disabled={actingId === p.id}
                            onClick={() => { setAprovarDialog(p); setSenha(''); }}
                          >
                            {actingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aprovar'}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline" disabled={actingId === p.id}>Recusar</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Recusar pagamento?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  O pagamento ficará marcado como recusado e não será enviado ao porteiro.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Voltar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => recusar(p.id)}>Recusar</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          O pagamento sai só depois de aprovado com senha. Toda aprovação fica registrada.
        </p>
      </CardContent>

      <Dialog open={!!aprovarDialog} onOpenChange={(v) => { if (!v) { setAprovarDialog(null); setSenha(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aprovar pagamento</DialogTitle>
            <DialogDescription>
              Essa ação libera saída de dinheiro. O porteiro executa em até 1 minuto.
            </DialogDescription>
          </DialogHeader>
          {aprovarDialog && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div><span className="text-muted-foreground">Descrição: </span>{aprovarDialog.description || '—'}</div>
                <div><span className="text-muted-foreground">Linha: </span><span className="font-mono">…{aprovarDialog.linha.slice(-8)}</span></div>
              </div>
              <div>
                <Label htmlFor="pag-senha">Senha de aprovação</Label>
                <Input
                  id="pag-senha"
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && senha) confirmarAprovacao(); }}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAprovarDialog(null); setSenha(''); }}>Cancelar</Button>
            <Button
              onClick={confirmarAprovacao}
              disabled={!senha || actingId === aprovarDialog?.id}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {actingId === aprovarDialog?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar aprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
