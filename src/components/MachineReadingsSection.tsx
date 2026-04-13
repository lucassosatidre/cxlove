import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMachineRegistry } from '@/hooks/useMachineRegistry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreditCard, Plus, Trash2, Eye, ChevronDown, ChevronRight, AlertCircle, QrCode, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import SerialAutocomplete from '@/components/SerialAutocomplete';
import PersonAutocomplete from '@/components/PersonAutocomplete';

interface SerialSuggestion {
  serial: string;
  count: number;
  lastUsed: string | null;
}

interface MachineReading {
  id: string;
  machine_serial: string;
  delivery_person: string;
  debit_amount: number;
  credit_amount: number;
  voucher_amount: number;
  pix_amount: number;
  debit_count: number;
  credit_count: number;
  voucher_count: number;
  pix_count: number;
}

interface Props {
  dailyClosingId?: string;
  salonClosingId?: string;
  deliveryPersons: string[];
  isCompleted: boolean;
  /** Label for the person field: "Entregador" or "Garçom" */
  personLabel?: string;
  /** Render mode: 'all' (default), 'totals' (only summary), 'conference' (only detail) */
  mode?: 'all' | 'totals' | 'conference';
  /** Called when readings count changes */
  onCountChange?: (count: number) => void;
}

const SERIAL_PREFIX = 'S1F2-000';

const PAYMENT_FIELDS = [
  { label: '💳 Débito', amountField: 'debit_amount' as const, countField: 'debit_count' as const },
  { label: '💳 Crédito', amountField: 'credit_amount' as const, countField: 'credit_count' as const },
  { label: '🎟️ Voucher', amountField: 'voucher_amount' as const, countField: 'voucher_count' as const },
  { label: '📱 (COBRAR) Pix', amountField: 'pix_amount' as const, countField: 'pix_count' as const },
];

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseRow(r: any): MachineReading {
  return {
    ...r,
    debit_amount: Number(r.debit_amount),
    credit_amount: Number(r.credit_amount),
    voucher_amount: Number(r.voucher_amount),
    pix_amount: Number(r.pix_amount),
    debit_count: Number(r.debit_count) || 0,
    credit_count: Number(r.credit_count) || 0,
    voucher_count: Number(r.voucher_count) || 0,
    pix_count: Number(r.pix_count) || 0,
  };
}

