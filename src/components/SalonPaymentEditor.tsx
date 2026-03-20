import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OFFLINE_METHODS = [
  'Crédito',
  'Débito',
  '(COBRAR) Pix',
  'Dinheiro',
  'Voucher',
  '(PAGO) Pix Banco do Brasil',
  'Sob Demanda Ifood',
  'Pagamento não cadastrado',
];

interface PaymentEntry {
  id?: string;
  payment_method: string;
  amount: number;
}

interface Props {
  orderId: string;
  totalAmount: number;
  payments: PaymentEntry[];
  onPaymentsChanged: (payments: PaymentEntry[]) => void;
}

export default function SalonPaymentEditor({ orderId, totalAmount, payments, onPaymentsChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [editingValues, setEditingValues] = useState<Record<number, string>>({});

  // Auto-show first empty row for pending orders
  const effectivePayments = payments.length === 0 ? [{ payment_method: '', amount: 0 }] : payments;

  // Sync the auto-created row to parent if needed
  const ensurePayments = useCallback(() => {
    if (payments.length === 0) {
      onPaymentsChanged([{ payment_method: '', amount: 0 }]);
    }
  }, [payments, onPaymentsChanged]);

  const addPayment = useCallback(() => {
    ensurePayments();
    onPaymentsChanged([...effectivePayments, { payment_method: '', amount: 0 }]);
  }, [effectivePayments, onPaymentsChanged, ensurePayments]);

  const removePayment = useCallback((index: number) => {
    const updated = effectivePayments.filter((_, i) => i !== index);
    onPaymentsChanged(updated);
    setEditingValues(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }, [effectivePayments, onPaymentsChanged]);

  const doSave = useCallback(async (paymentsList: PaymentEntry[]) => {
    setSaving(true);
    await supabase.from('salon_order_payments').delete().eq('salon_order_id', orderId);
    const inserts = paymentsList.map(p => ({
      salon_order_id: orderId,
      payment_method: p.payment_method,
      amount: p.amount,
    }));
    const { error } = await supabase.from('salon_order_payments').insert(inserts);
    if (error) {
      toast.error('Erro ao salvar pagamentos.');
    } else {
      toast.success('Pagamentos salvos!');
      const { data } = await supabase
        .from('salon_order_payments')
        .select('*')
        .eq('salon_order_id', orderId);
      if (data) {
        onPaymentsChanged(data.map(d => ({
          id: d.id,
          payment_method: d.payment_method,
          amount: Number(d.amount),
        })));
      }
    }
    setSaving(false);
  }, [orderId, onPaymentsChanged]);

  const updatePayment = useCallback((index: number, field: 'payment_method' | 'amount', value: string | number) => {
    const updated = [...effectivePayments];
    updated[index] = { ...updated[index], [field]: value };
    onPaymentsChanged(updated);

    // Auto-save when changing payment method if sum already matches total
    if (field === 'payment_method') {
      const currentSum = updated.reduce((acc, p) => acc + p.amount, 0);
      const currentDiff = Math.round((totalAmount - currentSum) * 100) / 100;
      if (Math.abs(currentDiff) < 0.01 && updated.every(p => p.payment_method && p.amount > 0)) {
        doSave(updated);
      }
    }

    return updated;
  }, [effectivePayments, onPaymentsChanged, totalAmount, doSave]);

  const handleAmountChange = useCallback((index: number, rawValue: string) => {
    setEditingValues(prev => ({ ...prev, [index]: rawValue }));
  }, []);

  const commitAmount = useCallback((index: number) => {
    const raw = editingValues[index];
    if (raw === undefined) return;

    const cleaned = raw.replace(/[^\d.,]/g, '').replace(',', '.');
    const num = Math.round(Math.max(0, parseFloat(cleaned) || 0) * 100) / 100;
    const updated = updatePayment(index, 'amount', num);
    setEditingValues(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    if (!updated) return;

    const newSum = updated.reduce((acc, p) => acc + p.amount, 0);
    const newDiff = Math.round((totalAmount - newSum) * 100) / 100;

    // Auto-save if sum matches total and all entries are valid
    if (Math.abs(newDiff) < 0.01 && updated.every(p => p.payment_method && p.amount > 0)) {
      doSave(updated);
    }
    // Auto-add new row if there's remaining difference and current entry is filled
    else if (newDiff > 0.01 && updated[index]?.payment_method && num > 0) {
      onPaymentsChanged([...updated, { payment_method: '', amount: 0 }]);
    }
  }, [editingValues, updatePayment, totalAmount, doSave, onPaymentsChanged]);

  const sum = effectivePayments.reduce((acc, p) => acc + p.amount, 0);
  const diff = Math.round((totalAmount - sum) * 100) / 100;
  const isValid = effectivePayments.length > 0 && effectivePayments.every(p => p.payment_method && p.amount > 0) && Math.abs(diff) < 0.01;

  const savePayments = useCallback(async () => {
    if (!isValid) {
      toast.error('Preencha todos os campos e confira que a soma bate com o total.');
      return;
    }
    doSave(effectivePayments);
  }, [effectivePayments, isValid, doSave]);

  const getDisplayValue = (index: number, amount: number) => {
    if (editingValues[index] !== undefined) return editingValues[index];
    return amount > 0 ? amount.toFixed(2).replace('.', ',') : '';
  };

  return (
    <div className="space-y-1.5">
      {effectivePayments.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <Select
            value={entry.payment_method}
            onValueChange={(v) => updatePayment(idx, 'payment_method', v)}
          >
            <SelectTrigger className="h-7 text-[11px] flex-1 min-w-[120px]">
              <SelectValue placeholder="Forma de pagamento" />
            </SelectTrigger>
            <SelectContent>
              {OFFLINE_METHODS.map(m => (
                <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="R$ 0,00"
            className="h-7 w-20 text-right text-[11px] font-mono tabular-nums"
            value={getDisplayValue(idx, entry.amount)}
            onChange={(e) => handleAmountChange(idx, e.target.value)}
            onBlur={() => commitAmount(idx)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitAmount(idx); }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => removePayment(idx)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}

      {effectivePayments.length > 1 || (effectivePayments.length === 1 && effectivePayments[0].payment_method) ? (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={addPayment}>
            <Plus className="h-2.5 w-2.5" />
            Adicionar
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {sum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
            {Math.abs(diff) >= 0.01 && (
              <span className="text-[10px] text-destructive font-medium">
                Dif: {Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            )}
            <Button
              variant="default"
              size="sm"
              className="h-6 text-[10px] gap-1 px-2"
              onClick={savePayments}
              disabled={!isValid || saving}
            >
              <Save className="h-2.5 w-2.5" />
              {saving ? '...' : 'Salvar'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
