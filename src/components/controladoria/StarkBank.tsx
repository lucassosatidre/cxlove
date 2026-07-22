import { useState, useEffect, useCallback } from 'react';
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
import { Loader2, RefreshCw, QrCode, Copy, Lock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type SaldoResp = { ok: boolean; disponivel?: number; moeda?: string; atualizado_em?: string; error?: string };
type Tx = { id: string; amount: number; description: string; fee: number; source: string; created: string; balance: number | null };
type Invoice = {
  id: string; amount: number; nominalAmount: number | null; fee: number | null;
  name: string; taxId: string; status: string; brcode: string; link: string; due?: string; created?: string;
};

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
  if (s === 'paid') return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Pago</Badge>;
  if (s === 'created') return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">Aguardando</Badge>;
  if (s === 'expired') return <Badge variant="secondary">Expirada</Badge>;
  if (s === 'canceled') return <Badge variant="secondary">Cancelada</Badge>;
  if (s === 'overdue') return <Badge className="bg-rose-600 hover:bg-rose-600 text-white">Vencida</Badge>;
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

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

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
    try {
      const { data, error } = await supabase.functions.invoke('stark-extrato', {
        body: { after: daysAgoISO(days), limit: 100 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro ao carregar extrato');
      setTxs(data.transactions ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro no extrato Stark');
      setTxs([]);
    } finally {
      setTxsLoading(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('stark-cobrancas', {
        body: { action: 'list' },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro ao carregar cobranças');
      setInvoices(data.invoices ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro nas cobranças Stark');
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => { loadSaldo(); loadTxs(7); loadInvoices(); }, [loadSaldo, loadTxs, loadInvoices]);

  useEffect(() => { loadTxs(range); }, [range, loadTxs]);

  async function handleCreate() {
    const val = Number(String(amount).replace(',', '.'));
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

  return (
    <div className="space-y-6">
      {/* Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Stark Bank</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Projeto Vigia API · Permissão Financeiro
              </p>
            </div>
            {saldoLoading ? (
              <Badge variant="outline"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Conectando…</Badge>
            ) : saldo?.ok ? (
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
          <CardTitle className="text-sm text-muted-foreground">Saldo disponível</CardTitle>
          <Button variant="ghost" size="sm" onClick={loadSaldo} disabled={saldoLoading}>
            {saldoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold tabular-nums">
            {saldo?.ok ? fmtBRL(saldo.disponivel ?? 0) : '—'}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Atualizado em {fmtDateTime(saldo?.atualizado_em)}
          </p>
        </CardContent>
      </Card>

      {/* Extrato */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">Extrato</CardTitle>
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
                ) : txs.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{fmtDateTime(t.created)}</TableCell>
                    <TableCell className="text-sm">{t.description || t.source}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${t.amount < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                      {fmtBRL(t.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Receber (Cobranças Pix) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Receber (Cobranças Pix)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Gere cobranças com QR Code / Pix Copia e Cola.</p>
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
                      <div className="text-xl font-bold tabular-nums">{fmtBRL(createdInvoice.amount)}</div>
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
                          <Button size="sm" variant="outline" onClick={() => copy(createdInvoice.link, 'Link copiado')}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <a href={createdInvoice.link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
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
          <div className="rounded-md border">
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
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>
                ) : invoices.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhuma cobrança emitida ainda.</TableCell></TableRow>
                ) : invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div className="text-sm">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{i.taxId}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRL(i.amount)}</TableCell>
                    <TableCell className="text-xs">{fmtDate(i.due)}</TableCell>
                    <TableCell>{statusBadge(i.status)}</TableCell>
                    <TableCell className="text-right">
                      {i.brcode && (
                        <Button variant="ghost" size="sm" onClick={() => copy(i.brcode, 'Pix Copia e Cola copiado')}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Seção travada */}
      <Card className="opacity-70 border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Pagamentos automáticos e avisos em tempo real 🔒
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Pagar boletos/contas/impostos pelo app e receber aviso na hora que um Pix é pago exigem
            a permissão <strong>Administrador</strong> do Stark, que requer servidor com IP fixo.
            Em construção.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
