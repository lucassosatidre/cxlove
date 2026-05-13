import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, PhoneIncoming, PhoneOutgoing, CheckCircle, Clock, DollarSign } from 'lucide-react';

interface Stats {
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  totalMinutes: number;
  totalCost: number;
  ordersCollected: number;
  avgTicket: number;
}

export default function SofiaPainel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { data: calls } = await supabase
      .from('sofia_calls')
      .select('direction, duration_sec, cost_minutes, extracted_data, status')
      .gte('started_at', monthStart.toISOString());

    if (!calls) {
      setStats({ totalCalls: 0, inboundCalls: 0, outboundCalls: 0, totalMinutes: 0, totalCost: 0, ordersCollected: 0, avgTicket: 0 });
      setLoading(false);
      return;
    }

    const totalCalls = calls.length;
    const inboundCalls = calls.filter((c) => c.direction === 'inbound').length;
    const outboundCalls = calls.filter((c) => c.direction === 'outbound').length;
    const totalSec = calls.reduce((acc, c) => acc + (c.duration_sec ?? 0), 0);
    const totalCost = calls.reduce((acc, c) => acc + Number(c.cost_minutes ?? 0), 0);
    const completedOrders = calls.filter((c: any) => c.extracted_data?.status === true || c.extracted_data?.status === 'true');
    const ordersCollected = completedOrders.length;
    const tickets = completedOrders
      .map((c: any) => parseFloat(String(c.extracted_data?.valor ?? '').replace(/[^\d,.]/g, '').replace(',', '.')))
      .filter((v) => !isNaN(v) && v > 0);
    const avgTicket = tickets.length > 0 ? tickets.reduce((a, b) => a + b, 0) / tickets.length : 0;

    setStats({
      totalCalls,
      inboundCalls,
      outboundCalls,
      totalMinutes: Math.round(totalSec / 60),
      totalCost,
      ordersCollected,
      avgTicket,
    });
    setLoading(false);
  }

  if (loading) return <div className="text-sm text-muted-foreground">Carregando métricas...</div>;
  if (!stats) return null;

  const fmt = (n: number) => n.toLocaleString('pt-BR');
  const fmtMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-4">
      <p className="section-title">Mês atual</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric icon={<Phone className="h-4 w-4" />} label="Total de chamadas" value={fmt(stats.totalCalls)} />
        <Metric icon={<PhoneIncoming className="h-4 w-4" />} label="Inbound" value={fmt(stats.inboundCalls)} />
        <Metric icon={<PhoneOutgoing className="h-4 w-4" />} label="Outbound" value={fmt(stats.outboundCalls)} />
        <Metric icon={<Clock className="h-4 w-4" />} label="Minutos totais" value={fmt(stats.totalMinutes)} />
        <Metric icon={<CheckCircle className="h-4 w-4 text-success" />} label="Pedidos coletados" value={fmt(stats.ordersCollected)} />
        <Metric icon={<DollarSign className="h-4 w-4" />} label="Ticket médio" value={fmtMoney(stats.avgTicket)} />
        <Metric icon={<DollarSign className="h-4 w-4" />} label="Custo total" value={fmtMoney(stats.totalCost)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Dados sincronizados localmente. Use a aba Assistentes pra forçar uma nova sincronização.
      </p>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono-tabular">{value}</div>
      </CardContent>
    </Card>
  );
}
