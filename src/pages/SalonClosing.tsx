import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, AlertCircle, CheckCircle2, Banknote, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { formatCurrency } from '@/lib/payment-utils';
import MachineReadingsSection from '@/components/MachineReadingsSection';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface SalonOrder {
  id: string;
  order_type: string;
  sale_time: string | null;
  sale_date: string | null;
  payment_method: string;
  total_amount: number;
}

interface ClosingData {
  id: string;
  closing_date: string;
  status: string;
}

export default function SalonClosing() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SalonOrder[]>([]);
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');

  // Cash calculator state - Abertura
  const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.25, 0.10, 0.05];
  const [showCashCalcAbertura, setShowCashCalcAbertura] = useState(false);
  const [cashCountsAbertura, setCashCountsAbertura] = useState<Record<number, number>>({});
  const cashTotalAbertura = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (cashCountsAbertura[d] || 0), 0), [cashCountsAbertura]);
  const [cashSnapshotSavedAbertura, setCashSnapshotSavedAbertura] = useState(false);
  const [cashSnapshotDataAbertura, setCashSnapshotDataAbertura] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [savingCashAbertura, setSavingCashAbertura] = useState(false);

  // Cash calculator state - Fechamento
  const [showCashCalcFechamento, setShowCashCalcFechamento] = useState(false);
  const [cashCountsFechamento, setCashCountsFechamento] = useState<Record<number, number>>({});
  const cashTotalFechamento = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (cashCountsFechamento[d] || 0), 0), [cashCountsFechamento]);
  const [cashSnapshotSavedFechamento, setCashSnapshotSavedFechamento] = useState(false);
  const [cashSnapshotDataFechamento, setCashSnapshotDataFechamento] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [savingCashFechamento, setSavingCashFechamento] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: closingData }, { data: ordersData }] = await Promise.all([
      supabase.from('salon_closings').select('*').eq('id', id!).single(),
      supabase.from('salon_orders').select('*').eq('salon_closing_id', id!).order('sale_time', { ascending: true }),
    ]);
    setClosing(closingData as ClosingData | null);
    setOrders((ordersData as SalonOrder[]) || []);

    // Load saved cash snapshots
    if (id) {
      const { data: snapList } = await supabase
        .from('cash_snapshots')
        .select('counts, total, updated_at, snapshot_type')
        .eq('salon_closing_id', id)
        .order('updated_at', { ascending: false });

      for (const snap of (snapList || [])) {
        const counts = snap.counts as Record<string, number>;
        const restored: Record<number, number> = {};
        for (const [k, v] of Object.entries(counts)) {
          restored[parseFloat(k)] = v;
        }
        const type = (snap as any).snapshot_type || 'abertura';
        if (type === 'abertura') {
          setCashSnapshotDataAbertura({ counts, total: Number(snap.total), updated_at: snap.updated_at });
          setCashSnapshotSavedAbertura(true);
          setCashCountsAbertura(restored);
        } else if (type === 'fechamento') {
          setCashSnapshotDataFechamento({ counts, total: Number(snap.total), updated_at: snap.updated_at });
          setCashSnapshotSavedFechamento(true);
          setCashCountsFechamento(restored);
        }
      }
    }

    setLoading(false);
  };

  const handleSaveCashSnapshotAbertura = useCallback(async () => {
    if (!id || !user) return;
    setSavingCashAbertura(true);
    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(cashCountsAbertura)) {
      if (v > 0) countsJson[k] = v;
    }
    const { error } = await supabase
      .from('cash_snapshots')
      .upsert({
        salon_closing_id: id, user_id: user.id, counts: countsJson,
        total: cashTotalAbertura, updated_at: new Date().toISOString(), snapshot_type: 'abertura',
      }, { onConflict: 'salon_closing_id,user_id,snapshot_type' });
    if (error) {
      toast.error('Erro ao salvar contagem de abertura.');
    } else {
      setCashSnapshotSavedAbertura(true);
      setCashSnapshotDataAbertura({ counts: countsJson, total: cashTotalAbertura, updated_at: new Date().toISOString() });
      toast.success(`Contagem abertura salva: ${formatCurrency(cashTotalAbertura)}`);
      setShowCashCalcAbertura(false);
    }
    setSavingCashAbertura(false);
  }, [id, user, cashCountsAbertura, cashTotalAbertura]);

  const handleSaveCashSnapshotFechamento = useCallback(async () => {
    if (!id || !user) return;
    setSavingCashFechamento(true);
    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(cashCountsFechamento)) {
      if (v > 0) countsJson[k] = v;
    }
    const { error } = await supabase
      .from('cash_snapshots')
      .upsert({
        salon_closing_id: id, user_id: user.id, counts: countsJson,
        total: cashTotalFechamento, updated_at: new Date().toISOString(), snapshot_type: 'fechamento',
      }, { onConflict: 'salon_closing_id,user_id,snapshot_type' });
    if (error) {
      toast.error('Erro ao salvar contagem de fechamento.');
    } else {
      setCashSnapshotSavedFechamento(true);
      setCashSnapshotDataFechamento({ counts: countsJson, total: cashTotalFechamento, updated_at: new Date().toISOString() });
      toast.success(`Contagem fechamento salva: ${formatCurrency(cashTotalFechamento)}`);
      setShowCashCalcFechamento(false);
    }
    setSavingCashFechamento(false);
  }, [id, user, cashCountsFechamento, cashTotalFechamento]);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const orderTypes = useMemo(() => [...new Set(orders.map(o => o.order_type))].sort(), [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (search) {
        const s = search.toLowerCase();
        if (!o.order_type.toLowerCase().includes(s) &&
            !(o.sale_time || '').includes(s) &&
            !o.payment_method.toLowerCase().includes(s)) return false;
      }
      if (filterType && filterType !== '__all__' && o.order_type !== filterType) return false;
      return true;
    });
  }, [orders, search, filterType]);

  const totalAmount = useMemo(() => filtered.reduce((sum, o) => sum + o.total_amount, 0), [filtered]);

  // Build display rows: split rateio into separate lines
  const displayRows = useMemo(() => {
    const rows: { orderId: string; order_type: string; sale_time: string | null; payment_method: string; amount: number; isRateio: boolean; rateioIndex: number; rateioTotal: number }[] = [];
    filtered.forEach(order => {
      const methods = order.payment_method.split(',').map(s => s.trim()).filter(Boolean);
      if (methods.length > 1) {
        const splitAmount = Math.round((order.total_amount / methods.length) * 100) / 100;
        methods.forEach((method, i) => {
          const amount = i === methods.length - 1
            ? Math.round((order.total_amount - splitAmount * (methods.length - 1)) * 100) / 100
            : splitAmount;
          rows.push({
            orderId: order.id, order_type: order.order_type, sale_time: order.sale_time,
            payment_method: method, amount, isRateio: true, rateioIndex: i, rateioTotal: methods.length,
          });
        });
      } else {
        rows.push({
          orderId: order.id, order_type: order.order_type, sale_time: order.sale_time,
          payment_method: methods[0] || order.payment_method, amount: order.total_amount,
          isRateio: false, rateioIndex: 0, rateioTotal: 1,
        });
      }
    });
    return rows;
  }, [filtered]);

  // Payment summary from Saipos data
  const paymentSummary = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    displayRows.forEach(r => {
      if (!r.payment_method) return;
      if (!map[r.payment_method]) map[r.payment_method] = { count: 0, total: 0 };
      map[r.payment_method].count++;
      map[r.payment_method].total += r.amount;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [displayRows]);

  const getOrderTypeBadge = (orderType: string) => {
    const isNumber = /^\d+$/.test(orderType.trim());
    if (orderType.toLowerCase() === 'ficha') return <Badge className="bg-foreground text-background border-transparent text-xs">Ficha</Badge>;
    if (isNumber) return <Badge className="bg-foreground text-warning border-transparent text-xs">Retirada</Badge>;
    if (orderType.toLowerCase() === 'salão' || orderType.toLowerCase() === 'salao') return <Badge className="bg-warning text-foreground border-transparent text-xs">Salão</Badge>;
    return <Badge variant="outline" className="text-xs">{orderType}</Badge>;
  };

  const getFilterLabel = (t: string) => {
    if (t.toLowerCase() === 'ficha') return 'Ficha';
    if (/^\d+$/.test(t.trim())) return 'Retirada';
    if (t.toLowerCase() === 'salão' || t.toLowerCase() === 'salao') return 'Salão';
    return t;
  };

  if (loading) {
    return (
      <AppLayout title="Carregando...">
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (!closing) {
    return (
      <AppLayout title="Não encontrado">
        <p className="text-muted-foreground">Fechamento não encontrado.</p>
      </AppLayout>
    );
  }

  const isCompleted = closing?.status === 'completed';

  return (
    <AppLayout
      title={`Salão — ${formatDate(closing.closing_date)}`}
      subtitle={`${orders.length} pedidos`}
      headerActions={
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={() => navigate(`/salon/reconciliation/${id}`)}>
            Conciliação Salão
          </Button>
          <Button variant="outline" onClick={() => navigate('/salon')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Vendas</p>
          <p className="text-2xl font-bold text-foreground">
            R$ {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Pedidos</p>
          <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</p>
          <Badge className={isCompleted ? 'bg-success text-success-foreground' : 'bg-warning/15 text-warning border-warning/30'}>
            {isCompleted ? 'Concluído' : 'Pendente'}
          </Badge>
        </div>
      </div>

      {/* Cash Snapshot - Abertura */}
      <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-success" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro na Abertura</span>
          </div>
          {cashSnapshotSavedAbertura ? (
            <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Salvo</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warning"><AlertCircle className="h-3.5 w-3.5" />Não salvo</span>
          )}
        </div>
        {cashSnapshotDataAbertura ? (
          <div className="mt-2 flex items-center gap-4">
            <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataAbertura.total)}</span>
            <span className="text-xs text-muted-foreground">Salvo em {new Date(cashSnapshotDataAbertura.updated_at).toLocaleString('pt-BR')}</span>
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalcAbertura(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Ver detalhes
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalcAbertura(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Abrir Calculadora
            </Button>
          </div>
        )}
      </div>

      {/* Cash Snapshot - Fechamento */}
      <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro no Fechamento</span>
          </div>
          {cashSnapshotSavedFechamento ? (
            <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Salvo</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warning"><AlertCircle className="h-3.5 w-3.5" />Não salvo</span>
          )}
        </div>
        {cashSnapshotDataFechamento ? (
          <div className="mt-2 flex items-center gap-4">
            <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataFechamento.total)}</span>
            <span className="text-xs text-muted-foreground">Salvo em {new Date(cashSnapshotDataFechamento.updated_at).toLocaleString('pt-BR')}</span>
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalcFechamento(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Ver detalhes
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalcFechamento(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Abrir Calculadora
            </Button>
          </div>
        )}
      </div>

      {/* Payment summary */}
      {paymentSummary.length > 0 && (
        <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">Resumo por Forma de Pagamento (Saipos)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {paymentSummary.map(([method, data]) => (
              <div key={method} className="bg-muted/50 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-foreground truncate">{method}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">{data.count}x</span>
                  <span className="text-xs font-semibold text-foreground">
                    R$ {data.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os tipos</SelectItem>
            {orderTypes.map(t => (
              <SelectItem key={t} value={t}>{getFilterLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table - Read-only */}
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Tipo</TableHead>
                <TableHead className="w-[60px]">Hora</TableHead>
                <TableHead>Pgto Saipos</TableHead>
                <TableHead className="text-right w-[120px]">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Nenhum pedido encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row, idx) => (
                  <TableRow key={`${row.orderId}-${row.rateioIndex}`} className={row.isRateio && row.rateioIndex > 0 ? 'border-t-0' : ''}>
                    <TableCell>
                      {row.rateioIndex === 0 ? getOrderTypeBadge(row.order_type) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.rateioIndex === 0 ? (row.sale_time || '—') : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{row.payment_method}</span>
                        {row.isRateio && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                            {row.rateioIndex + 1}/{row.rateioTotal}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-sm">
                      R$ {row.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Cash Calculator Dialog - Abertura */}
      <Dialog open={showCashCalcAbertura} onOpenChange={setShowCashCalcAbertura}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculadora de Dinheiro — Abertura (Salão)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
              <span>Cédula/Moeda</span><span className="text-center">Qtd</span><span className="text-right">Subtotal</span>
            </div>
            {CASH_DENOMINATIONS.map(denom => (
              <div key={denom} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center">
                <span className="text-sm font-medium text-foreground">{formatCurrency(denom)}</span>
                <Input type="number" min={0} value={cashCountsAbertura[denom] || ''} onChange={(e) => setCashCountsAbertura(prev => ({ ...prev, [denom]: Math.max(0, parseInt(e.target.value) || 0) }))} className="h-8 text-center text-sm" placeholder="0" />
                <span className="text-sm text-right font-mono text-foreground">{formatCurrency(denom * (cashCountsAbertura[denom] || 0))}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Total em espécie:</span>
              <span className="text-xl font-bold text-primary font-mono">{formatCurrency(cashTotalAbertura)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCashCountsAbertura({})}>Limpar</Button>
            <Button size="sm" onClick={handleSaveCashSnapshotAbertura} disabled={savingCashAbertura}>
              {savingCashAbertura ? 'Salvando...' : cashSnapshotSavedAbertura ? 'Atualizar Contagem' : 'Salvar Contagem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash Calculator Dialog - Fechamento */}
      <Dialog open={showCashCalcFechamento} onOpenChange={setShowCashCalcFechamento}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculadora de Dinheiro — Fechamento (Salão)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
              <span>Cédula/Moeda</span><span className="text-center">Qtd</span><span className="text-right">Subtotal</span>
            </div>
            {CASH_DENOMINATIONS.map(denom => (
              <div key={denom} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center">
                <span className="text-sm font-medium text-foreground">{formatCurrency(denom)}</span>
                <Input type="number" min={0} value={cashCountsFechamento[denom] || ''} onChange={(e) => setCashCountsFechamento(prev => ({ ...prev, [denom]: Math.max(0, parseInt(e.target.value) || 0) }))} className="h-8 text-center text-sm" placeholder="0" />
                <span className="text-sm text-right font-mono text-foreground">{formatCurrency(denom * (cashCountsFechamento[denom] || 0))}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Total em espécie:</span>
              <span className="text-xl font-bold text-primary font-mono">{formatCurrency(cashTotalFechamento)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCashCountsFechamento({})}>Limpar</Button>
            <Button size="sm" onClick={handleSaveCashSnapshotFechamento} disabled={savingCashFechamento}>
              {savingCashFechamento ? 'Salvando...' : cashSnapshotSavedFechamento ? 'Atualizar Contagem' : 'Salvar Contagem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
