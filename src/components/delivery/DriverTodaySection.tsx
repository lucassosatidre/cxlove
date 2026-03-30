import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Phone, X, CheckCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface ShiftWithCheckins {
  shiftId: string;
  horarioInicio: string;
  horarioFim: string;
  vagas: number;
  confirmados: {
    checkinId: string;
    driverName: string;
    driverPhone: string;
    confirmedAt: string | null;
    status: string;
  }[];
}

export default function DriverTodaySection() {
  const [shifts, setShifts] = useState<ShiftWithCheckins[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState<{
    type: 'no_show' | 'concluir';
    checkinId?: string;
    shiftId?: string;
    name?: string;
    horario?: string;
  } | null>(null);
  const [acting, setActing] = useState(false);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const fetchToday = useCallback(async () => {
    const { data: todayShifts } = await supabase
      .from('delivery_shifts')
      .select('id, horario_inicio, horario_fim, vagas')
      .eq('data', todayStr)
      .order('horario_inicio');

    if (!todayShifts || todayShifts.length === 0) {
      setShifts([]);
      setLoading(false);
      return;
    }

    const shiftIds = todayShifts.map(s => s.id);
    const { data: checkins } = await supabase
      .from('delivery_checkins')
      .select('id, shift_id, driver_id, status, confirmed_at')
      .in('shift_id', shiftIds)
      .in('status', ['confirmado', 'concluido', 'no_show']);

    const driverIds = [...new Set((checkins || []).map(c => c.driver_id))];
    let driversMap: Record<string, { nome: string; telefone: string }> = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('id, nome, telefone')
        .in('id', driverIds);
      (drivers || []).forEach(d => { driversMap[d.id] = { nome: d.nome, telefone: d.telefone }; });
    }

    const result: ShiftWithCheckins[] = todayShifts.map(s => ({
      shiftId: s.id,
      horarioInicio: s.horario_inicio?.slice(0, 5) || '',
      horarioFim: s.horario_fim?.slice(0, 5) || '',
      vagas: s.vagas,
      confirmados: (checkins || [])
        .filter(c => c.shift_id === s.id)
        .map(c => ({
          checkinId: c.id,
          driverName: driversMap[c.driver_id]?.nome || 'Desconhecido',
          driverPhone: driversMap[c.driver_id]?.telefone || '',
          confirmedAt: c.confirmed_at,
          status: c.status,
        })),
    }));

    setShifts(result);
    setLoading(false);
  }, [todayStr]);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  const handleNoShow = async () => {
    if (!actionDialog?.checkinId) return;
    setActing(true);
    const { error } = await supabase
      .from('delivery_checkins')
      .update({ status: 'no_show' })
      .eq('id', actionDialog.checkinId);
    if (error) {
      toast.error('Erro ao marcar no-show');
    } else {
      toast.success('Marcado como no-show');
      fetchToday();
    }
    setActing(false);
    setActionDialog(null);
  };

  const handleConcluirTurno = async () => {
    if (!actionDialog?.shiftId) return;
    setActing(true);
    const shift = shifts.find(s => s.shiftId === actionDialog.shiftId);
    const toUpdate = (shift?.confirmados || [])
      .filter(c => c.status === 'confirmado')
      .map(c => c.checkinId);

    if (toUpdate.length === 0) {
      toast.info('Nenhum check-in para concluir');
      setActing(false);
      setActionDialog(null);
      return;
    }

    const { error } = await supabase
      .from('delivery_checkins')
      .update({ status: 'concluido' })
      .in('id', toUpdate);

    if (error) {
      toast.error('Erro ao concluir turno');
    } else {
      toast.success(`${toUpdate.length} presenças concluídas`);
      fetchToday();
    }
    setActing(false);
    setActionDialog(null);
  };

  const isShiftPast = (horarioFim: string) => {
    const now = new Date();
    const [h, m] = horarioFim.split(':').map(Number);
    const end = new Date();
    end.setHours(h, m, 0, 0);
    return now >= end;
  };

  if (loading) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando turnos de hoje...</CardContent></Card>;
  }

  if (shifts.length === 0) {
    return (
      <Card className="border-l-4 border-l-primary">
        <CardContent className="py-8 text-center text-muted-foreground">
          Nenhum turno configurado para hoje
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {shifts.map(s => {
          const activeCount = s.confirmados.filter(c => c.status === 'confirmado' || c.status === 'concluido').length;
          const progress = s.vagas > 0 ? (activeCount / s.vagas) * 100 : 0;
          const past = isShiftPast(s.horarioFim);

          return (
            <Card key={s.shiftId} className="border-l-4 border-l-primary">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">
                    {s.horarioInicio} — {s.horarioFim}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{activeCount}/{s.vagas} preenchidas</span>
                    {past && s.confirmados.some(c => c.status === 'confirmado') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => setActionDialog({
                          type: 'concluir',
                          shiftId: s.shiftId,
                          horario: `${s.horarioInicio} — ${s.horarioFim}`,
                        })}
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Concluir turno
                      </Button>
                    )}
                  </div>
                </div>
                <Progress value={progress} className="h-1.5 mt-2" />
              </CardHeader>
              <CardContent className="pt-0">
                {s.confirmados.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma confirmação ainda</p>
                ) : (
                  <div className="space-y-2">
                    {s.confirmados.map(c => (
                      <div key={c.checkinId} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.driverName}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {c.driverPhone && (
                                <a href={`tel:${c.driverPhone.replace(/\D/g, '')}`} className="flex items-center gap-1 hover:text-primary transition-colors">
                                  <Phone className="h-3 w-3" /> {c.driverPhone}
                                </a>
                              )}
                              {c.confirmedAt && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {format(new Date(c.confirmedAt), 'HH:mm')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {c.status === 'concluido' && <Badge variant="secondary" className="bg-blue-100 text-blue-700">Concluído</Badge>}
                          {c.status === 'no_show' && <Badge variant="destructive">Faltou</Badge>}
                          {c.status === 'confirmado' && (
                            <>
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Confirmado</Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title="Marcar no-show"
                                onClick={() => setActionDialog({
                                  type: 'no_show',
                                  checkinId: c.checkinId,
                                  name: c.driverName,
                                  horario: `${s.horarioInicio} — ${s.horarioFim}`,
                                })}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {s.vagas - activeCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {s.vagas - activeCount} vaga{s.vagas - activeCount > 1 ? 's' : ''} aberta{s.vagas - activeCount > 1 ? 's' : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === 'no_show' ? 'Marcar No-show?' : 'Concluir Turno?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {actionDialog?.type === 'no_show'
              ? `Marcar ${actionDialog.name} como no-show no turno de ${actionDialog.horario}?`
              : `Marcar todos os confirmados do turno ${actionDialog?.horario} como concluídos?`}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setActionDialog(null)}>Cancelar</Button>
            <Button
              variant={actionDialog?.type === 'no_show' ? 'destructive' : 'default'}
              onClick={actionDialog?.type === 'no_show' ? handleNoShow : handleConcluirTurno}
              disabled={acting}
            >
              {acting ? 'Processando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
