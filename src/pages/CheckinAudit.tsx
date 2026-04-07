import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarIcon, RefreshCw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBrasiliaToday } from '@/lib/brasilia-time';
import AppLayout from '@/components/AppLayout';
import * as XLSX from 'xlsx';

interface AuditRow {
  id: string;
  nome: string;
  status: string;
  origin: string;
  device_ip: string | null;
  device_user_agent: string | null;
  device_info: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  admin_removed_by: string | null;
  admin_inserted_by: string | null;
  waitlist_entered_at: string | null;
  substituto_pos_18h: boolean;
}

interface LogRow {
  id: string;
  checkin_id: string;
  driver_name: string;
  action: string;
  device_ip: string | null;
  device_user_agent: string | null;
  device_info: string | null;
  performed_by: string;
  created_at: string;
}

const statusBadge: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  confirmado: { label: 'Confirmado', variant: 'default' },
  fila_espera: { label: 'Fila de Espera', variant: 'outline' },
  cancelado: { label: 'Cancelado', variant: 'secondary' },
  no_show: { label: 'Faltou', variant: 'destructive' },
  concluido: { label: 'Concluído', variant: 'outline' },
};

const actionLabels: Record<string, string> = {
  checkin: '✅ Check-in',
  cancelamento: '❌ Cancelamento',
  fila_entrada: '⏳ Entrada na fila',
  fila_saida: '🚪 Saída da fila',
  fila_promovido: '🟢 Promovido da fila',
  admin_removido: '🔴 Removido (admin)',
  admin_adicionado: '➕ Adicionado (admin)',
};

function parseUA(ua: string | null): string {
  if (!ua) return '—';
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('SamsungBrowser')) return 'Samsung Browser';
  if (ua.includes('Android')) return 'Android Chrome';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'Mac';
  return ua.slice(0, 25) + '…';
}

function fmtTs(ts: string | null): string {
  if (!ts) return '—';
  try {
    return format(new Date(ts), 'dd/MM HH:mm:ss');
  } catch {
    return ts;
  }
}

