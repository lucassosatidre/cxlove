import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import AppLayout from '@/components/AppLayout';
import { FileSpreadsheet, CalendarDays, ChevronRight, Trash2, DoorOpen, ShieldAlert, CheckCircle2, Clock, User } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getOperationalDate } from '@/lib/operational-date';

interface DailyClosing {
  id: string;
  closing_date: string;
  status: string;
  created_at: string;
  updated_at: string;
  operator_id?: string | null;
  reconciliation_status?: string;
}

interface ImportRow {
  id: string;
  file_name: string;
  created_at: string;
  total_rows: number;
  new_rows: number;
  duplicate_rows: number;
  daily_closing_id: string | null;
}

interface OrderStats {
  total: number;
  confirmed: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isCaixaTele, isCaixaSalao } = useUserRole();
  const reconciliationPrefix = '/reconciliation';
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClosingId, setExpandedClosingId] = useState<string | null>(null);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [orderStats, setOrderStats] = useState<Record<string, OrderStats>>({});
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});

  // Abrir Caixa state
  const [abrirCaixaOpen, setAbrirCaixaOpen] = useState(false);
  const [abrirCaixaDate, setAbrirCaixaDate] = useState<Date | undefined>(new Date());
  const [abrirCaixaLoading, setAbrirCaixaLoading] = useState(false);

  // Delete closing dialog state
  const [deleteClosingDialog, setDeleteClosingDialog] = useState<{ id: string; date: string } | null>(null);
  const [deleteConfirmDate, setDeleteConfirmDate] = useState('');
  const [deleteClosingLoading, setDeleteClosingLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Record operator on first access for today's closing
  useEffect(() => {
    if (!user || isAdmin || loading) return;
    const todayStr = getTodayStr();
    const todayClosing = closings.find(c => c.closing_date === todayStr);
    if (todayClosing && !todayClosing.operator_id) {
      supabase.from('daily_closings')
        .update({ operator_id: user.id } as any)
        .eq('id', todayClosing.id)
        .is('operator_id', null)
        .then(({ error }) => {
          if (!error) {
            setClosings(prev => prev.map(c => c.id === todayClosing.id ? { ...c, operator_id: user.id } : c));
          }
        });
    }
  }, [user, isAdmin, loading, closings]);

  // Load user emails for admin
  useEffect(() => {
    if (!isAdmin) return;
    const operatorIds = closings.map(c => c.operator_id).filter(Boolean) as string[];
    if (operatorIds.length === 0) return;
    supabase.functions.invoke('create-user', { body: { action: 'list' } })
      .then(({ data }) => {
        if (data?.users) {
          const map: Record<string, string> = {};
          data.users.forEach((u: any) => { map[u.id] = u.email; });
          setUserEmails(map);
        }
      });
  }, [isAdmin, closings]);

  const getTodayStr = () => {
    const now = new Date();
    return format(now, 'yyyy-MM-dd');
  };

  const loadData = async () => {
    const [{ data: closingsData }, { data: importsData }] = await Promise.all([
      supabase.from('daily_closings').select('*').order('closing_date', { ascending: false }),
      supabase.from('imports').select('*').order('created_at', { ascending: false }),
    ]);
    const allClosings = (closingsData || []) as DailyClosing[];
    setClosings(allClosings);
    setImports(importsData || []);
    setLoading(false);

    // Load order stats for closings
    if (allClosings.length > 0) {
      const closingIds = allClosings.map(c => c.id);
      const { data: orders } = await supabase
        .from('imported_orders')
        .select('daily_closing_id, is_confirmed')
        .in('daily_closing_id', closingIds);
      if (orders) {
        const stats: Record<string, OrderStats> = {};
        orders.forEach(o => {
          if (!o.daily_closing_id) return;
          if (!stats[o.daily_closing_id]) stats[o.daily_closing_id] = { total: 0, confirmed: 0 };
          stats[o.daily_closing_id].total++;
          if (o.is_confirmed) stats[o.daily_closing_id].confirmed++;
        });
        setOrderStats(stats);
      }
    }
  };

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const getImportsForClosing = (closingId: string) => imports.filter(i => i.daily_closing_id === closingId);
  const legacyImports = imports.filter(i => !i.daily_closing_id);

  const toggleImportSelection = (importId: string) => {
    setSelectedImports(prev => {
      const next = new Set(prev);
      if (next.has(importId)) next.delete(importId);
      else next.add(importId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedImports.size === 0) return;
    const confirmed = window.confirm(`Tem certeza que deseja apagar ${selectedImports.size} importação(ões)?`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      const importIds = Array.from(selectedImports);
      const { data: orders } = await supabase.from('imported_orders').select('id').in('import_id', importIds);
      if (orders && orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        await supabase.from('card_transactions').update({ matched_order_id: null, match_type: null, match_confidence: null }).in('matched_order_id', orderIds);
        await supabase.from('order_payment_breakdowns').delete().in('imported_order_id', orderIds);
        await supabase.from('imported_orders').delete().in('import_id', importIds);
      }
      await supabase.from('imports').delete().in('id', importIds);
      toast.success(`${importIds.length} importação(ões) removida(s).`);
      setSelectedImports(new Set());
      await loadData();
    } catch (err) {
      toast.error('Erro ao apagar importações.');
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteEmptyClosing = async (closingId: string) => {
    const confirmed = window.confirm('Tem certeza que deseja apagar este fechamento vazio?');
    if (!confirmed) return;
    try {
      await supabase.from('card_transactions').delete().eq('daily_closing_id', closingId);
      const { error } = await supabase.from('daily_closings').delete().eq('id', closingId);
      if (error) throw error;
      toast.success('Fechamento vazio removido.');
      await loadData();
    } catch (err) {
      toast.error('Erro ao apagar fechamento.');
      console.error(err);
    }
  };

  const handleAbrirCaixa = async () => {
    if (!abrirCaixaDate || !user) return;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    if (abrirCaixaDate > todayDate) {
      toast.error('Não é possível abrir caixa para datas futuras.');
      return;
    }
    setAbrirCaixaLoading(true);
    try {
      const dateStr = format(abrirCaixaDate, 'yyyy-MM-dd');
      const { data: existing } = await supabase.from('daily_closings').select('id').eq('closing_date', dateStr).maybeSingle();
      if (existing) {
        navigate(`${reconciliationPrefix}/${existing.id}`);
      } else {
        const { data: newClosing, error } = await supabase.from('daily_closings').insert({ closing_date: dateStr, user_id: user.id, status: 'pending' }).select('id').single();
        if (error) throw error;
        navigate(`${reconciliationPrefix}/${newClosing.id}`);
      }
      setAbrirCaixaOpen(false);
    } catch (err) {
      toast.error('Erro ao abrir caixa.');
      console.error(err);
    } finally {
      setAbrirCaixaLoading(false);
    }
  };

  const handleDeleteClosing = async () => {
    if (!deleteClosingDialog) return;
    const expectedDate = formatDate(deleteClosingDialog.date);
    if (deleteConfirmDate !== expectedDate) {
      toast.error(`Digite a data corretamente: ${expectedDate}`);
      return;
    }
    setDeleteClosingLoading(true);
    try {
      const closingId = deleteClosingDialog.id;
      const { data: closingImports } = await supabase.from('imports').select('id').eq('daily_closing_id', closingId);
      const importIds = closingImports?.map(i => i.id) || [];
      const { data: orders } = await supabase.from('imported_orders').select('id').eq('daily_closing_id', closingId);
      const orderIds = orders?.map(o => o.id) || [];
      if (orderIds.length > 0) {
        await supabase.from('order_payment_breakdowns').delete().in('imported_order_id', orderIds);
        await supabase.from('card_transactions').update({ matched_order_id: null, match_type: null, match_confidence: null }).in('matched_order_id', orderIds);
        await supabase.from('imported_orders').delete().eq('daily_closing_id', closingId);
      }
      if (importIds.length > 0) {
        await supabase.from('imports').delete().in('id', importIds);
      }
      await supabase.from('card_transactions').delete().eq('daily_closing_id', closingId);
      await supabase.from('machine_readings').delete().eq('daily_closing_id', closingId);
      await supabase.from('cash_snapshots').delete().eq('daily_closing_id', closingId);
      await supabase.from('daily_closings').delete().eq('id', closingId);
      toast.success(`Fechamento do dia ${expectedDate} excluído com sucesso.`);
      setDeleteClosingDialog(null);
      setDeleteConfirmDate('');
      await loadData();
    } catch (err) {
      toast.error('Erro ao excluir fechamento.');
      console.error(err);
    } finally {
      setDeleteClosingLoading(false);
    }
  };

  const todayStr = getTodayStr();
  const todayClosing = closings.find(c => c.closing_date === todayStr);
  const pastClosings = closings.filter(c => c.closing_date !== todayStr);
  const isOperator = isCaixaTele || isCaixaSalao;

  const today = new Date();
  const todayLabel = today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const weekday = today.toLocaleDateString('pt-BR', { weekday: 'long' });

  const getOperatorLabel = (operatorId: string | null | undefined) => {
    if (!operatorId) return null;
    const email = userEmails[operatorId];
    if (!email) return null;
    return email.split('@')[0];
  };

  const renderClosingCard = (closing: DailyClosing, isToday: boolean) => {
    const closingImports = getImportsForClosing(closing.id);
    const isExpanded = expandedClosingId === closing.id;
    const stats = orderStats[closing.id];
    const percent = stats && stats.total > 0 ? Math.round((stats.confirmed / stats.total) * 100) : 0;
    const pending = stats ? stats.total - stats.confirmed : 0;
    const isComplete = closing.status === 'completed';
    const operatorName = getOperatorLabel(closing.operator_id);

    return (
      <div key={closing.id} className={isToday ? 'border-2 border-primary/30 rounded-xl bg-primary/5' : ''}>
        <button
          onClick={() => navigate(`${reconciliationPrefix}/${closing.id}`)}
          className="w-full text-left p-4 hover:bg-muted/40 row-transition flex items-center justify-between group"
        >
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
              isComplete ? "bg-success/10" : "bg-primary/10"
            )}>
              {isComplete ? <CheckCircle2 className="h-5 w-5 text-success" /> : <CalendarDays className="h-5 w-5 text-primary" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground group-hover:text-primary row-transition">
                  {formatDate(closing.closing_date)}
                </p>
                {isToday && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Hoje</Badge>}
              </div>
              {/* Status line */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {stats && stats.total > 0 ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-1 max-w-[200px]">
                      <Progress value={percent} className="h-1.5 flex-1" />
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">{percent}%</span>
                    </div>
                    {pending > 0 && <span className="text-xs text-warning">{pending} pendente{pending > 1 ? 's' : ''}</span>}
                    {pending === 0 && <span className="text-xs text-success">Conferência completa ✅</span>}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Sem pedidos</span>
                )}
                {isAdmin && closing.reconciliation_status && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    Conciliação: {closing.reconciliation_status === 'completed' ? '✅' : 'pendente'}
                  </Badge>
                )}
              </div>
              {/* Operator & meta */}
              <div className="flex items-center gap-2 mt-0.5">
                {isAdmin && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" /> {operatorName || 'aguardando'}
                  </span>
                )}
                {isAdmin && (
                  <span className="text-xs text-muted-foreground">
                    {closingImports.length} importação(ões)
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isAdmin && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteClosingDialog({ id: closing.id, date: closing.closing_date });
                  setDeleteConfirmDate('');
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Badge
              variant={isComplete ? 'default' : 'secondary'}
              className={isComplete ? 'bg-success text-success-foreground' : 'bg-warning/15 text-warning border-warning/30'}
            >
              {isComplete ? 'Concluído' : 'Pendente'}
            </Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </button>

        {/* Import history (admin only) */}
        {isAdmin && closingImports.length > 0 && (
          <div className="border-t border-border/50">
            <button
              onClick={(e) => { e.stopPropagation(); setExpandedClosingId(isExpanded ? null : closing.id); }}
              className="w-full text-left px-4 py-2 text-xs text-muted-foreground hover:bg-muted/20 row-transition"
            >
              {isExpanded ? '▾' : '▸'} Histórico de importações ({closingImports.length})
            </button>
            {isExpanded && (
              <div className="px-4 pb-3 space-y-1.5">
                {closingImports.map((imp) => (
                  <div key={imp.id} className="flex items-center justify-between text-xs bg-muted/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={selectedImports.has(imp.id)} onCheckedChange={() => toggleImportSelection(imp.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4" />
                      <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-foreground font-medium">{imp.file_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>{imp.total_rows} lidos</span>
                      <span className="text-success">{imp.new_rows} novos</span>
                      <span>{imp.duplicate_rows} duplicados</span>
                      <span>{new Date(imp.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout
      title="Tele"
      subtitle={`📅 ${todayLabel} · ${weekday.charAt(0).toUpperCase() + weekday.slice(1)}`}
      headerActions={
        isAdmin ? (
          <Popover open={abrirCaixaOpen} onOpenChange={setAbrirCaixaOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <DoorOpen className="h-4 w-4 mr-2" />
                Abrir Caixa
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-3 border-b border-border">
                <p className="text-sm font-medium text-foreground">Selecione a data</p>
              </div>
              <Calendar
                mode="single"
                selected={abrirCaixaDate}
                onSelect={setAbrirCaixaDate}
                today={undefined}
                disabled={{ after: new Date() }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
              <div className="p-3 border-t border-border">
                <Button className="w-full" onClick={handleAbrirCaixa} disabled={!abrirCaixaDate || abrirCaixaLoading}>
                  {abrirCaixaLoading ? 'Abrindo...' : 'Confirmar'}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* Today's closing - highlighted for everyone */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fechamento de Hoje</h2>
            {todayClosing ? (
              <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
                {renderClosingCard(todayClosing, true)}
              </div>
            ) : (
              <div className="bg-card rounded-xl shadow-card border border-border p-8 text-center">
                <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">O caixa de hoje será aberto automaticamente em breve.</p>
              </div>
            )}
          </div>

          {/* Past closings - admin only */}
          {isAdmin && pastClosings.length > 0 && (
            <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">Histórico de Fechamentos</h2>
              </div>
              <div className="divide-y divide-border">
                {pastClosings.map((closing) => renderClosingCard(closing, false))}
              </div>
            </div>
          )}

          {/* Legacy imports - admin only */}
          {isAdmin && legacyImports.length > 0 && (
            <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden mt-6">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">Importações Legadas</h2>
              </div>
              <div className="divide-y divide-border">
                {legacyImports.map((imp) => (
                  <button
                    key={imp.id}
                    onClick={() => navigate(`/reconciliation-legacy/${imp.id}`)}
                    className="w-full text-left p-4 hover:bg-muted/40 row-transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                        <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground group-hover:text-primary row-transition">{imp.file_name}</p>
                        <span className="text-xs text-muted-foreground">{new Date(imp.created_at).toLocaleString('pt-BR')} · {imp.total_rows} pedidos</span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-muted text-muted-foreground">Legado</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Floating delete bar */}
      {selectedImports.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background rounded-xl shadow-lg px-5 py-3 flex items-center gap-4 z-50">
          <span className="text-sm font-medium">{selectedImports.size} importação(ões) selecionada(s)</span>
          <Button size="sm" variant="destructive" onClick={handleDeleteSelected} disabled={deleting}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            {deleting ? 'Apagando...' : 'Apagar'}
          </Button>
          <Button size="sm" variant="ghost" className="text-background hover:text-background/80 hover:bg-background/10" onClick={() => setSelectedImports(new Set())}>
            Cancelar
          </Button>
        </div>
      )}

      {/* Delete closing confirmation dialog */}
      <Dialog open={!!deleteClosingDialog} onOpenChange={(open) => { if (!open) { setDeleteClosingDialog(null); setDeleteConfirmDate(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Excluir Fechamento
            </DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o fechamento do dia <strong>{deleteClosingDialog ? formatDate(deleteClosingDialog.date) : ''}</strong>? Todos os dados serão removidos permanentemente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Para confirmar, digite a data: <strong>{deleteClosingDialog ? formatDate(deleteClosingDialog.date) : ''}</strong>
            </p>
            <Input placeholder="DD/MM/AAAA" value={deleteConfirmDate} onChange={(e) => setDeleteConfirmDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteClosingDialog(null); setDeleteConfirmDate(''); }}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteClosing} disabled={deleteClosingLoading || !deleteConfirmDate}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              {deleteClosingLoading ? 'Excluindo...' : 'Excluir Permanentemente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
