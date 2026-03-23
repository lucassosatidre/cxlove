import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.25, 0.10, 0.05];

const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface VaultCashCalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialCounts?: Record<string, number>;
  onSave: (counts: Record<string, number>, total: number) => void;
}

export default function VaultCashCalculator({ open, onOpenChange, title, initialCounts, onSave }: VaultCashCalculatorProps) {
  const [counts, setCounts] = useState<Record<number, number>>({});

  const total = useMemo(
    () => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (counts[d] || 0), 0),
    [counts]
  );

  // Load initial counts when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v && initialCounts) {
      const parsed: Record<number, number> = {};
      Object.entries(initialCounts).forEach(([k, val]) => {
        parsed[parseFloat(k)] = val;
      });
      setCounts(parsed);
    } else if (v) {
      setCounts({});
    }
    onOpenChange(v);
  };

  const handleSave = () => {
    const stringCounts: Record<string, number> = {};
    CASH_DENOMINATIONS.forEach(d => {
      if (counts[d]) stringCounts[String(d)] = counts[d];
    });
    onSave(stringCounts, total);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-[1fr_80px_1fr] gap-2 text-xs font-semibold text-muted-foreground px-1">
            <span>Cédula/Moeda</span><span className="text-center">Qtd</span><span className="text-right">Subtotal</span>
          </div>
          {CASH_DENOMINATIONS.map(denom => (
            <div key={denom} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center">
              <span className="text-sm font-medium text-foreground">{formatCurrency(denom)}</span>
              <Input
                type="number"
                min={0}
                className="h-8 text-center"
                value={counts[denom] || ''}
                onChange={e => setCounts(prev => ({ ...prev, [denom]: parseInt(e.target.value) || 0 }))}
              />
              <span className="text-sm text-right text-muted-foreground">{formatCurrency(denom * (counts[denom] || 0))}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="font-semibold text-sm">Total:</span>
          <span className="text-lg font-bold text-primary">{formatCurrency(total)}</span>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setCounts({})}>Limpar</Button>
          <Button onClick={handleSave}>Salvar Contagem</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Detail view component for vault balance
interface VaultBalanceDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: number;
  entryCounts?: Record<string, number> | null;
}

export function VaultBalanceDetail({ open, onOpenChange, balance, entryCounts }: VaultBalanceDetailProps) {
  const hasCounts = entryCounts && Object.keys(entryCounts).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalhes do Saldo do Cofre</DialogTitle>
        </DialogHeader>
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">Saldo Atual</p>
          <p className={`text-3xl font-bold ${balance >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
            {formatCurrency(balance)}
          </p>
        </div>
        {hasCounts ? (
          <div className="space-y-1 border rounded-lg p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Composição da última entrada</p>
            <div className="grid grid-cols-[1fr_40px_1fr] gap-1 text-xs font-semibold text-muted-foreground">
              <span>Cédula</span><span className="text-center">Qtd</span><span className="text-right">Subtotal</span>
            </div>
            {CASH_DENOMINATIONS.filter(d => (entryCounts![String(d)] || 0) > 0).map(d => (
              <div key={d} className="grid grid-cols-[1fr_40px_1fr] gap-1 items-center text-sm">
                <span>{formatCurrency(d)}</span>
                <span className="text-center font-medium">{entryCounts![String(d)]}</span>
                <span className="text-right">{formatCurrency(d * entryCounts![String(d)])}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t mt-2 font-semibold text-sm">
              <span>Total contado:</span>
              <span className="text-primary">
                {formatCurrency(CASH_DENOMINATIONS.reduce((s, d) => s + d * (entryCounts![String(d)] || 0), 0))}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground py-4">Contagem detalhada não disponível</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
