import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import AppLayout from '@/components/AppLayout';
import { Plus, FileSpreadsheet, Clock, CalendarDays, ChevronRight, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

interface DailyClosing {
  id: string;
  closing_date: string;
  status: string;
  created_at: string;
  updated_at: string;
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

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const routePrefix = '';
  const reconciliationPrefix = '/reconciliation';
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClosingId, setExpandedClosingId] = useState<string | null>(null);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [{ data: closingsData }, { data: importsData }] = await Promise.all([
      supabase.from('daily_closings').select('*').eq('is_test', isTestMode).order('closing_date', { ascending: false }),
      supabase.from('imports').select('*').eq('is_test', isTestMode).order('created_at', { ascending: false }),
    ]);
    setClosings(closingsData || []);
    setImports(importsData || []);
    setLoading(false);
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
    const confirmed = window.confirm(`Tem certeza que deseja apagar ${selectedImports.size} importação(ões)? Os pedidos e pagamentos associados serão removidos.`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      const importIds = Array.from(selectedImports);

      // Get order IDs for these imports to delete related data first
      const { data: orders } = await supabase
        .from('imported_orders')
        .select('id')
        .in('import_id', importIds);

      if (orders && orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        // Clear FK references from card transactions
        await supabase.from('card_transactions')
          .update({ matched_order_id: null, match_type: null, match_confidence: null })
          .in('matched_order_id', orderIds);
        // Delete payment breakdowns
        await supabase.from('order_payment_breakdowns').delete().in('imported_order_id', orderIds);
        // Delete orders
        await supabase.from('imported_orders').delete().in('import_id', importIds);
      }

      // Delete imports
      await supabase.from('imports').delete().in('id', importIds);

      // Check if any closing now has zero imports and delete it
      const affectedClosingIds = [...new Set(
        imports.filter(i => importIds.includes(i.id) && i.daily_closing_id).map(i => i.daily_closing_id!)
      )];

      for (const closingId of affectedClosingIds) {
        const remaining = imports.filter(i => i.daily_closing_id === closingId && !importIds.includes(i.id));
        if (remaining.length === 0) {
          await supabase.from('daily_closings').delete().eq('id', closingId);
        }
      }

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
      // Delete any cash snapshots linked to this closing
      await supabase.from('cash_snapshots').delete().eq('daily_closing_id', closingId);
      // Delete any card transactions linked to this closing
      await supabase.from('card_transactions').delete().eq('daily_closing_id', closingId);
      // Delete the closing itself
      const { error } = await supabase.from('daily_closings').delete().eq('id', closingId);
      if (error) throw error;
      toast.success('Fechamento vazio removido.');
      await loadData();
    } catch (err) {
      toast.error('Erro ao apagar fechamento.');
      console.error(err);
    }
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const weekday = today.toLocaleDateString('pt-BR', { weekday: 'long' });

  return (
    <AppLayout
      title={isTestMode ? "Tele Teste" : "Tele"}
      subtitle={`📅 ${dateStr} · ${weekday.charAt(0).toUpperCase() + weekday.slice(1)}`}
      headerActions={
        <Button onClick={() => navigate(isTestMode ? '/tele-teste/import' : '/tele/import')} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />
          Nova Importação
        </Button>
      }
    >
      {isTestMode && <TestBanner />}
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
          <h2 className="text-base font-semibold text-foreground">Fechamentos Diários</h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : closings.length === 0 && legacyImports.length === 0 ? (
          <div className="text-center py-16">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum fechamento realizado</h3>
            <p className="text-sm text-muted-foreground mb-6">Importe seu primeiro relatório para começar.</p>
            <Button onClick={() => navigate(isTestMode ? '/tele-teste/import' : '/tele/import')} className="bg-primary hover:bg-primary/90">
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
                    onClick={() => navigate(`${reconciliationPrefix}/${closing.id}`)}
                    className="w-full text-left p-4 hover:bg-muted/40 row-transition flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <CalendarDays className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground group-hover:text-primary row-transition">
                          Fechamento {formatDate(closing.closing_date)}
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
                      {closingImports.length === 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEmptyClosing(closing.id);
                          }}
                        >
                          <X className="h-4 w-4" />
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
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {new Date(imp.created_at).toLocaleString('pt-BR')}
                      </span>
                      <span className="text-xs text-muted-foreground">· {imp.total_rows} pedidos</span>
                    </div>
                  </div>
                </div>
                <Badge variant="secondary" className="bg-muted text-muted-foreground">Legado</Badge>
              </button>
            ))}
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
    </AppLayout>
  );
}
