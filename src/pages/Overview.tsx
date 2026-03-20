import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CalendarDays, Store, Bike, ChevronRight, CheckCircle2, Clock, Vault } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import CashExpectationDialog from '@/components/CashExpectationDialog';

interface ClosingRow {
  id: string;
  closing_date: string;
  status: string;
  reconciliation_status: string;
}

interface DayEntry {
  date: string;
  tele: ClosingRow | null;
  salon: ClosingRow | null;
}

export default function Overview() {
  const navigate = useNavigate();
  const [teleClosings, setTeleClosings] = useState<ClosingRow[]>([]);
  const [salonClosings, setSalonClosings] = useState<ClosingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [{ data: tele }, { data: salon }] = await Promise.all([
      supabase.from('daily_closings').select('id, closing_date, status, reconciliation_status').order('closing_date', { ascending: false }),
      supabase.from('salon_closings').select('id, closing_date, status, reconciliation_status').order('closing_date', { ascending: false }),
    ]);
    setTeleClosings((tele as ClosingRow[]) || []);
    setSalonClosings((salon as ClosingRow[]) || []);
    setLoading(false);
  };

  const days = useMemo(() => {
    const dateMap = new Map<string, DayEntry>();

    teleClosings.forEach(c => {
      if (!dateMap.has(c.closing_date)) {
        dateMap.set(c.closing_date, { date: c.closing_date, tele: null, salon: null });
      }
      dateMap.get(c.closing_date)!.tele = c;
    });

    salonClosings.forEach(c => {
      if (!dateMap.has(c.closing_date)) {
        dateMap.set(c.closing_date, { date: c.closing_date, tele: null, salon: null });
      }
      dateMap.get(c.closing_date)!.salon = c;
    });

    return [...dateMap.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [teleClosings, salonClosings]);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const getWeekday = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d))
      .toLocaleDateString('pt-BR', { weekday: 'short' });
  };

  const getProgress = (closing: ClosingRow | null) => {
    if (!closing) return 0;
    let p = 0;
    if (closing.status === 'completed') p += 50;
    if (closing.reconciliation_status === 'completed') p += 50;
    return p;
  };

  const totalDays = days.length;
  const fullyComplete = days.filter(d => getProgress(d.tele) === 100 && getProgress(d.salon) === 100).length;

  const StatusBadge = ({ closing, label }: { closing: ClosingRow | null; label: string }) => {
    if (!closing) return (
      <Badge className="bg-muted text-muted-foreground text-[10px]">Sem {label}</Badge>
    );
    const confDone = closing.status === 'completed';
    const reconcDone = closing.reconciliation_status === 'completed';
    if (confDone && reconcDone) return (
      <Badge className="bg-success/15 text-success border-success/30 text-[10px]">100%</Badge>
    );
    if (confDone) return (
      <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px]">50%</Badge>
    );
    return (
      <Badge className="bg-muted text-muted-foreground text-[10px]">0%</Badge>
    );
  };

  return (
    <AppLayout title="Visão Geral" subtitle="Acompanhamento diário — Conferência & Conciliação">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card rounded-xl shadow-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dias registrados</span>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold text-foreground">{totalDays}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">100% Concluídos</span>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold text-foreground">{fullyComplete}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pendentes</span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold text-foreground">{totalDays - fullyComplete}</p>
        </div>
      </div>

      {/* Days list */}
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Todos os Dias</h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : days.length === 0 ? (
          <div className="text-center py-16">
            <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum dia registrado</h3>
            <p className="text-sm text-muted-foreground">Importe dados na aba Tele ou Salão para começar.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {days.map((day) => {
              const teleProgress = getProgress(day.tele);
              const salonProgress = getProgress(day.salon);
              const totalProgress = Math.round(((day.tele ? teleProgress : 0) + (day.salon ? salonProgress : 0)) / ((day.tele ? 1 : 0) + (day.salon ? 1 : 0) || 1));

              return (
                <div key={day.date} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <CalendarDays className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{formatDate(day.date)}</p>
                        <p className="text-xs text-muted-foreground capitalize">{getWeekday(day.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground tabular-nums">{totalProgress}%</span>
                      <Progress value={totalProgress} className="w-24 h-2" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Tele */}
                    {day.tele && (
                      <button
                        onClick={() => navigate(`/reconciliation/${day.tele!.id}`)}
                        className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors group text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Bike className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-semibold text-foreground">Tele</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-muted-foreground">
                                Conf: {day.tele.status === 'completed' ? '✅' : '⏳'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                Conc: {day.tele.reconciliation_status === 'completed' ? '✅' : '⏳'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge closing={day.tele} label="Tele" />
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        </div>
                      </button>
                    )}

                    {/* Salão */}
                    {day.salon && (
                      <button
                        onClick={() => navigate(`/salon/closing/${day.salon!.id}`)}
                        className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors group text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Store className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-semibold text-foreground">Salão</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-muted-foreground">
                                Conf: {day.salon.status === 'completed' ? '✅' : '⏳'}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                Conc: {day.salon.reconciliation_status === 'completed' ? '✅' : '⏳'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge closing={day.salon} label="Salão" />
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
