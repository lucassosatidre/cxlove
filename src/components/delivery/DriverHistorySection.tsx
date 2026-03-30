import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CalendarIcon, X } from 'lucide-react';
import { format, subDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface HistoryRow {
  checkinId: string;
  data: string;
  horarioInicio: string;
  horarioFim: string;
  driverName: string;
  status: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

interface DriverOption {
  id: string;
  nome: string;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  confirmado: { label: 'Confirmado', variant: 'default' },
  cancelado: { label: 'Cancelado', variant: 'secondary' },
  no_show: { label: 'Faltou', variant: 'destructive' },
  concluido: { label: 'Concluído', variant: 'outline' },
};

export default function DriverHistorySection() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDriver, setFilterDriver] = useState('todos');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [dateFrom, setDateFrom] = useState<Date>(subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [noShowDialog, setNoShowDialog] = useState<{ checkinId: string; name: string; horario: string } | null>(null);
  const [acting, setActing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [driversRes, checkinsRes] = await Promise.all([
      supabase.from('delivery_drivers').select('id, nome').order('nome'),
      supabase.from('delivery_checkins')
        .select('id, shift_id, driver_id, status, confirmed_at, cancelled_at, cancel_reason, delivery_shifts!inner(data, horario_inicio, horario_fim)')
        .gte('delivery_shifts.data', format(dateFrom, 'yyyy-MM-dd'))
        .lte('delivery_shifts.data', format(dateTo, 'yyyy-MM-dd'))
        .order('created_at', { ascending: false }),
    ]);

    setDrivers((driversRes.data || []) as DriverOption[]);

    const driversMap: Record<string, string> = {};
    (driversRes.data || []).forEach((d: any) => { driversMap[d.id] = d.nome; });

    const items: HistoryRow[] = (checkinsRes.data || []).map((c: any) => {
      const shift = c.delivery_shifts;
      return {
        checkinId: c.id,
        data: shift?.data || '',
        horarioInicio: shift?.horario_inicio?.slice(0, 5) || '',
        horarioFim: shift?.horario_fim?.slice(0, 5) || '',
        driverName: driversMap[c.driver_id] || 'Desconhecido',
        status: c.status,
        confirmedAt: c.confirmed_at,
        cancelledAt: c.cancelled_at,
        cancelReason: c.cancel_reason,
      };
    });

    // Sort by date desc, then horario
    items.sort((a, b) => b.data.localeCompare(a.data) || a.horarioInicio.localeCompare(b.horarioInicio));
    setRows(items);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleNoShow = async () => {
    if (!noShowDialog) return;
    setActing(true);
    const { error } = await supabase
      .from('delivery_checkins')
      .update({ status: 'no_show' })
      .eq('id', noShowDialog.checkinId);
    if (error) toast.error('Erro ao marcar no-show');
    else { toast.success('Marcado como no-show'); fetchData(); }
    setActing(false);
    setNoShowDialog(null);
  };

  const filtered = rows.filter(r => {
    if (filterDriver !== 'todos' && r.driverName !== filterDriver) return false;
    if (filterStatus !== 'todos' && r.status !== filterStatus) return false;
    return true;
  });

  return (
    <>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={filterDriver} onValueChange={setFilterDriver}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Entregador" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos entregadores</SelectItem>
              {drivers.map(d => <SelectItem key={d.id} value={d.nome}>{d.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos status</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
              <SelectItem value="no_show">No-show</SelectItem>
              <SelectItem value="concluido">Concluído</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-auto text-sm">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {format(dateFrom, 'dd/MM')} — {format(dateTo, 'dd/MM/yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={{ from: dateFrom, to: dateTo }}
                onSelect={(range) => {
                  if (range?.from) setDateFrom(range.from);
                  if (range?.to) setDateTo(range.to);
                }}
                numberOfMonths={2}
                locale={ptBR}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Entregador</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Confirmado às</TableHead>
                <TableHead className="hidden md:table-cell">Cancelado às</TableHead>
                <TableHead className="hidden lg:table-cell">Motivo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum registro encontrado</TableCell></TableRow>
              ) : filtered.map(r => {
                const sc = statusConfig[r.status] || { label: r.status, variant: 'secondary' as const };
                const isPast = r.data < format(new Date(), 'yyyy-MM-dd');
                return (
                  <TableRow key={r.checkinId}>
                    <TableCell className="text-sm">{r.data ? format(parseISO(r.data), 'dd/MM/yyyy') : ''}</TableCell>
                    <TableCell className="text-sm">{r.horarioInicio} — {r.horarioFim}</TableCell>
                    <TableCell className="text-sm font-medium">{r.driverName}</TableCell>
                    <TableCell>
                      <Badge variant={sc.variant} className={r.status === 'concluido' ? 'bg-blue-100 text-blue-700' : ''}>
                        {sc.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {r.confirmedAt ? format(new Date(r.confirmedAt), 'dd/MM HH:mm') : '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {r.cancelledAt ? format(new Date(r.cancelledAt), 'dd/MM HH:mm') : '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[200px] truncate">
                      {r.cancelReason || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === 'confirmado' && isPast && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          title="Marcar no-show"
                          onClick={() => setNoShowDialog({
                            checkinId: r.checkinId,
                            name: r.driverName,
                            horario: `${r.horarioInicio} — ${r.horarioFim}`,
                          })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">{filtered.length} registro{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      <Dialog open={!!noShowDialog} onOpenChange={() => setNoShowDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Marcar No-show?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Marcar {noShowDialog?.name} como no-show no turno de {noShowDialog?.horario}?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNoShowDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleNoShow} disabled={acting}>
              {acting ? 'Processando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
