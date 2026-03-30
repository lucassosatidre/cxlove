import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Calendar, Check, X, AlertTriangle } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';

interface Stats {
  activeDrivers: number;
  shiftsThisMonth: number;
  confirmationsThisMonth: number;
  cancellationsThisMonth: number;
  noShowsThisMonth: number;
}

export default function DriverSummaryCards() {
  const [stats, setStats] = useState<Stats>({
    activeDrivers: 0, shiftsThisMonth: 0, confirmationsThisMonth: 0,
    cancellationsThisMonth: 0, noShowsThisMonth: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const now = new Date();
      const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
      const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

      const [driversRes, shiftsRes, checkinsRes] = await Promise.all([
        supabase.from('delivery_drivers').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase.from('delivery_shifts').select('id', { count: 'exact', head: true }).gte('data', monthStart).lte('data', monthEnd),
        supabase.from('delivery_checkins').select('status, shift_id, delivery_shifts!inner(data)')
          .gte('delivery_shifts.data', monthStart).lte('delivery_shifts.data', monthEnd),
      ]);

      const checkins = checkinsRes.data || [];
      setStats({
        activeDrivers: driversRes.count || 0,
        shiftsThisMonth: shiftsRes.count || 0,
        confirmationsThisMonth: checkins.filter(c => c.status === 'confirmado' || c.status === 'concluido').length,
        cancellationsThisMonth: checkins.filter(c => c.status === 'cancelado').length,
        noShowsThisMonth: checkins.filter(c => c.status === 'no_show').length,
      });
    };
    fetchStats();
  }, []);

  const cards = [
    { label: 'Ativos', value: stats.activeDrivers, icon: Users, color: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'Turnos (mês)', value: stats.shiftsThisMonth, icon: Calendar, color: 'text-primary', bg: 'bg-primary/10' },
    { label: 'Confirmações', value: stats.confirmationsThisMonth, icon: Check, color: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'Cancelamentos', value: stats.cancellationsThisMonth, icon: X, color: 'text-muted-foreground', bg: 'bg-muted' },
    { label: 'No-shows', value: stats.noShowsThisMonth, icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10' },
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
