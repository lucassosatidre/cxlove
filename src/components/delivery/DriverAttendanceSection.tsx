import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, Truck } from 'lucide-react';
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

  const allCheckins = shifts.flatMap(s => s.checkins);
  const unmarkedCount = allCheckins.filter(c => c.status === 'confirmado').length;
  const presentCount = allCheckins.filter(c => c.status === 'concluido').length;
  const absentCount = allCheckins.filter(c => c.status === 'no_show').length;
  const totalCount = allCheckins.length;

  return { shifts, setShifts, loading, fetchAttendance, unmarkedCount, presentCount, absentCount, totalCount };
}

export default function DriverAttendanceSection({ closingDate, isCompleted, isAdmin }: Props) {
  const { shifts, setShifts, loading, presentCount, absentCount, totalCount } = useDriverAttendance(closingDate);
  const [updating, setUpdating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const readOnly = isCompleted && !isAdmin;

  const handleMark = async (checkinId: string, newStatus: 'concluido' | 'no_show', driverName: string) => {
    // Optimistic update
    setShifts(prev => prev.map(s => ({
      ...s,
      checkins: s.checkins.map(c => c.checkinId === checkinId ? { ...c, status: newStatus } : c),
    })));
    setUpdating(checkinId);

    const { error } = await supabase
      .from('delivery_checkins')
      .update({ status: newStatus })
      .eq('id', checkinId);

    if (error) {
      toast.error('Erro ao atualizar presença');
      // Revert optimistic update
      setShifts(prev => prev.map(s => ({
        ...s,
        checkins: s.checkins.map(c => c.checkinId === checkinId ? { ...c, status: 'confirmado' } : c),
      })));
    } else {
      if (newStatus === 'concluido') {
        toast.success(`Presença confirmada: ${driverName}`);
      } else {
        toast.success(`${driverName} marcado como falta`);
      }
      console.log(`[Attendance] ${driverName} marked as ${newStatus}, checkinId=${checkinId}`);
    }
    setUpdating(null);
  };

  if (loading || shifts.length === 0) return null;

  return (
    <div className="border-b border-border bg-card">
      <button
        className="w-full flex items-center gap-2 px-6 py-3 hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Truck className="h-4 w-4 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Presença de Entregadores ({totalCount})
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          {presentCount > 0 && (
            <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0">
              {presentCount} presente{presentCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {absentCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              {absentCount} falta{absentCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-6 py-3 space-y-2">
          {shifts.map(s => (
            <div key={s.shiftId} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Turno {s.horarioInicio} — {s.horarioFim}
              </div>
              <div className="divide-y divide-border">
                {s.checkins.map(c => {
                  const isPresent = c.status === 'concluido';
                  const isAbsent = c.status === 'no_show';

                  return (
                    <div
                      key={c.checkinId}
                      className={`flex items-center justify-between px-3 py-2 transition-colors ${
                        isPresent ? 'bg-green-50 dark:bg-green-950/20' :
                        isAbsent ? 'bg-red-50 dark:bg-red-950/20' :
                        'bg-card'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm font-medium truncate ${isAbsent ? 'line-through opacity-50' : ''}`}>
                          {c.driverName}
                        </span>
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
      )}
    </div>
  );
}
