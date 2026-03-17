import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, Wifi, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import {
  splitPaymentMethods,
  classifyPaymentType,
  getBreakdownScenario,
  formatCurrency,
  type BreakdownScenario,
} from '@/lib/payment-utils';

interface BreakdownRow {
  id?: string;
  payment_method_name: string;
  payment_type: 'online' | 'fisico';
  amount: number;
  is_auto_calculated: boolean;
}

interface Props {
  orderId: string;
  paymentMethod: string;
  totalAmount: number;
  isCompleted: boolean;
  onBreakdownValid: (valid: boolean) => void;
}

export default function PaymentBreakdown({ orderId, paymentMethod, totalAmount, isCompleted, onBreakdownValid }: Props) {
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const methods = useMemo(() => splitPaymentMethods(paymentMethod), [paymentMethod]);
  const scenario = useMemo(() => getBreakdownScenario(methods), [methods]);

  // Load existing breakdowns
  useEffect(() => {
    loadBreakdowns();
  }, [orderId]);

  const loadBreakdowns = async () => {
    const { data } = await supabase
      .from('order_payment_breakdowns')
      .select('*')
      .eq('imported_order_id', orderId);

    if (data && data.length > 0) {
      setRows(data.map(d => ({
        id: d.id,
        payment_method_name: d.payment_method_name,
        payment_type: d.payment_type as 'online' | 'fisico',
        amount: Number(d.amount),
        is_auto_calculated: d.is_auto_calculated,
      })));
    } else {
      // Initialize from payment method string
      const initial: BreakdownRow[] = methods.map(m => ({
        payment_method_name: m,
        payment_type: classifyPaymentType(m),
        amount: 0,
        is_auto_calculated: false,
      }));

      // For 1 physical + 1 online, mark online as auto
      if (scenario === 'one_physical_one_online') {
        const onlineIdx = initial.findIndex(r => r.payment_type === 'online');
        if (onlineIdx >= 0) {
          initial[onlineIdx].is_auto_calculated = true;
        }
      }
      setRows(initial);
    }
    setLoading(false);
  };

  const sum = useMemo(() => rows.reduce((acc, r) => acc + r.amount, 0), [rows]);
  const diff = useMemo(() => Math.round((totalAmount - sum) * 100) / 100, [totalAmount, sum]);
  const isValid = useMemo(() => Math.abs(diff) < 0.01, [diff]);

  // Notify parent about validity
  useEffect(() => {
    onBreakdownValid(isValid);
  }, [isValid, onBreakdownValid]);

  const handleAmountChange = useCallback((index: number, value: string) => {
    const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
    const numVal = parseFloat(cleaned) || 0;
    const amount = Math.round(Math.max(0, numVal) * 100) / 100;

    setRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], amount };

      // Auto-calculate for 1 physical + 1 online scenario
      if (scenario === 'one_physical_one_online' && next[index].payment_type === 'fisico') {
        const onlineIdx = next.findIndex(r => r.payment_type === 'online');
        if (onlineIdx >= 0) {
          const autoVal = Math.round((totalAmount - amount) * 100) / 100;
          next[onlineIdx] = { ...next[onlineIdx], amount: Math.max(0, autoVal), is_auto_calculated: true };
        }
      }

      return next;
    });
  }, [scenario, totalAmount]);

  const saveBreakdowns = useCallback(async () => {
    if (!isValid) {
      toast.error('A soma dos valores não corresponde ao total do pedido.');
      return;
    }

    setSaving(true);

    // Delete existing breakdowns for this order
    await supabase
      .from('order_payment_breakdowns')
      .delete()
      .eq('imported_order_id', orderId);

    // Insert new ones
    const inserts = rows.map(r => ({
      imported_order_id: orderId,
      payment_method_name: r.payment_method_name,
      payment_type: r.payment_type,
      amount: r.amount,
      is_auto_calculated: r.is_auto_calculated,
    }));

    const { error } = await supabase
      .from('order_payment_breakdowns')
      .insert(inserts);

    if (error) {
      toast.error('Erro ao salvar detalhamento.');
    } else {
      toast.success('Detalhamento salvo com sucesso!');
    }
    setSaving(false);
  }, [orderId, rows, isValid]);

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="bg-secondary/50 border-t border-border px-4 py-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Detalhamento por forma de pagamento
      </div>

      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-3 bg-card rounded-lg p-3 border border-border">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {row.payment_type === 'online' ? (
                <Wifi className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <CreditCard className="h-3.5 w-3.5 text-foreground shrink-0" />
              )}
              <span className="text-sm font-medium text-foreground truncate">{row.payment_method_name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                row.payment_type === 'online'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {row.payment_type === 'online' ? 'Online' : 'Físico'}
              </span>
            </div>
            <div className="w-32 shrink-0">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="R$ 0,00"
                className="h-8 text-right font-mono-tabular text-sm"
                value={row.amount > 0 ? row.amount.toFixed(2).replace('.', ',') : ''}
                onChange={(e) => handleAmountChange(idx, e.target.value)}
                disabled={isCompleted || (row.is_auto_calculated && scenario === 'one_physical_one_online')}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Sum and diff info */}
      <div className="flex items-center justify-between text-sm pt-1">
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground">
            Soma: <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(sum)}</span>
          </span>
          <span className="text-muted-foreground">
            Total: <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(totalAmount)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isValid ? (
            <span className="flex items-center gap-1 text-success text-xs font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Rateio correto
            </span>
          ) : (
            <span className="flex items-center gap-1 text-destructive text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Diferença: {formatCurrency(Math.abs(diff))}
            </span>
          )}
        </div>
      </div>

      {!isCompleted && (
        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={saveBreakdowns}
            disabled={!isValid || saving}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            {saving ? 'Salvando...' : 'Salvar Detalhamento'}
          </Button>
        </div>
      )}
    </div>
  );
}
