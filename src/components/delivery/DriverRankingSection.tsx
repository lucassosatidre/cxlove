import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, subDays } from 'date-fns';

interface RankingRow {
  nome: string;
  status: string;
  confirmados: number;
  cancelamentos: number;
  noShows: number;
  taxa: number;
}

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ativo: 'default',
  inativo: 'secondary',
  suspenso: 'destructive',
};

export default function DriverRankingSection() {
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

      const [driversRes, checkinsRes] = await Promise.all([
        supabase.from('delivery_drivers').select('id, nome, status').order('nome'),
        supabase.from('delivery_checkins')
          .select('driver_id, status, delivery_shifts!inner(data)')
          .gte('delivery_shifts.data', thirtyDaysAgo),
      ]);

      const drivers = driversRes.data || [];
      const checkins = checkinsRes.data || [];

      const stats: Record<string, { confirmados: number; cancelamentos: number; noShows: number }> = {};
      checkins.forEach((c: any) => {
        if (!stats[c.driver_id]) stats[c.driver_id] = { confirmados: 0, cancelamentos: 0, noShows: 0 };
        if (c.status === 'confirmado' || c.status === 'concluido') stats[c.driver_id].confirmados++;
        else if (c.status === 'cancelado') stats[c.driver_id].cancelamentos++;
        else if (c.status === 'no_show') stats[c.driver_id].noShows++;
      });

      const ranking: RankingRow[] = drivers.map(d => {
        const s = stats[d.id] || { confirmados: 0, cancelamentos: 0, noShows: 0 };
        const presencaTotal = s.confirmados + s.noShows;
        const taxa = presencaTotal > 0 ? (s.confirmados / presencaTotal) * 100 : 0;
        return {
          nome: d.nome,
          status: d.status,
          confirmados: s.confirmados,
          cancelamentos: s.cancelamentos,
          noShows: s.noShows,
          taxa: Math.round(taxa),
        };
      });

      ranking.sort((a, b) => b.taxa - a.taxa);
      setRows(ranking);
      setLoading(false);
    };
    fetch();
  }, []);

  return (
    <div className="border rounded-lg overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entregador</TableHead>
            <TableHead className="text-center">Confirmados</TableHead>
            <TableHead className="text-center">Cancelamentos</TableHead>
            <TableHead className="text-center">No-shows</TableHead>
            <TableHead className="text-center">Taxa presença</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum entregador</TableCell></TableRow>
          ) : rows.map(r => (
            <TableRow key={r.nome} className={r.taxa < 70 && (r.confirmados + r.cancelamentos + r.noShows) > 0 ? 'bg-destructive/5' : ''}>
              <TableCell className="font-medium">{r.nome}</TableCell>
              <TableCell className="text-center">{r.confirmados}</TableCell>
              <TableCell className="text-center">{r.cancelamentos}</TableCell>
              <TableCell className="text-center text-destructive font-medium">{r.noShows}</TableCell>
              <TableCell className="text-center">
                <span className={`font-bold ${r.taxa < 70 && (r.confirmados + r.cancelamentos + r.noShows) > 0 ? 'text-destructive' : r.taxa >= 90 ? 'text-green-600' : ''}`}>
                  {r.confirmados + r.cancelamentos + r.noShows > 0 ? `${r.taxa}%` : '—'}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[r.status] || 'secondary'}>
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground px-4 py-2">Últimos 30 dias. Taxa = presentes / (presentes + faltas). Cancelamentos não afetam a taxa.</p>
    </div>
  );
}