export default function CheckinAudit() {
  const [date, setDate] = useState<Date>(() => {
    const today = getBrasiliaToday();
    return parseISO(today);
  });
  const [checkins, setCheckins] = useState<AuditRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [shiftInfo, setShiftInfo] = useState<{ vagas: number; horario: string } | null>(null);

  const dateStr = format(date, 'yyyy-MM-dd');

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch shift info
    const { data: shifts } = await supabase
      .from('delivery_shifts')
      .select('id, vagas, horario_inicio, horario_fim')
      .eq('data', dateStr)
      .order('horario_inicio')
      .limit(1);

    const shift = shifts?.[0];
    if (shift) {
      setShiftInfo({
        vagas: shift.vagas,
        horario: `${(shift.horario_inicio as string).slice(0, 5)} — ${(shift.horario_fim as string).slice(0, 5)}`,
      });
    } else {
      setShiftInfo(null);
    }

    // Fetch checkins for the date
    const { data: checkinsData } = await supabase
      .from('delivery_checkins')
      .select('id, status, origin, device_ip, device_user_agent, device_info, created_at, confirmed_at, cancelled_at, cancel_reason, admin_removed_by, admin_inserted_by, waitlist_entered_at, substituto_pos_18h, driver_id, shift_id, delivery_shifts!inner(data)')
      .eq('delivery_shifts.data', dateStr)
      .order('created_at', { ascending: true });

    // Fetch driver names
    const driverIds = [...new Set((checkinsData || []).map((c: any) => c.driver_id))];
    let driverMap: Record<string, string> = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('id, nome')
        .in('id', driverIds);
      (drivers || []).forEach((d: any) => { driverMap[d.id] = d.nome; });
    }

    const rows: AuditRow[] = (checkinsData || []).map((c: any) => ({
      id: c.id,
      nome: driverMap[c.driver_id] || 'Desconhecido',
      status: c.status,
      origin: c.origin || 'entregador',
      device_ip: c.device_ip,
      device_user_agent: c.device_user_agent,
      device_info: c.device_info,
      created_at: c.created_at,
      confirmed_at: c.confirmed_at,
      cancelled_at: c.cancelled_at,
      cancel_reason: c.cancel_reason,
      admin_removed_by: c.admin_removed_by,
      admin_inserted_by: c.admin_inserted_by,
      waitlist_entered_at: c.waitlist_entered_at,
      substituto_pos_18h: c.substituto_pos_18h || false,
    }));
    setCheckins(rows);

    // Fetch logs for checkins of this date
    const checkinIds = rows.map(r => r.id);
    if (checkinIds.length > 0) {
      const { data: logsData } = await supabase
        .from('delivery_checkin_logs' as any)
        .select('id, checkin_id, driver_id, action, device_ip, device_user_agent, device_info, performed_by, created_at')
        .in('checkin_id', checkinIds)
        .order('created_at', { ascending: true });

      const logDriverIds = [...new Set((logsData || []).map((l: any) => l.driver_id))];
      const missingDriverIds = logDriverIds.filter(id => !driverMap[id]);
      if (missingDriverIds.length > 0) {
        const { data: extraDrivers } = await supabase
          .from('delivery_drivers')
          .select('id, nome')
          .in('id', missingDriverIds);
        (extraDrivers || []).forEach((d: any) => { driverMap[d.id] = d.nome; });
      }

      setLogs((logsData || []).map((l: any) => ({
        id: l.id,
        checkin_id: l.checkin_id,
        driver_name: driverMap[l.driver_id] || 'Desconhecido',
        action: l.action,
        device_ip: l.device_ip,
        device_user_agent: l.device_user_agent,
        device_info: l.device_info,
        performed_by: l.performed_by,
        created_at: l.created_at,
      })));
    } else {
      setLogs([]);
    }

    setLoading(false);
  }, [dateStr]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const confirmedCount = checkins.filter(c => c.status === 'confirmado').length;
  const waitlistCount = checkins.filter(c => c.status === 'fila_espera').length;
  const cancelledCount = checkins.filter(c => c.status === 'cancelado').length;

  const handleExport = () => {
    const data = checkins.map(c => ({
      'Entregador': c.nome,
      'Status': statusBadge[c.status]?.label || c.status,
      'Origem': c.origin === 'admin' ? 'Admin' : 'Entregador',
      'IP': c.device_ip || '',
      'Dispositivo': parseUA(c.device_user_agent),
      'Criado em': fmtTs(c.created_at),
      'Confirmado em': fmtTs(c.confirmed_at),
      'Cancelado em': fmtTs(c.cancelled_at),
      'Motivo Cancel.': c.cancel_reason || '',
      'Fila entrada': fmtTs(c.waitlist_entered_at),
      'Substituto pós 18h': c.substituto_pos_18h ? 'Sim' : '',
      'Admin inseriu': c.admin_inserted_by || '',
      'Admin removeu': c.admin_removed_by || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
    XLSX.writeFile(wb, `auditoria_checkin_${dateStr}.xlsx`);
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Auditoria de Check-in</h1>
            <p className="text-sm text-muted-foreground">Log completo de ações dos entregadores</p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {format(date, 'dd/MM/yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  locale={ptBR}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={checkins.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Exportar
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-card border rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{checkins.length}</p>
            <p className="text-xs text-muted-foreground">Total registros</p>
          </div>
          <div className="bg-card border rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{confirmedCount}</p>
            <p className="text-xs text-muted-foreground">Confirmados</p>
          </div>
          <div className="bg-card border rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-600">{waitlistCount}</p>
            <p className="text-xs text-muted-foreground">Na fila</p>
          </div>
          <div className="bg-card border rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{cancelledCount}</p>
            <p className="text-xs text-muted-foreground">Cancelados</p>
          </div>
          <div className="bg-card border rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{shiftInfo?.vagas ?? '—'}</p>
            <p className="text-xs text-muted-foreground">Vagas ({shiftInfo?.horario ?? 'sem turno'})</p>
          </div>
        </div>

        {/* Checkins table */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2">Timeline de Check-ins</h2>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Entregador</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead>Confirmado</TableHead>
                  <TableHead>Fila entrada</TableHead>
                  <TableHead>Cancelado</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : checkins.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Nenhum registro para esta data</TableCell></TableRow>
                ) : checkins.map((c, idx) => {
                  const sb = statusBadge[c.status] || { label: c.status, variant: 'secondary' as const };
                  return (
                    <TableRow key={c.id} className={c.status === 'cancelado' ? 'opacity-60' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-sm">
                        {c.nome}
                        {c.substituto_pos_18h && <span className="ml-1 text-[10px] text-amber-600">(sub)</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sb.variant} className={c.status === 'confirmado' ? 'bg-green-100 text-green-700' : c.status === 'fila_espera' ? 'bg-amber-100 text-amber-700' : ''}>
                          {sb.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{c.origin === 'admin' ? '🔑 Admin' : '📱 Entregador'}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{c.device_ip || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate" title={c.device_user_agent || ''}>
                        {parseUA(c.device_user_agent)}
                        {c.device_info && <span className="block text-[10px]">{c.device_info}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTs(c.created_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTs(c.confirmed_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTs(c.waitlist_entered_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTs(c.cancelled_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{c.cancel_reason || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Action logs table */}
        {logs.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-2">Log de Ações (delivery_checkin_logs)</h2>
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Entregador</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Dispositivo</TableHead>
                    <TableHead>Executado por</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l, idx) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{l.driver_name}</TableCell>
                      <TableCell className="text-sm">{actionLabels[l.action] || l.action}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{l.device_ip || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{parseUA(l.device_user_agent)}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{l.performed_by?.slice(0, 8) || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTs(l.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