export default function MachineReadingsSection({ dailyClosingId, salonClosingId, deliveryPersons, isCompleted, personLabel = 'Entregador', mode = 'all', onCountChange }: Props) {
  const { user } = useAuth();
  const { registry, getFriendlyName } = useMachineRegistry();
  const [readings, setReadings] = useState<MachineReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [showByDriver, setShowByDriver] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [conferenceCollapsed, setConferenceCollapsed] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [serialSuggestions, setSerialSuggestions] = useState<SerialSuggestion[]>([]);
  const [confirmedDriverNames, setConfirmedDriverNames] = useState<string[]>([]);
  const saveTimers = useState<Record<string, ReturnType<typeof setTimeout>>>({})[0];

  const closingId = dailyClosingId || salonClosingId || '';
  const closingField = dailyClosingId ? 'daily_closing_id' : 'salon_closing_id';

  useEffect(() => {
    loadReadings();
    loadSerialSuggestions();
    loadConfirmedDrivers();
    return () => { Object.values(saveTimers).forEach(clearTimeout); };
  }, [closingId]);

  useEffect(() => {
    onCountChange?.(readings.length);
  }, [readings.length, onCountChange]);

  const SELECT_COLS = 'id, machine_serial, delivery_person, debit_amount, credit_amount, voucher_amount, pix_amount, debit_count, credit_count, voucher_count, pix_count';

  const loadReadings = async () => {
    if (!closingId) { setLoading(false); return; }
    const { data } = await supabase
      .from('machine_readings')
      .select(SELECT_COLS)
      .eq(closingField, closingId)
      .order('created_at', { ascending: true });
    setReadings((data || []).map(parseRow));
    setLoading(false);
  };

  const loadSerialSuggestions = async () => {
    const filterField = dailyClosingId ? 'daily_closing_id' : 'salon_closing_id';
    const { data } = await supabase
      .from('machine_readings')
      .select('machine_serial, created_at')
      .not('machine_serial', 'eq', '')
      .not(filterField, 'is', null);
    if (!data) return;
    const map: Record<string, { count: number; lastUsed: string | null }> = {};
    for (const row of data) {
      const s = row.machine_serial;
      if (!s) continue;
      if (!map[s]) map[s] = { count: 0, lastUsed: null };
      map[s].count++;
      if (!map[s].lastUsed || row.created_at > map[s].lastUsed!) map[s].lastUsed = row.created_at;
    }
    setSerialSuggestions(
      Object.entries(map).map(([serial, v]) => ({ serial, count: v.count, lastUsed: v.lastUsed }))
    );
  };

  const loadConfirmedDrivers = async () => {
    const now = new Date();
    const brDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const brHour = brDate.getHours();
    if (brHour < 3) brDate.setDate(brDate.getDate() - 1);
    const dateStr = `${brDate.getFullYear()}-${String(brDate.getMonth() + 1).padStart(2, '0')}-${String(brDate.getDate()).padStart(2, '0')}`;
    const { data: shifts } = await supabase.from('delivery_shifts').select('id').eq('data', dateStr);
    if (!shifts || shifts.length === 0) return;
    const shiftIds = shifts.map(s => s.id);
    const { data: checkins } = await supabase.from('delivery_checkins').select('driver_id').in('shift_id', shiftIds).in('status', ['confirmado', 'concluido']);
    if (!checkins || checkins.length === 0) return;
    const driverIds = [...new Set(checkins.map(c => c.driver_id))];
    const { data: drivers } = await supabase.from('delivery_drivers').select('nome').in('id', driverIds).order('nome');
    if (drivers) {
      const names = [...new Set(drivers.map(d => d.nome.split(' ')[0]))].sort();
      setConfirmedDriverNames(names);
    }
  };

  const addReading = async () => {
    if (!user || !closingId) return;
    if (readings.length > 0) {
      const last = readings[readings.length - 1];
      if (!last.machine_serial.trim() || !last.delivery_person.trim()) {
        setValidationError(`Preencha o S/N e o ${personLabel.toLowerCase()} antes de adicionar uma nova maquininha`);
        return;
      }
      for (const pf of PAYMENT_FIELDS) {
        if (last[pf.amountField] > 0 && last[pf.countField] < 1) {
          setValidationError(`Informe a quantidade de operações de ${pf.label.replace(/^[^\s]+\s/, '')} antes de adicionar`);
          return;
        }
      }
    }
    setValidationError('');
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      machine_serial: '',
      delivery_person: '',
      [closingField]: closingId,
    };
    const { data, error } = await supabase
      .from('machine_readings')
      .insert(insertData as any)
      .select(SELECT_COLS)
      .single();
    if (error) { toast.error('Erro ao adicionar maquininha'); return; }
    if (data) {
      setReadings(prev => [...prev, parseRow(data)]);
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
      const { error } = await supabase.from('machine_readings').update(updateData as any).eq('id', id);
      if (error) toast.error('Erro ao salvar');
    }, 600);
  }, []);

  const updateField = (id: string, field: keyof MachineReading, value: string | number) => {
    setReadings(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      for (const pf of PAYMENT_FIELDS) {
        if (field === pf.amountField && (value === 0 || value === '')) {
          updated[pf.countField] = 0;
          debouncedSave(id, pf.countField, 0);
        }
      }
      return updated;
    }));
    debouncedSave(id, field, value);
  };

  const totals = useMemo(() => {
    return readings.reduce((acc, r) => ({
      debit: acc.debit + r.debit_amount,
      credit: acc.credit + r.credit_amount,
      voucher: acc.voucher + r.voucher_amount,
      pix: acc.pix + r.pix_amount,
      debitCount: acc.debitCount + r.debit_count,
      creditCount: acc.creditCount + r.credit_count,
      voucherCount: acc.voucherCount + r.voucher_count,
      pixCount: acc.pixCount + r.pix_count,
    }), { debit: 0, credit: 0, voucher: 0, pix: 0, debitCount: 0, creditCount: 0, voucherCount: 0, pixCount: 0 });
  }, [readings]);

  const totalGeral = totals.debit + totals.credit + totals.voucher + totals.pix;
  const totalCountGeral = totals.debitCount + totals.creditCount + totals.voucherCount + totals.pixCount;

  const noPersonLabel = `Sem ${personLabel.toLowerCase()}`;

  const byDriver = useMemo(() => {
    const map: Record<string, { debit: number; credit: number; voucher: number; pix: number; debitCount: number; creditCount: number; voucherCount: number; pixCount: number; count: number }> = {};
    for (const r of readings) {
      const name = r.delivery_person || noPersonLabel;
      if (!map[name]) map[name] = { debit: 0, credit: 0, voucher: 0, pix: 0, debitCount: 0, creditCount: 0, voucherCount: 0, pixCount: 0, count: 0 };
      map[name].debit += r.debit_amount;
      map[name].credit += r.credit_amount;
      map[name].voucher += r.voucher_amount;
      map[name].pix += r.pix_amount;
      map[name].debitCount += r.debit_count;
      map[name].creditCount += r.credit_count;
      map[name].voucherCount += r.voucher_count;
      map[name].pixCount += r.pix_count;
      map[name].count++;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [readings]);

  if (loading) return null;

  const blockTotal = (r: MachineReading) => r.debit_amount + r.credit_amount + r.voucher_amount + r.pix_amount;
  const blockOps = (r: MachineReading) => r.debit_count + r.credit_count + r.voucher_count + r.pix_count;

  const showTotals = mode === 'all' || mode === 'totals';
  const showConference = mode === 'all' || mode === 'conference';

  return (
    <>
      {/* Totals panel - shown in 'all' or 'totals' mode */}
      {showTotals && readings.length > 0 && (
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Recebido via Maquininhas</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowByDriver(true)}>
                <Eye className="h-3 w-3 mr-1" />
                Ver por {personLabel.toLowerCase()}
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                { label: '(COBRAR) Pix', value: totals.pix, count: totals.pixCount, icon: <QrCode className="h-4 w-4 text-primary" /> },
                { label: 'Crédito', value: totals.credit, count: totals.creditCount, icon: <CreditCard className="h-4 w-4 text-accent-foreground" /> },
                { label: 'Débito', value: totals.debit, count: totals.debitCount, icon: <CreditCard className="h-4 w-4 text-muted-foreground" /> },
                { label: 'Voucher', value: totals.voucher, count: totals.voucherCount, icon: <CreditCard className="h-4 w-4 text-warning" /> },
              ].map(({ label, value, count, icon }) => (
                <div key={label} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[150px]">
                  {icon}
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{label} ({count} {count === 1 ? 'op' : 'ops'})</p>
                    <p className="text-sm font-semibold text-foreground font-mono">{formatCurrency(value)}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2 border border-primary/30 min-w-[150px]">
                <Wallet className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-[10px] text-primary font-semibold leading-tight">Total Geral ({totalCountGeral} ops)</p>
                  <p className="text-sm font-bold text-primary font-mono">{formatCurrency(totalGeral)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conference detail - shown in 'all' or 'conference' mode */}
      {showConference && (
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            {/* Collapsible header */}
            <div className="flex items-center justify-between">
              <div
                className="flex items-center gap-2 cursor-pointer select-none flex-1"
                onClick={() => setConferenceCollapsed(prev => !prev)}
              >
                {conferenceCollapsed
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <CreditCard className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Conferência de Maquininhas
                </span>
                {readings.length > 0 && (
                  <span className="text-xs text-muted-foreground">({readings.length})</span>
                )}
                {conferenceCollapsed && readings.length > 0 && (
                  <span className="ml-auto text-sm font-bold font-mono text-foreground mr-3">
                    {formatCurrency(totalGeral)}
                  </span>
                )}
              </div>
              {!isCompleted && (
                <div className="flex items-center gap-2 shrink-0">
                  {validationError && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {validationError}
                    </span>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => {
                    e.stopPropagation();
                    setConferenceCollapsed(false);
                    addReading();
                  }}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Adicionar Maquininha
                  </Button>
                </div>
              )}
            </div>

            {/* Collapsible content */}
            {!conferenceCollapsed && (
              <div className="mt-3">
                {readings.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma maquininha adicionada.</p>
                ) : (
                  <div className="space-y-2">
                    {readings.map((r) => {
                      const isFilled = r.machine_serial.trim() && r.delivery_person.trim();
                      const isExpanded = expandedIds.has(r.id) || !isFilled;
                      const toggleExpand = () => {
                        if (!isFilled) return;
                        setExpandedIds(prev => {
                          const next = new Set(prev);
                          next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                          return next;
                        });
                      };

                      return (
                        <div key={r.id} className="border border-border rounded-lg bg-muted/30">
                          <div
                            className={`flex items-center gap-2 px-3 py-2 ${isFilled ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                            onClick={isFilled ? toggleExpand : undefined}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            }
                            {getFriendlyName(r.machine_serial) ? (
                              <span className="text-xs font-semibold text-foreground">{getFriendlyName(r.machine_serial)}</span>
                            ) : (
                              <span className="text-xs font-mono text-muted-foreground">{SERIAL_PREFIX}{r.machine_serial || '---'}</span>
                            )}
                            {getFriendlyName(r.machine_serial) && (
                              <span className="text-[10px] font-mono text-muted-foreground">({r.machine_serial})</span>
                            )}
                            <span className="ml-auto text-xs font-bold font-mono text-foreground">
                              {formatCurrency(blockTotal(r))}
                              {blockOps(r) > 0 && (
                                <span className="font-normal text-muted-foreground ml-1">({blockOps(r)} op.)</span>
                              )}
                            </span>
                            {!isCompleted && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive shrink-0"
                                onClick={(e) => { e.stopPropagation(); removeReading(r.id); }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>

                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2 border-t border-border">
                              <div className="flex items-center gap-2 pt-2">
                                <div className="flex-1 flex items-center gap-2">
                                  <label className="text-xs text-muted-foreground whitespace-nowrap">🔢 S/N</label>
                                  <div className="flex items-center gap-0">
                                    <span className="text-xs font-mono bg-muted px-2 py-1.5 rounded-l-md border border-r-0 border-input text-muted-foreground">
                                      {SERIAL_PREFIX}
                                    </span>
                                    <SerialAutocomplete
                                      value={r.machine_serial}
                                      onChange={(v) => updateField(r.id, 'machine_serial', v)}
                                      suggestions={serialSuggestions}
                                      className="h-8 text-xs w-24 rounded-l-none font-mono"
                                      placeholder="000"
                                      disabled={isCompleted}
                                    />
                                  </div>
                                </div>
                                <div className="flex-1 flex items-center gap-2">
                                  <label className="text-xs text-muted-foreground whitespace-nowrap">👤 {personLabel}</label>
                                  <PersonAutocomplete
                                    value={r.delivery_person}
                                    onChange={(v) => updateField(r.id, 'delivery_person', v)}
                                    suggestions={confirmedDriverNames.length > 0 ? confirmedDriverNames : deliveryPersons}
                                    className="h-8 text-xs flex-1"
                                    placeholder={`Nome do ${personLabel.toLowerCase()}...`}
                                    disabled={isCompleted}
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                {PAYMENT_FIELDS.map(({ label, amountField, countField }) => {
                                  const amountVal = r[amountField];
                                  const countDisabled = isCompleted || amountVal === 0;
                                  const countMissing = amountVal > 0 && r[countField] < 1;
                                  return (
                                    <div key={amountField} className="space-y-1">
                                      <label className="text-[10px] text-muted-foreground">{label}</label>
                                      <div className="flex gap-1">
                                        <Input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={amountVal || ''}
                                          onChange={(e) => updateField(r.id, amountField, parseFloat(e.target.value) || 0)}
                                          className="h-8 text-xs font-mono flex-1"
                                          placeholder="0,00"
                                          disabled={isCompleted}
                                        />
                                        <Input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={r[countField] || ''}
                                          onChange={(e) => updateField(r.id, countField, parseInt(e.target.value) || 0)}
                                          className={`h-8 text-xs font-mono w-14 text-center ${countMissing ? 'border-destructive ring-1 ring-destructive' : ''}`}
                                          placeholder="Qtd"
                                          disabled={countDisabled}
                                          title="Qtd operações"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* By Person Dialog */}
      <Dialog open={showByDriver} onOpenChange={setShowByDriver}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Totais por {personLabel}</DialogTitle>
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
                    { label: 'Débito', value: vals.debit, count: vals.debitCount },
                    { label: 'Crédito', value: vals.credit, count: vals.creditCount },
                    { label: 'Voucher', value: vals.voucher, count: vals.voucherCount },
                    { label: 'Pix', value: vals.pix, count: vals.pixCount },
                    { label: 'Total', value: vals.debit + vals.credit + vals.voucher + vals.pix, count: vals.debitCount + vals.creditCount + vals.voucherCount + vals.pixCount },
                  ].map(({ label, value, count }) => (
                    <div key={label}>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      <div className="text-xs font-bold font-mono text-foreground">{formatCurrency(value)}</div>
                      <div className="text-[10px] text-muted-foreground">{count} op.</div>
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
    </>
  );
}
