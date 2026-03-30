import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface CheckinRow {
  checkinId: string;
  driverName: string;
  confirmedAt: string | null;
  status: string;
}

interface ShiftBlock {
  shiftId: string;
  horarioInicio: string;
  horarioFim: string;
  checkins: CheckinRow[];
}

interface Props {
  closingDate: string;
  isCompleted: boolean;
  isAdmin: boolean;
}

export function useDriverAttendance(closingDate: string) {
  const [shifts, setShifts] = useState<ShiftBlock[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    if (!closingDate) return;
    setLoading(true);

    const { data: dayShifts } = await supabase
      .from('delivery_shifts')
      .select('id, horario_inicio, horario_fim')
      .eq('data', closingDate)
      .order('horario_inicio');

    if (!dayShifts || dayShifts.length === 0) {
      setShifts([]);
      setLoading(false);
      return;
    }

    const shiftIds = dayShifts.map(s => s.id);
    const { data: checkins } = await supabase
      .from('delivery_checkins')
      .select('id, shift_id, driver_id, status, confirmed_at')
      .in('shift_id', shiftIds)
      .in('status', ['confirmado', 'concluido', 'no_show']);

    if (!checkins || checkins.length === 0) {
      setShifts([]);
      setLoading(false);
      return;
    }

    const driverIds = [...new Set(checkins.map(c => c.driver_id))];
    let driversMap: Record<string, string> = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('id, nome')
        .in('id', driverIds);
      (drivers || []).forEach(d => { driversMap[d.id] = d.nome; });
    }

    const result: ShiftBlock[] = dayShifts
      .map(s => {
        const shiftCheckins = (checkins || [])
          .filter(c => c.shift_id === s.id)
          .map(c => ({
            checkinId: c.id,
            driverName: driversMap[c.driver_id] || 'Desconhecido',
            confirmedAt: c.confirmed_at,
            status: c.status,
          }));
        return {
          shiftId: s.id,
          horarioInicio: s.horario_inicio?.slice(0, 5) || '',
          horarioFim: s.horario_fim?.slice(0, 5) || '',
          checkins: shiftCheckins,
        };
      })
      .filter(s => s.checkins.length > 0);

    setShifts(result);
    setLoading(false);
  }, [closingDate]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  const unmarkedCount = shifts.reduce(
    (sum, s) => sum + s.checkins.filter(c => c.status === 'confirmado').length, 0
  );

  return { shifts, loading, fetchAttendance, unmarkedCount };
}

export default function DriverAttendanceSection({ closingDate, isCompleted, isAdmin }: Props) {
  const { shifts, loading, fetchAttendance } = useDriverAttendance(closingDate);
  const [updating, setUpdating] = useState<string | null>(null);

  const readOnly = isCompleted && !isAdmin;

  const handleMark = async (checkinId: string, newStatus: 'concluido' | 'no_show', driverName: string) => {
    setUpdating(checkinId);
    const { error } = await supabase
      .from('delivery_checkins')
      .update({ status: newStatus })
      .eq('id', checkinId);

    if (error) {
      toast.error('Erro ao atualizar presença');
    } else {
      if (newStatus === 'concluido') {
        toast.success(`Presença confirmada: ${driverName}`);
      } else {
        toast.success(`${driverName} marcado como falta`);
      }
      fetchAttendance();
    }
    setUpdating(null);
  };

  if (loading || shifts.length === 0) return null;

  return (
    <div className="border-b border-border bg-card">
      <div className="px-6 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Presença de Entregadores
        </p>
        <div className="space-y-2">
          {shifts.map(s => (
            <div key={s.shiftId} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Turno {s.horarioInicio} — {s.horarioFim}
              </div>
              <div className="divide-y divide-border">
                {s.checkins.map(c => {
                  const isPresent = c.status === 'concluido';
                  const isAbsent = c.status === 'no_show';
                  const isPending = c.status === 'confirmado';

                  return (
                    <div
                      key={c.checkinId}
                      className={`flex items-center justify-between px-3 py-2 ${
                        isPresent ? 'bg-green-50 dark:bg-green-950/20' :
                        isAbsent ? 'bg-red-50 dark:bg-red-950/20' :
                        'bg-card'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{c.driverName}</span>
                        {c.confirmedAt && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                            <Clock className="h-3 w-3" />
                            {format(new Date(c.confirmedAt), 'HH:mm')}
                          </span>
                        )}
                        {isPresent && <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0">Presente</Badge>}
                        {isAbsent && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Faltou</Badge>}
                      </div>

                      {!readOnly && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant={isPresent ? 'default' : 'outline'}
                            size="sm"
                            className={`h-8 px-2.5 text-xs min-w-[44px] ${isPresent ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                            disabled={updating === c.checkinId}
                            onClick={() => handleMark(c.checkinId, 'concluido', c.driverName)}
                          >
                            <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            Presente
                          </Button>
                          <Button
                            variant={isAbsent ? 'destructive' : 'outline'}
                            size="sm"
                            className="h-8 px-2.5 text-xs min-w-[44px]"
                            disabled={updating === c.checkinId}
                            onClick={() => handleMark(c.checkinId, 'no_show', c.driverName)}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Faltou
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
