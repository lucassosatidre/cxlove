import { useState, useCallback } from 'react';
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

  const addPayment = useCallback(() => {
    onPaymentsChanged([...payments, { payment_method: '', amount: 0 }]);
  }, [payments, onPaymentsChanged]);

  const removePayment = useCallback((index: number) => {
    const updated = payments.filter((_, i) => i !== index);
    onPaymentsChanged(updated);
  }, [payments, onPaymentsChanged]);

  const updatePayment = useCallback((index: number, field: 'payment_method' | 'amount', value: string | number) => {
    const updated = [...payments];
    updated[index] = { ...updated[index], [field]: value };
    onPaymentsChanged(updated);
  }, [payments, onPaymentsChanged]);

  const sum = payments.reduce((acc, p) => acc + p.amount, 0);
  const diff = Math.round((totalAmount - sum) * 100) / 100;
  const isValid = payments.length > 0 && payments.every(p => p.payment_method && p.amount > 0) && Math.abs(diff) < 0.01;

  const savePayments = useCallback(async () => {
    if (!isValid) {
      toast.error('Preencha todos os campos e confira que a soma bate com o total.');
      return;
    }
    setSaving(true);

    await supabase.from('salon_order_payments').delete().eq('salon_order_id', orderId);

    const inserts = payments.map(p => ({
      salon_order_id: orderId,
      payment_method: p.payment_method,
      amount: p.amount,
    }));

    const { error } = await supabase.from('salon_order_payments').insert(inserts);
    if (error) {
      toast.error('Erro ao salvar pagamentos.');
    } else {
      toast.success('Pagamentos salvos!');
      // Reload saved data with IDs
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
  }, [orderId, payments, isValid, onPaymentsChanged]);

  return (
    <div className="space-y-2">
      {payments.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Select
            value={entry.payment_method}
            onValueChange={(v) => updatePayment(idx, 'payment_method', v)}
          >
            <SelectTrigger className="h-8 text-xs flex-1 min-w-[140px]">
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
            className="h-8 w-24 text-right text-xs font-mono tabular-nums"
            value={entry.amount > 0 ? entry.amount.toFixed(2).replace('.', ',') : ''}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
              const num = parseFloat(cleaned) || 0;
              updatePayment(idx, 'amount', Math.round(Math.max(0, num) * 100) / 100);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => removePayment(idx)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addPayment}>
          <Plus className="h-3 w-3" />
          Adicionar
        </Button>

        {payments.length > 0 && (
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
              className="h-7 text-xs gap-1"
              onClick={savePayments}
              disabled={!isValid || saving}
            >
              <Save className="h-3 w-3" />
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
