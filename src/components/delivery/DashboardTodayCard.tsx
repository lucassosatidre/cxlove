import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Clock, Users } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getBrasiliaHour, getBrasiliaToday } from '@/lib/brasilia-time';

interface ShiftCheckin {
  checkinId: string;
  driverName: string;
  status: string;
}

interface ShiftData {
  shiftId: string;
  horarioInicio: string;
  horarioFim: string;
  vagas: number;
  confirmados: ShiftCheckin[];
  waitlistCount: number;
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function getShiftStatus(horarioInicio: string, horarioFim: string): { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' } {
  const hour = getBrasiliaHour();
  const [startH] = horarioInicio.split(':').map(Number);
  const [endH] = horarioFim.split(':').map(Number);
  
  if (hour >= 15 && hour < 18) return { label: 'Check-in aberto', variant: 'default' };
  if (hour >= startH && hour < endH) return { label: 'Turno em andamento', variant: 'default' };
  if (hour < 15) return { label: 'Aguardando abertura', variant: 'secondary' };
  return { label: 'Concluído', variant: 'outline' };
}

export default function DashboardTodayCard() {
  const [shifts, setShifts] = useState<ShiftData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchToday = useCallback(async () => {
    const today = getBrasiliaToday();

    const { data: dayShifts } = await supabase
      .from('delivery_shifts')
      .select('id, horario_inicio, horario_fim, vagas')
      .eq('data', today)
      .order('horario_inicio');

    if (!dayShifts || dayShifts.length === 0) {
      setShifts([]);
      setLoading(false);
      return;
    }

    const shiftIds = dayShifts.map(s => s.id);
    const [checkinsRes, waitlistRes] = await Promise.all([
      supabase
        .from('delivery_checkins')
        .select('id, shift_id, driver_id, status')
        .in('shift_id', shiftIds)
        .in('status', ['confirmado', 'concluido']),
      supabase
        .from('delivery_checkins')
        .select('id, shift_id')
        .in('shift_id', shiftIds)
        .eq('status', 'fila_espera'),
    ]);

    const checkins = checkinsRes.data || [];
    const waitlist = waitlistRes.data || [];

    const driverIds = [...new Set(checkins.map(c => c.driver_id))];
    let driversMap: Record<string, string> = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('id, nome')
        .in('id', driverIds);
      (drivers || []).forEach(d => { driversMap[d.id] = d.nome; });
    }

    const result: ShiftData[] = dayShifts.map(s => ({
      shiftId: s.id,
      horarioInicio: s.horario_inicio?.slice(0, 5) || '',
      horarioFim: s.horario_fim?.slice(0, 5) || '',
      vagas: s.vagas,
      confirmados: checkins
        .filter(c => c.shift_id === s.id)
        .map(c => ({
          checkinId: c.id,
          driverName: driversMap[c.driver_id] || 'Desconhecido',
          status: c.status,
        })),
      waitlistCount: waitlist.filter(w => w.shift_id === s.id).length,
    }));

    setShifts(result);
    setLoading(false);
  }, []);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  if (loading) {
    return (
      <Card className="border-2 border-orange-400">
        <CardContent className="py-6 text-center text-muted-foreground text-sm">Carregando...</CardContent>
      </Card>
    );
  }

  if (shifts.length === 0) {
    return (
      <Card className="border-2 border-orange-400">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-orange-500" />
            Hoje — {format(new Date(), "dd/MM (EEEE)", { locale: ptBR })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum turno configurado para hoje</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="border-2 border-orange-400">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-orange-500" />
            Hoje — {format(new Date(), "dd/MM (EEEE)", { locale: ptBR })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {shifts.map(s => {
            const status = getShiftStatus(s.horarioInicio, s.horarioFim);
            const activeCount = s.confirmados.length;
            return (
              <div key={s.shiftId} className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold">{s.horarioInicio} — {s.horarioFim}</span>
                  <Badge variant={status.variant} className="text-[10px]">{status.label}</Badge>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{activeCount}/{s.vagas}</span> confirmados
                  </span>
                  {s.waitlistCount > 0 && (
                    <span className="text-xs text-muted-foreground">Fila: {s.waitlistCount} entregador{s.waitlistCount > 1 ? 'es' : ''}</span>
                  )}
                </div>
                {s.confirmados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 ml-1">
                    {s.confirmados.map(c => (
                      <Tooltip key={c.checkinId}>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center justify-center rounded-full text-[9px] font-bold w-6 h-6 bg-green-500 text-white">
                            {getInitials(c.driverName)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          {c.driverName}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
