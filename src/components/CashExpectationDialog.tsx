import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calculator, CalendarDays, Save, Trash2, Store, Bike } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/payment-utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.25, 0.10, 0.05];

interface CashExpectationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export default function CashExpectationDialog({ open, onOpenChange, onSaved }: CashExpectationDialogProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<'sector' | 'date' | 'calculator'>('sector');
  const [selectedSector, setSelectedSector] = useState<'tele' | 'salao' | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const total = useMemo(
    () => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (counts[d] || 0), 0),
    [counts]
  );

  // Reset when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setStep('sector');
      setSelectedSector(null);
      setSelectedDate(undefined);
      setCounts({});
      setExistingId(null);
    }
  }, [open]);

  const handleSectorSelect = (sector: 'tele' | 'salao') => {
    setSelectedSector(sector);
    setStep('date');
  };

  // Load existing expectation when date is selected
  const handleDateSelect = async (date: Date | undefined) => {
    setSelectedDate(date);
    setDatePickerOpen(false);
    if (!date || !selectedSector) return;

    setLoading(true);
    const dateStr = format(date, 'yyyy-MM-dd');
    const { data } = await supabase
      .from('cash_expectations')
      .select('*')
      .eq('closing_date', dateStr)
      .eq('sector', selectedSector)
      .maybeSingle();

    if (data) {
      setExistingId(data.id);
      const loadedCounts: Record<number, number> = {};
      if (data.counts && typeof data.counts === 'object') {
        for (const [k, v] of Object.entries(data.counts as Record<string, number>)) {
          loadedCounts[parseFloat(k)] = v;
        }
      }
      setCounts(loadedCounts);
    } else {
      setExistingId(null);
      setCounts({});
    }
    setLoading(false);
    setStep('calculator');
  };

  const handleSave = async () => {
    if (!selectedDate || !user || !selectedSector) return;
    setSaving(true);

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      if (Number(v) > 0) countsJson[k] = Number(v);
    }

    if (existingId) {
      const { error } = await supabase
        .from('cash_expectations')
        .update({
          created_by: user.id,
          counts: countsJson,
          total,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId);

      if (error) {
        toast.error('Erro ao salvar valor esperado.');
        console.error(error);
      } else {
        toast.success(`Valor esperado ${selectedSector === 'salao' ? 'Salão' : 'Tele'} salvo para ${format(selectedDate, 'dd/MM/yyyy')}: ${formatCurrency(total)}`);
        onOpenChange(false);
        onSaved?.();
      }
    } else {
      const { error } = await supabase
        .from('cash_expectations')
        .insert({
          closing_date: dateStr,
          created_by: user.id,
          counts: countsJson,
          total,
          sector: selectedSector,
        });

      if (error) {
        toast.error('Erro ao salvar valor esperado.');
        console.error(error);
      } else {
        toast.success(`Valor esperado ${selectedSector === 'salao' ? 'Salão' : 'Tele'} salvo para ${format(selectedDate, 'dd/MM/yyyy')}: ${formatCurrency(total)}`);
        onOpenChange(false);
        onSaved?.();
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!existingId) return;
    const confirmed = window.confirm('Tem certeza que deseja remover o valor esperado deste dia?');
    if (!confirmed) return;

    const { error } = await supabase.from('cash_expectations').delete().eq('id', existingId);
    if (error) {
      toast.error('Erro ao remover.');
    } else {
      toast.success('Valor esperado removido.');
      onOpenChange(false);
      onSaved?.();
    }
  };

  const sectorLabel = selectedSector === 'salao' ? 'Salão' : 'Tele';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            {step === 'sector'
              ? 'Abrir Caixa — Escolha o Setor'
              : step === 'date'
              ? `Abrir Caixa ${sectorLabel} — Escolha a Data`
              : `Valor Esperado ${sectorLabel} — ${selectedDate ? format(selectedDate, 'dd/MM/yyyy') : ''}`}
          </DialogTitle>
        </DialogHeader>

        {step === 'sector' ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Selecione o setor para definir o valor esperado de abertura.
            </p>
            <div className="grid grid-cols-2 gap-4 w-full">
              <Button
                variant="outline"
                className="h-24 flex flex-col items-center gap-2 hover:border-primary hover:bg-primary/5"
                onClick={() => handleSectorSelect('tele')}
              >
                <Bike className="h-8 w-8 text-primary" />
                <span className="font-semibold">Tele</span>
              </Button>
              <Button
                variant="outline"
                className="h-24 flex flex-col items-center gap-2 hover:border-primary hover:bg-primary/5"
                onClick={() => handleSectorSelect('salao')}
              >
                <Store className="h-8 w-8 text-primary" />
                <span className="font-semibold">Salão</span>
              </Button>
            </div>
          </div>
        ) : step === 'date' ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Selecione a data para definir o valor esperado de abertura do caixa {sectorLabel}.
            </p>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Selecionar data...'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  locale={ptBR}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="sm" onClick={() => { setStep('sector'); setSelectedSector(null); }}>
              ← Voltar ao setor
            </Button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              <div className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                <span>Cédula/Moeda</span>
                <span className="text-center">Qtd</span>
                <span className="text-right">Subtotal</span>
              </div>
              {CASH_DENOMINATIONS.map(denom => (
                <div key={denom} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center">
                  <span className="text-sm font-medium text-foreground">{formatCurrency(denom)}</span>
                  <Input
                    type="number"
                    min={0}
                    value={counts[denom] || ''}
                    onChange={(e) => setCounts(prev => ({ ...prev, [denom]: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="h-8 text-center text-sm"
                    placeholder="0"
                  />
                  <span className="text-sm text-right font-mono text-foreground">
                    {formatCurrency(denom * (counts[denom] || 0))}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-3 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Total esperado:</span>
                <span className="text-xl font-bold text-primary font-mono">{formatCurrency(total)}</span>
              </div>
            </div>
            <DialogFooter className="flex gap-2">
              {existingId && (
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remover
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => { setStep('date'); setCounts({}); setExistingId(null); }}>
                Voltar
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />
                {saving ? 'Salvando...' : existingId ? 'Atualizar' : 'Salvar'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
