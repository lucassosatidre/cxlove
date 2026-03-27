import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import AppLayout from '@/components/AppLayout';
import { Plus, FileSpreadsheet, Clock, CalendarDays, ChevronRight, Trash2, DoorOpen, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SalonClosing {
  id: string;
  closing_date: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface SalonImportRow {
  id: string;
  file_name: string;
  created_at: string;
  total_rows: number;
  new_rows: number;
  duplicate_rows: number;
  skipped_cancelled: number;
  salon_closing_id: string | null;
}

export default function SalonDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const [closings, setClosings] = useState<SalonClosing[]>([]);
  const [imports, setImports] = useState<SalonImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClosingId, setExpandedClosingId] = useState<string | null>(null);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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

  const loadData = async () => {
    const [{ data: closingsData }, { data: importsData }] = await Promise.all([
      supabase.from('salon_closings').select('*').order('closing_date', { ascending: false }),
      supabase.from('salon_imports').select('*').order('created_at', { ascending: false }),
    ]);
    setClosings((closingsData as SalonClosing[]) || []);
    setImports((importsData as SalonImportRow[]) || []);
    setLoading(false);
  };

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const getImportsForClosing = (closingId: string) => imports.filter(i => i.salon_closing_id === closingId);

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
    const confirmed = window.confirm(`Tem certeza que deseja apagar ${selectedImports.size} importação(ões)? Os pedidos e pagamentos associados serão removidos.`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      const importIds = Array.from(selectedImports);
      const { data: orders } = await supabase
        .from('salon_orders')
        .select('id')
        .in('salon_import_id', importIds);

      if (orders && orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        await supabase.from('salon_card_transactions').update({ matched_order_id: null, match_type: null, match_confidence: null }).in('matched_order_id', orderIds);
        await supabase.from('salon_order_payments').delete().in('salon_order_id', orderIds);
        await supabase.from('salon_orders').delete().in('salon_import_id', importIds);
      }

      await supabase.from('salon_imports').delete().in('id', importIds);

      toast.success(`${importIds.length} importação(ões) removida(s) com sucesso.`);
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
      await supabase.from('salon_card_transactions').delete().eq('salon_closing_id', closingId);
      await supabase.from('salon_closings').delete().eq('id', closingId);
      toast.success('Fechamento removido com sucesso.');
      await loadData();
    } catch (err) {
      toast.error('Erro ao apagar fechamento.');
      console.error(err);
    }
  };

  // Abrir Caixa handler
  const handleAbrirCaixa = async () => {
    if (!abrirCaixaDate || !user) return;

    // Block future dates
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    if (abrirCaixaDate > todayDate) {
      toast.error('Não é possível abrir caixa para datas futuras.');
      return;
    }

    setAbrirCaixaLoading(true);
    try {
      const dateStr = format(abrirCaixaDate, 'yyyy-MM-dd');
      const { data: existing } = await supabase
        .from('salon_closings')
        .select('id')
        .eq('closing_date', dateStr)
        .maybeSingle();

      if (existing) {
        navigate(`/salon/closing/${existing.id}`);
      } else {
        const { data: newClosing, error } = await supabase
          .from('salon_closings')
          .insert({ closing_date: dateStr, user_id: user.id, status: 'pending' })
          .select('id')
          .single();
        if (error) throw error;
        navigate(`/salon/closing/${newClosing.id}`);
      }
      setAbrirCaixaOpen(false);
    } catch (err) {
      toast.error('Erro ao abrir caixa.');
      console.error(err);
    } finally {
      setAbrirCaixaLoading(false);
    }
  };

  // Full cascade delete closing
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

      // Get all imports for this closing
      const { data: closingImports } = await supabase
        .from('salon_imports')
        .select('id')
        .eq('salon_closing_id', closingId);
      const importIds = closingImports?.map(i => i.id) || [];

      // Get all orders
      const { data: orders } = await supabase
        .from('salon_orders')
        .select('id')
        .eq('salon_closing_id', closingId);
      const orderIds = orders?.map(o => o.id) || [];

      // Cascade delete
      if (orderIds.length > 0) {
        await supabase.from('salon_order_payments').delete().in('salon_order_id', orderIds);
        await supabase.from('salon_card_transactions')
          .update({ matched_order_id: null, match_type: null, match_confidence: null })
          .in('matched_order_id', orderIds);
        await supabase.from('salon_orders').delete().eq('salon_closing_id', closingId);
      }

      if (importIds.length > 0) {
        await supabase.from('salon_imports').delete().in('id', importIds);
      }

      await supabase.from('salon_card_transactions').delete().eq('salon_closing_id', closingId);
      await supabase.from('machine_readings').delete().eq('salon_closing_id', closingId);
      await supabase.from('cash_snapshots').delete().eq('salon_closing_id', closingId);
      await supabase.from('salon_closings').delete().eq('id', closingId);

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

  const today = new Date();
  const todayStr = today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const weekday = today.toLocaleDateString('pt-BR', { weekday: 'long' });

  return (
    <AppLayout
      title="Salão"
      subtitle={`📅 ${todayStr} · ${weekday.charAt(0).toUpperCase() + weekday.slice(1)}`}
      headerActions={
        <div className="flex items-center gap-2">
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
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
              <div className="p-3 border-t border-border">
                <Button
                  className="w-full"
                  onClick={handleAbrirCaixa}
                  disabled={!abrirCaixaDate || abrirCaixaLoading}
                >
                  {abrirCaixaLoading ? 'Abrindo...' : 'Confirmar'}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button onClick={() => navigate('/salon/import')} className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />
            Nova Importação
          </Button>
        </div>
      }
    >
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card rounded-xl shadow-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fechamentos</span>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold text-foreground">{closings.length}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Importações</span>
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold text-foreground">{imports.length}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pendentes</span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold text-foreground">{closings.filter(c => c.status !== 'completed').length}</p>
        </div>
      </div>

      {/* Closings list */}
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Fechamentos Salão</h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : closings.length === 0 ? (
          <div className="text-center py-16">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum fechamento realizado</h3>
            <p className="text-sm text-muted-foreground mb-6">Importe seu primeiro relatório de salão para começar.</p>
            <Button onClick={() => navigate('/salon/import')} className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              Nova Importação
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {closings.map((closing) => {
              const closingImports = getImportsForClosing(closing.id);
              const isExpanded = expandedClosingId === closing.id;

              return (
                <div key={closing.id}>
                  <button
                    onClick={() => navigate(`/salon/closing/${closing.id}`)}
                    className="w-full text-left p-4 hover:bg-muted/40 row-transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <CalendarDays className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground group-hover:text-primary row-transition">
                          Salão — {formatDate(closing.closing_date)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {closingImports.length} importação(ões)
                          </span>
                          <span className="text-xs text-muted-foreground">
                            · {new Date(closing.updated_at).toLocaleString('pt-BR')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isAdmin ? (
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
                      ) : closingImports.length === 0 && closing.status !== 'completed' && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleDeleteEmptyClosing(closing.id); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Badge
                        variant={closing.status === 'completed' ? 'default' : 'secondary'}
                        className={closing.status === 'completed' ? 'bg-success text-success-foreground' : 'bg-warning/15 text-warning border-warning/30'}
                      >
                        {closing.status === 'completed' ? 'Concluído' : 'Pendente'}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>

                  {closingImports.length > 0 && (
                    <div className="border-t border-border/50">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedClosingId(isExpanded ? null : closing.id);
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-muted-foreground hover:bg-muted/20 row-transition"
                      >
                        {isExpanded ? '▾' : '▸'} Histórico de importações ({closingImports.length})
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 space-y-1.5">
                          {closingImports.map((imp) => (
                            <div key={imp.id} className="flex items-center justify-between text-xs bg-muted/50 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={selectedImports.has(imp.id)}
                                  onCheckedChange={() => toggleImportSelection(imp.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-4 w-4"
                                />
                                <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-foreground font-medium">{imp.file_name}</span>
                              </div>
                              <div className="flex items-center gap-3 text-muted-foreground">
                                <span>{imp.total_rows} lidos</span>
                                <span className="text-success">{imp.new_rows} novos</span>
                                <span>{imp.duplicate_rows} duplicados</span>
                                {imp.skipped_cancelled > 0 && (
                                  <span className="text-destructive">{imp.skipped_cancelled} cancelados</span>
                                )}
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
            })}
          </div>
        )}
      </div>

      {/* Floating delete bar */}
      {selectedImports.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background rounded-xl shadow-lg px-5 py-3 flex items-center gap-4 z-50">
          <span className="text-sm font-medium">{selectedImports.size} importação(ões) selecionada(s)</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDeleteSelected}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {deleting ? 'Apagando...' : 'Apagar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-background hover:text-background/80 hover:bg-background/10"
            onClick={() => setSelectedImports(new Set())}
          >
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
              Tem certeza que deseja excluir o fechamento do dia <strong>{deleteClosingDialog ? formatDate(deleteClosingDialog.date) : ''}</strong>? Todos os pedidos, importações e dados de conciliação deste dia serão removidos permanentemente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Para confirmar, digite a data do fechamento: <strong>{deleteClosingDialog ? formatDate(deleteClosingDialog.date) : ''}</strong>
            </p>
            <Input
              placeholder="DD/MM/AAAA"
              value={deleteConfirmDate}
              onChange={(e) => setDeleteConfirmDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteClosingDialog(null); setDeleteConfirmDate(''); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteClosing}
              disabled={deleteClosingLoading || !deleteConfirmDate}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {deleteClosingLoading ? 'Excluindo...' : 'Excluir Permanentemente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}