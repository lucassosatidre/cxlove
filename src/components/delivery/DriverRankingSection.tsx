import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

import { getPeriodRange } from './DriverSummaryCards';

interface RankingRow {
  nome: string;
  status: string;
  confirmados: number;
  cancelamentos: number;
  noShows: number;
  adminInserts: number;
  taxa: number;
}

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ativo: 'default',
  inativo: 'secondary',
  suspenso: 'destructive',
};

interface Props {
  period: string;
}

export default function DriverRankingSection({ period }: Props) {
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const { start } = getPeriodRange(period);

      const [driversRes, checkinsRes] = await Promise.all([
        supabase.from('delivery_drivers').select('id, nome, status').order('nome'),
        supabase.from('delivery_checkins')
          .select('driver_id, status, origin, delivery_shifts!inner(data)')
          .gte('delivery_shifts.data', start),
      ]);

      const drivers = driversRes.data || [];
      const checkins = checkinsRes.data || [];

      const stats: Record<string, { confirmados: number; cancelamentos: number; noShows: number; adminInserts: number; selfConfirmados: number; selfNoShows: number }> = {};
      checkins.forEach((c: any) => {
        if (!stats[c.driver_id]) stats[c.driver_id] = { confirmados: 0, cancelamentos: 0, noShows: 0, adminInserts: 0, selfConfirmados: 0, selfNoShows: 0 };
        const s = stats[c.driver_id];
        const origin = c.origin || 'entregador';
        if (c.status === 'confirmado' || c.status === 'concluido') {
          s.confirmados++;
          if (origin === 'entregador') s.selfConfirmados++;
        }
        else if (c.status === 'cancelado') s.cancelamentos++;
        else if (c.status === 'no_show') {
          s.noShows++;
          if (origin === 'entregador') s.selfNoShows++;
        }
        if (origin === 'admin') s.adminInserts++;
      });

      const ranking: RankingRow[] = drivers
        .map(d => {
          const s = stats[d.id] || { confirmados: 0, cancelamentos: 0, noShows: 0, adminInserts: 0, selfConfirmados: 0, selfNoShows: 0 };
          const selfTotal = s.selfConfirmados + s.selfNoShows;
          const taxa = selfTotal > 0 ? (s.selfConfirmados / selfTotal) * 100 : 0;
          return {
            nome: d.nome,
            status: d.status,
            confirmados: s.confirmados,
            cancelamentos: s.cancelamentos,
            noShows: s.noShows,
            adminInserts: s.adminInserts,
            taxa: Math.round(taxa),
          };
        })
        // Remove inactive drivers with 0 confirmations
        .filter(r => !(r.status !== 'ativo' && r.confirmados === 0 && r.cancelamentos === 0 && r.noShows === 0));

      ranking.sort((a, b) => b.taxa - a.taxa);
      setRows(ranking);
      setLoading(false);
    };
    fetch();
  }, [period]);

  function getProgressColor(taxa: number): string {
    if (taxa >= 90) return 'bg-green-500';
    if (taxa >= 70) return 'bg-yellow-500';
    return 'bg-destructive';
  }

  function getRowBg(r: RankingRow): string {
    const hasActivity = r.confirmados + r.cancelamentos + r.noShows > 0;
    if (!hasActivity) return '';
    if (r.taxa === 100) return 'bg-green-50 dark:bg-green-950/20';
    if (r.noShows > 0) return 'bg-red-50 dark:bg-red-950/10';
    return '';
  }

  const periodLabel = period === '7d' ? 'Últimos 7 dias' : period === '30d' ? 'Últimos 30 dias' : period === 'this_month' ? 'Este mês' : 'Mês anterior';

  return (
    <div className="border rounded-lg overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entregador</TableHead>
            <TableHead className="text-center">Confirmados</TableHead>
            <TableHead className="text-center">Cancelamentos</TableHead>
            <TableHead className="text-center">Faltas</TableHead>
            <TableHead className="text-center">Inseridos admin</TableHead>
            <TableHead className="text-center w-[160px]">Taxa presença</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhum entregador</TableCell></TableRow>
          ) : rows.map(r => {
            const hasActivity = r.confirmados + r.cancelamentos + r.noShows > 0;
            return (
              <TableRow key={r.nome} className={getRowBg(r)}>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell className="text-center">{r.confirmados}</TableCell>
                <TableCell className="text-center">{r.cancelamentos}</TableCell>
                <TableCell className="text-center text-destructive font-medium">{r.noShows}</TableCell>
                <TableCell className="text-center">
                  {r.adminInserts > 0 ? (
                    <span className="text-primary font-medium">{r.adminInserts}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {hasActivity ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getProgressColor(r.taxa)}`}
                          style={{ width: `${r.taxa}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold min-w-[32px] text-right ${r.taxa < 70 ? 'text-destructive' : r.taxa >= 90 ? 'text-green-600' : 'text-yellow-600'}`}>
                        {r.taxa}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant[r.status] || 'secondary'}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground px-4 py-2">{periodLabel}. Taxa = presenças próprias / (presenças próprias + faltas próprias). Inserções do admin e cancelamentos não afetam a taxa.</p>
    </div>
  );
}
