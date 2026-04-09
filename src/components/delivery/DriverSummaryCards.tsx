import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Calendar, Check, X, AlertTriangle } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';

interface Stats {
  activeDrivers: number;
  shiftsInPeriod: number;
  confirmationsInPeriod: number;
  cancellationsInPeriod: number;
  noShowsInPeriod: number;
}

interface Props {
  period: string;
}

function getPeriodRange(period: string): { start: string; end: string } {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  switch (period) {
    case '7d':
      return { start: format(subDays(now, 7), 'yyyy-MM-dd'), end: today };
    case '30d':
      return { start: format(subDays(now, 30), 'yyyy-MM-dd'), end: today };
    case 'this_month':
      return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') };
    case 'last_month': {
      const prev = subMonths(now, 1);
      return { start: format(startOfMonth(prev), 'yyyy-MM-dd'), end: format(endOfMonth(prev), 'yyyy-MM-dd') };
    }
    default:
      return { start: format(subDays(now, 30), 'yyyy-MM-dd'), end: today };
  }
}

export { getPeriodRange };

export default function DriverSummaryCards({ period }: Props) {
  const [stats, setStats] = useState<Stats>({
    activeDrivers: 0, shiftsInPeriod: 0, confirmationsInPeriod: 0,
    cancellationsInPeriod: 0, noShowsInPeriod: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const { start, end } = getPeriodRange(period);

      const [driversRes, shiftsRes, checkinsRes] = await Promise.all([
        supabase.from('delivery_drivers').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase.from('delivery_shifts').select('id', { count: 'exact', head: true }).gte('data', start).lte('data', end),
        supabase.from('delivery_checkins').select('status, shift_id, delivery_shifts!inner(data)')
          .gte('delivery_shifts.data', start).lte('delivery_shifts.data', end),
      ]);

      const checkins = checkinsRes.data || [];
      setStats({
        activeDrivers: driversRes.count || 0,
        shiftsInPeriod: shiftsRes.count || 0,
        confirmationsInPeriod: checkins.filter(c => c.status === 'confirmado' || c.status === 'concluido').length,
        cancellationsInPeriod: checkins.filter(c => c.status === 'cancelado').length,
        noShowsInPeriod: checkins.filter(c => c.status === 'no_show').length,
      });
    };
    fetchStats();
  }, [period]);

  const cards = [
    { label: 'Ativos', value: stats.activeDrivers, icon: Users, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-950/40' },
    { label: 'Turnos', value: stats.shiftsInPeriod, icon: Calendar, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-950/40' },
    { label: 'Confirmações', value: stats.confirmationsInPeriod, icon: Check, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-950/40' },
    { label: 'Cancelamentos', value: stats.cancellationsInPeriod, icon: X, color: 'text-muted-foreground', bg: 'bg-muted' },
    { label: 'No-shows', value: stats.noShowsInPeriod, icon: AlertTriangle, color: stats.noShowsInPeriod > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground', bg: stats.noShowsInPeriod > 0 ? 'bg-red-100 dark:bg-red-950/40' : 'bg-muted' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map(c => (
        <Card key={c.label}>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
              <c.icon className={`h-5 w-5 ${c.color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
