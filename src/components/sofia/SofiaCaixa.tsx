import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Printer, Pencil, X, Plus, Trash2, Bike, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/payment-utils';

interface Sabor { fracao?: string | null; nome: string }
interface Item {
  tipo: 'pizza' | 'bebida' | 'outro';
  nome: string;
  qtd: number;
  tamanho?: string | null;
  categoria?: 'salgada' | 'doce' | null;
  sabores?: Sabor[];
  borda?: string | null;
  valor?: number;
  obs?: string | null;
}
interface Order {
  id: string;
  numero: number;
  created_at: string;
  sofia_call_id: string | null;
  origem: string;
  nome_cliente: string | null;
  telefone: string | null;
  tipo: 'entrega' | 'retirada';
  endereco: string | null;
  bairro: string | null;
  complemento: string | null;
  referencia: string | null;
  taxa_entrega: number;
  subtotal: number;
  total: number;
  forma_pagamento: string | null;
  troco_para: number | null;
  observacoes: string | null;
  itens: Item[];
  status: 'pendente_conferencia' | 'pendente_impressao' | 'impresso' | 'cancelado';
  impresso_em: string | null;
}

const PAG_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro', maquininha: 'Maquininha (na entrega)', pix: 'PIX', pago: 'Já pago',
};

function saborStr(s: Sabor): string {
  const f = (s.fracao ?? '').trim();
  if (!f || f === '1/1' || /inteir/i.test(f)) return s.nome;
  return `${f} ${s.nome}`;
}
function horaBR(iso: string) {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export default function SofiaCaixa() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoPrint, setAutoPrint] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('sofia_orders')
      .select('*')
      .gte('created_at', since)
      .neq('status', 'cancelado')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error('Erro ao carregar pedidos: ' + error.message);
    else setOrders((data ?? []) as Order[]);
    setLoading(false);
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('sofia_settings').select('data').eq('slug', 'caixa').maybeSingle();
    setAutoPrint(!!(data?.data as any)?.auto_print);
  }, []);

  useEffect(() => {
    load();
    loadSettings();
    const ch = supabase
      .channel('sofia_orders_caixa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sofia_orders' }, () => load())
      .subscribe();
    return () => { ch.unsubscribe(); supabase.removeChannel(ch); };
  }, [load, loadSettings]);

  async function toggleAuto(v: boolean) {
    setAutoPrint(v);
    const { error } = await supabase.from('sofia_settings')
      .upsert({ slug: 'caixa', data: { auto_print: v } }, { onConflict: 'slug' });
    if (error) { toast.error('Não salvou o modo: ' + error.message); setAutoPrint(!v); }
    else toast.success(v ? 'Modo automático LIGADO — pedidos vão direto pra cozinha' : 'Modo conferência LIGADO — você revisa antes de imprimir');
  }

  async function setStatus(o: Order, status: Order['status'], extra: Record<string, unknown> = {}) {
    setBusy(o.id);
    const { data: { user } } = await supabase.auth.getUser();
    const patch: Record<string, unknown> = { status, ...extra };
    if (status === 'pendente_impressao') patch.conferido_por = user?.id ?? null;
    const { error } = await supabase.from('sofia_orders').update(patch).eq('id', o.id);
    setBusy(null);
    if (error) toast.error('Erro: ' + error.message);
    else { toast.success(status === 'pendente_impressao' ? `Pedido #${o.numero} enviado pra cozinha` : 'Atualizado'); load(); }
  }

  const pendentes = orders.filter((o) => o.status === 'pendente_conferencia');
  const naFila = orders.filter((o) => o.status === 'pendente_impressao');
  const impressos = orders.filter((o) => o.status === 'impresso');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="flex items-center gap-3">
          <Switch id="auto" checked={autoPrint} onCheckedChange={toggleAuto} />
          <Label htmlFor="auto" className="cursor-pointer">
            <span className="font-medium">Modo automático</span>
            <span className="block text-xs text-muted-foreground">
              {autoPrint ? 'Pedidos da Sofia vão direto pra impressora da cozinha.' : 'Pedidos esperam você conferir e clicar em imprimir.'}
            </span>
          </Label>
        </div>
        <Button onClick={load} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
        </Button>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground py-8">Carregando...</p>
      ) : orders.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nenhum pedido da Sofia ainda. Quando ela fechar um pedido, ele aparece aqui.</p>
      ) : (
        <div className="space-y-6">
          <Secao titulo="Aguardando conferência" cor="amber" itens={pendentes} vazio="Nada pra conferir agora.">
            {(o) => (
              <OrderCard key={o.id} o={o} busy={busy === o.id}
                onImprimir={() => setStatus(o, 'pendente_impressao')}
                onEditar={() => setEditing(o)}
                onCancelar={() => setStatus(o, 'cancelado')} />
            )}
          </Secao>
          {naFila.length > 0 && (
            <Secao titulo="Na fila da cozinha" cor="blue" itens={naFila} vazio="">
              {(o) => (
                <OrderCard key={o.id} o={o} busy={busy === o.id} naFila
                  onVoltar={() => setStatus(o, 'pendente_conferencia')}
                  onCancelar={() => setStatus(o, 'cancelado')} />
              )}
            </Secao>
          )}
          {impressos.length > 0 && (
            <Secao titulo="Impressos" cor="green" itens={impressos} vazio="">
              {(o) => (
                <OrderCard key={o.id} o={o} busy={busy === o.id} impresso
                  onReimprimir={() => setStatus(o, 'pendente_impressao', { impresso_em: null })}
                  onEditar={() => setEditing(o)} />
              )}
            </Secao>
          )}
        </div>
      )}

      <EditDialog order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </div>
  );
}

