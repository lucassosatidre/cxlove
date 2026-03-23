import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreditCard, Plus, Trash2, Eye, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface MachineReading {
  id: string;
  machine_serial: string;
  delivery_person: string;
  debit_amount: number;
  credit_amount: number;
  voucher_amount: number;
  pix_amount: number;
}

interface Props {
  dailyClosingId: string;
  deliveryPersons: string[];
  isCompleted: boolean;
}

const SERIAL_PREFIX = 'S1F2-000';

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function MachineReadingsSection({ dailyClosingId, deliveryPersons, isCompleted }: Props) {
  const { user } = useAuth();
  const [readings, setReadings] = useState<MachineReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [showByDriver, setShowByDriver] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [validationError, setValidationError] = useState('');
  const saveTimers = useState<Record<string, ReturnType<typeof setTimeout>>>({})[0];

  useEffect(() => {
    loadReadings();
    return () => { Object.values(saveTimers).forEach(clearTimeout); };
  }, [dailyClosingId]);

  const loadReadings = async () => {
    const { data } = await supabase
      .from('machine_readings')
      .select('id, machine_serial, delivery_person, debit_amount, credit_amount, voucher_amount, pix_amount')
      .eq('daily_closing_id', dailyClosingId)
      .order('created_at', { ascending: true });
    setReadings((data || []).map(r => ({
      ...r,
      debit_amount: Number(r.debit_amount),
      credit_amount: Number(r.credit_amount),
      voucher_amount: Number(r.voucher_amount),
      pix_amount: Number(r.pix_amount),
    })));
    setLoading(false);
  };

  const addReading = async () => {
    if (!user) return;
    // Validate last block
    if (readings.length > 0) {
      const last = readings[readings.length - 1];
      if (!last.machine_serial.trim() || !last.delivery_person.trim()) {
        setValidationError('Preencha o S/N e o entregador antes de adicionar uma nova maquininha');
        return;
      }
    }
    setValidationError('');
    const { data, error } = await supabase
      .from('machine_readings')
      .insert({
        daily_closing_id: dailyClosingId,
        user_id: user.id,
        machine_serial: '',
        delivery_person: '',
        debit_amount: 0,
        credit_amount: 0,
        voucher_amount: 0,
        pix_amount: 0,
      })
      .select('id, machine_serial, delivery_person, debit_amount, credit_amount, voucher_amount, pix_amount')
      .single();
    if (error) { toast.error('Erro ao adicionar maquininha'); return; }
    if (data) {
      setReadings(prev => [...prev, { ...data, debit_amount: 0, credit_amount: 0, voucher_amount: 0, pix_amount: 0 }]);
      setExpandedIds(prev => new Set(prev).add(data.id));
    }
  };

  const removeReading = async (id: string) => {
    const { error } = await supabase.from('machine_readings').delete().eq('id', id);
    if (error) { toast.error('Erro ao remover'); return; }
    setReadings(prev => prev.filter(r => r.id !== id));
  };

  const debouncedSave = useCallback((id: string, field: string, value: string | number) => {
    if (saveTimers[id]) clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(async () => {
      const updateData: Record<string, unknown> = { [field]: value, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('machine_readings').update(updateData).eq('id', id);
      if (error) toast.error('Erro ao salvar');
    }, 600);
  }, []);

  const updateField = (id: string, field: keyof MachineReading, value: string | number) => {
    setReadings(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    debouncedSave(id, field, value);
  };

  const totals = useMemo(() => {
    return readings.reduce((acc, r) => ({
      debit: acc.debit + r.debit_amount,
      credit: acc.credit + r.credit_amount,
      voucher: acc.voucher + r.voucher_amount,
      pix: acc.pix + r.pix_amount,
    }), { debit: 0, credit: 0, voucher: 0, pix: 0 });
  }, [readings]);

  const totalGeral = totals.debit + totals.credit + totals.voucher + totals.pix;

  const byDriver = useMemo(() => {
    const map: Record<string, { debit: number; credit: number; voucher: number; pix: number; count: number }> = {};
    for (const r of readings) {
      const name = r.delivery_person || 'Sem entregador';
      if (!map[name]) map[name] = { debit: 0, credit: 0, voucher: 0, pix: 0, count: 0 };
      map[name].debit += r.debit_amount;
      map[name].credit += r.credit_amount;
      map[name].voucher += r.voucher_amount;
      map[name].pix += r.pix_amount;
      map[name].count++;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [readings]);

  if (loading) return null;

  return (
    <div className="border-b border-border bg-card">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Conferência de Maquininhas
            </span>
            {readings.length > 0 && (
              <span className="text-xs text-muted-foreground">({readings.length})</span>
            )}
          </div>
          {!isCompleted && (
            <div className="flex items-center gap-2">
              {validationError && (
                <span className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {validationError}
                </span>
              )}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addReading}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Adicionar Maquininha
              </Button>
            </div>
          )}
        </div>

        {readings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma maquininha adicionada.</p>
        ) : (
          <div className="space-y-3">
            {readings.map((r) => (
              <div key={r.id} className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">🔢 S/N</label>
                    <div className="flex items-center gap-0">
                      <span className="text-xs font-mono bg-muted px-2 py-1.5 rounded-l-md border border-r-0 border-input text-muted-foreground">
                        {SERIAL_PREFIX}
                      </span>
                      <Input
                        value={r.machine_serial}
                        onChange={(e) => updateField(r.id, 'machine_serial', e.target.value)}
                        className="h-8 text-xs w-24 rounded-l-none font-mono"
                        placeholder="000"
                        disabled={isCompleted}
                      />
                    </div>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">👤 Entregador</label>
                    <Select
                      value={r.delivery_person}
                      onValueChange={(v) => updateField(r.id, 'delivery_person', v)}
                      disabled={isCompleted}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {deliveryPersons.map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!isCompleted && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeReading(r.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: '💳 Débito', field: 'debit_amount' as const },
                    { label: '💳 Crédito', field: 'credit_amount' as const },
                    { label: '🎟️ Voucher', field: 'voucher_amount' as const },
                    { label: '📱 (COBRAR) Pix', field: 'pix_amount' as const },
                  ].map(({ label, field }) => (
                    <div key={field} className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">{label}</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r[field] || ''}
                        onChange={(e) => updateField(r.id, field, parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs font-mono"
                        placeholder="0,00"
                        disabled={isCompleted}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Totals */}
            <div className="border border-border rounded-lg p-3 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground">Totais via Maquininha</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowByDriver(true)}>
                  <Eye className="h-3 w-3 mr-1" />
                  Ver por entregador
                </Button>
              </div>
              <div className="grid grid-cols-5 gap-3">
                {[
                  { label: 'Débito', value: totals.debit },
                  { label: 'Crédito', value: totals.credit },
                  { label: 'Voucher', value: totals.voucher },
                  { label: '(COBRAR) Pix', value: totals.pix },
                  { label: 'Total Geral', value: totalGeral },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                    <div className={`text-sm font-bold font-mono ${label === 'Total Geral' ? 'text-primary' : 'text-foreground'}`}>
                      {formatCurrency(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* By Driver Dialog */}
      <Dialog open={showByDriver} onOpenChange={setShowByDriver}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Totais por Entregador</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {byDriver.map(([name, vals]) => (
              <div key={name} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">{name}</span>
                  <span className="text-xs text-muted-foreground">{vals.count} maquininha(s)</span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {[
                    { label: 'Débito', value: vals.debit },
                    { label: 'Crédito', value: vals.credit },
                    { label: 'Voucher', value: vals.voucher },
                    { label: 'Pix', value: vals.pix },
                    { label: 'Total', value: vals.debit + vals.credit + vals.voucher + vals.pix },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      <div className="text-xs font-bold font-mono text-foreground">{formatCurrency(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {byDriver.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma maquininha cadastrada.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