function Secao({ titulo, cor, itens, vazio, children }: {
  titulo: string; cor: string; itens: Order[]; vazio: string;
  children: (o: Order) => ReactNode;
}) {
  const dot = cor === 'amber' ? 'bg-amber-500' : cor === 'blue' ? 'bg-blue-500' : 'bg-green-500';
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <h3 className="font-semibold">{titulo}</h3>
        <Badge variant="secondary">{itens.length}</Badge>
      </div>
      {itens.length === 0 ? (
        vazio ? <p className="text-sm text-muted-foreground">{vazio}</p> : null
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{itens.map(children)}</div>
      )}
    </div>
  );
}

function OrderCard({ o, busy, naFila, impresso, onImprimir, onEditar, onCancelar, onVoltar, onReimprimir }: {
  o: Order; busy: boolean; naFila?: boolean; impresso?: boolean;
  onImprimir?: () => void; onEditar?: () => void; onCancelar?: () => void;
  onVoltar?: () => void; onReimprimir?: () => void;
}) {
  const pizzas = (o.itens ?? []).filter((i) => i.tipo === 'pizza');
  const bebidas = (o.itens ?? []).filter((i) => i.tipo === 'bebida');
  const outros = (o.itens ?? []).filter((i) => i.tipo === 'outro');
  const troco = o.forma_pagamento === 'dinheiro' && o.troco_para && o.troco_para > o.total
    ? o.troco_para - o.total : null;

  return (
    <Card className="p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">#{o.numero}</span>
          {o.tipo === 'entrega'
            ? <Badge variant="outline" className="gap-1"><Bike className="h-3 w-3" />Entrega</Badge>
            : <Badge variant="outline" className="gap-1"><ShoppingBag className="h-3 w-3" />Retirada</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          {horaBR(o.created_at)}{impresso && o.impresso_em ? ` · impresso ${horaBR(o.impresso_em)}` : ''}
        </span>
      </div>

      <div>
        <div className="font-medium">{o.nome_cliente || 'Sem nome'}</div>
        {o.telefone && <div className="text-xs text-muted-foreground">{o.telefone}</div>}
        {o.tipo === 'entrega' && (o.endereco || o.bairro) && (
          <div className="text-xs text-muted-foreground">
            {[o.endereco, o.complemento, o.bairro].filter(Boolean).join(', ')}
            {o.referencia ? ` — ref: ${o.referencia}` : ''}
          </div>
        )}
      </div>

      <div className="rounded bg-muted/40 p-2 space-y-1">
        {pizzas.map((it, i) => (
          <div key={i}>
            <div className="font-medium">{it.qtd}x {it.nome}</div>
            {(it.sabores ?? []).length > 0 && (
              <div className="pl-3 text-xs">{(it.sabores ?? []).map(saborStr).join(' + ')}</div>
            )}
            {it.borda && <div className="pl-3 text-xs">Borda: {it.borda}</div>}
            {it.obs && <div className="pl-3 text-xs italic">obs: {it.obs}</div>}
          </div>
        ))}
        {bebidas.map((it, i) => <div key={`b${i}`}>{it.qtd}x {it.nome}</div>)}
        {outros.map((it, i) => <div key={`o${i}`}>{it.qtd}x {it.nome}</div>)}
      </div>

      {o.observacoes && <div className="text-xs italic">Obs: {o.observacoes}</div>}

      <div className="flex items-center justify-between text-xs">
        <span>
          {o.forma_pagamento ? (PAG_LABEL[o.forma_pagamento] ?? o.forma_pagamento) : 'Pagamento não informado'}
          {troco ? ` · troco p/ ${formatCurrency(o.troco_para!)} (devolver ${formatCurrency(troco)})` : ''}
        </span>
      </div>
      <div className="flex items-center justify-between border-t pt-1">
        <span className="text-xs text-muted-foreground">
          {o.tipo === 'entrega' && o.taxa_entrega > 0 ? `Itens ${formatCurrency(o.subtotal)} + entrega ${formatCurrency(o.taxa_entrega)}` : ''}
        </span>
        <span className="font-bold">{formatCurrency(o.total)}</span>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {onImprimir && (
          <Button size="sm" onClick={onImprimir} disabled={busy}>
            <Printer className="h-4 w-4 mr-1" /> Imprimir na cozinha
          </Button>
        )}
        {onReimprimir && (
          <Button size="sm" variant="outline" onClick={onReimprimir} disabled={busy}>
            <Printer className="h-4 w-4 mr-1" /> Imprimir de novo
          </Button>
        )}
        {onVoltar && (
          <Button size="sm" variant="outline" onClick={onVoltar} disabled={busy}>Voltar p/ conferência</Button>
        )}
        {onEditar && (
          <Button size="sm" variant="outline" onClick={onEditar} disabled={busy}>
            <Pencil className="h-4 w-4 mr-1" /> Editar
          </Button>
        )}
        {onCancelar && (
          <Button size="sm" variant="ghost" onClick={onCancelar} disabled={busy} className="text-destructive">
            <X className="h-4 w-4 mr-1" /> Cancelar
          </Button>
        )}
      </div>
      {naFila && <p className="text-xs text-blue-600">Esperando a cozinha imprimir...</p>}
    </Card>
  );
}

function EditDialog({ order, onClose, onSaved }: {
  order: Order | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(0);
  useEffect(() => {
    if (!order) { setForm(null); return; }
    const clone = JSON.parse(JSON.stringify(order)) as Order;
    clone.itens = (clone.itens ?? []).map((it) => ({ ...it, _k: keyRef.current++ } as any));
    setForm(clone);
  }, [order]);
  if (!form) return null;

  const upd = (patch: Partial<Order>) => setForm({ ...form, ...patch });
  const updItem = (idx: number, patch: Partial<Item>) => {
    const itens = form.itens.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setForm({ ...form, itens });
  };
  const setSaboresText = (idx: number, txt: string) => {
    const sabores: Sabor[] = txt.split('+').map((p) => p.trim()).filter(Boolean).map((p) => {
      const m = p.match(/^(\d+\s*\/\s*\d+)\s+(.+)$/);
      return m ? { fracao: m[1].replace(/\s+/g, ''), nome: m[2].trim() } : { fracao: null, nome: p };
    });
    updItem(idx, { sabores });
  };
  const addItem = () => setForm({ ...form, itens: [...form.itens, { tipo: 'pizza', nome: 'Pizza', qtd: 1, sabores: [], _k: keyRef.current++ } as any] });
  const delItem = (idx: number) => setForm({ ...form, itens: form.itens.filter((_, i) => i !== idx) });

  async function save() {
    if (!form) return;
    setSaving(true);
    // Só os campos editáveis — numero/dia/status/origem/raw são imutáveis aqui.
    const patch = {
      nome_cliente: form.nome_cliente,
      telefone: form.telefone,
      tipo: form.tipo,
      endereco: form.endereco,
      bairro: form.bairro,
      complemento: form.complemento,
      referencia: form.referencia,
      forma_pagamento: form.forma_pagamento,
      observacoes: form.observacoes,
      taxa_entrega: Number(form.taxa_entrega) || 0,
      subtotal: Number(form.subtotal) || 0,
      total: Number(form.total) || 0,
      troco_para: form.troco_para ? Number(form.troco_para) : null,
      itens: form.itens.map(({ _k, ...it }: any) => it),
    };
    const { error } = await supabase.from('sofia_orders').update(patch).eq('id', form.id);
    setSaving(false);
    if (error) toast.error('Erro ao salvar: ' + error.message);
    else { toast.success('Pedido atualizado'); onSaved(); }
  }

  return (
    <Dialog open={!!order} onOpenChange={(op) => !op && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar pedido #{form.numero}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cliente"><Input value={form.nome_cliente ?? ''} onChange={(e) => upd({ nome_cliente: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={form.telefone ?? ''} onChange={(e) => upd({ telefone: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tipo">
              <Select value={form.tipo} onValueChange={(v) => upd({ tipo: v as Order['tipo'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrega">Entrega</SelectItem>
                  <SelectItem value="retirada">Retirada</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Pagamento">
              <Select value={form.forma_pagamento ?? ''} onValueChange={(v) => upd({ forma_pagamento: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="maquininha">Maquininha (na entrega)</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="pago">Já pago</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {form.tipo === 'entrega' && (
            <>
              <Field label="Endereço"><Input value={form.endereco ?? ''} onChange={(e) => upd({ endereco: e.target.value })} /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Bairro"><Input value={form.bairro ?? ''} onChange={(e) => upd({ bairro: e.target.value })} /></Field>
                <Field label="Complemento"><Input value={form.complemento ?? ''} onChange={(e) => upd({ complemento: e.target.value })} /></Field>
                <Field label="Referência"><Input value={form.referencia ?? ''} onChange={(e) => upd({ referencia: e.target.value })} /></Field>
              </div>
            </>
          )}
          <div className="grid grid-cols-3 gap-2">
            {form.forma_pagamento === 'dinheiro' && (
              <Field label="Troco para"><Input type="number" value={form.troco_para ?? ''} onChange={(e) => upd({ troco_para: e.target.value ? Number(e.target.value) : null })} /></Field>
            )}
            {form.tipo === 'entrega' && (
              <Field label="Taxa entrega"><Input type="number" value={form.taxa_entrega} onChange={(e) => upd({ taxa_entrega: Number(e.target.value) })} /></Field>
            )}
            <Field label="Total (cobrar)"><Input type="number" value={form.total} onChange={(e) => upd({ total: Number(e.target.value) })} /></Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Itens</Label>
              <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" />Item</Button>
            </div>
            {form.itens.map((it, idx) => (
              <div key={(it as any)._k ?? idx} className="rounded border p-2 space-y-2">
                <div className="flex gap-2">
                  <Select value={it.tipo} onValueChange={(v) => updItem(idx, { tipo: v as Item['tipo'] })}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pizza">Pizza</SelectItem>
                      <SelectItem value="bebida">Bebida</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="w-16" type="number" value={it.qtd} onChange={(e) => updItem(idx, { qtd: Number(e.target.value) || 1 })} />
                  <Input value={it.nome} onChange={(e) => updItem(idx, { nome: e.target.value })} placeholder="Nome" />
                  <Button size="icon" variant="ghost" onClick={() => delItem(idx)} className="text-destructive shrink-0"><Trash2 className="h-4 w-4" /></Button>
                </div>
                {it.tipo === 'pizza' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={(it.sabores ?? []).map(saborStr).join(' + ')} onChange={(e) => setSaboresText(idx, e.target.value)} placeholder="Sabores: 1/2 Calabresa + 1/2 Catupiry" />
                    <Input value={it.borda ?? ''} onChange={(e) => updItem(idx, { borda: e.target.value || null })} placeholder="Borda (ex.: Catupiry)" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <Field label="Observações"><Textarea value={form.observacoes ?? ''} onChange={(e) => upd({ observacoes: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
