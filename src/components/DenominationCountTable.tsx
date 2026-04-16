import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';

const DENOMINATIONS = ['200', '100', '50', '20', '10', '5', '2'] as const;
type Denom = typeof DENOMINATIONS[number];

export type DenomCounts = Record<string, number>;

const EMPTY_COUNTS: DenomCounts = { '200': 0, '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '2': 0 };

interface Column {
  key: string;
  label: string;
}

interface Props {
  title: string;
  columns: Column[];
  /** One DenomCounts per column key — values stored in R$ */
  values: Record<string, DenomCounts>;
  onChange: (columnKey: string, denom: string, value: number) => void;
  /** If true, adds a "Total" column that sums all columns per row */
  showTotalColumn?: boolean;
  readOnly?: boolean;
}

export function sumDenomCounts(counts: DenomCounts): number {
  return DENOMINATIONS.reduce((s, d) => s + (counts[d] || 0), 0);
}

export function emptyDenomCounts(): DenomCounts {
  return { ...EMPTY_COUNTS };
}

/** Convert cash_snapshots counts (qty per denom) → R$ per denom */
export function snapshotCountsToReais(counts: Record<string, number>): DenomCounts {
  const result = emptyDenomCounts();
  for (const d of DENOMINATIONS) {
    const qty = counts[d] || counts[Number(d)] || 0;
    result[d] = qty * Number(d);
  }
  return result;
}

export default function DenominationCountTable({ title, columns, values, onChange, showTotalColumn = false, readOnly = false }: Props) {
  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    columns.forEach(col => {
      totals[col.key] = sumDenomCounts(values[col.key] || EMPTY_COUNTS);
    });
    return totals;
  }, [columns, values]);

  const rowTotals = useMemo(() => {
    if (!showTotalColumn) return {};
    const totals: Record<string, number> = {};
    DENOMINATIONS.forEach(d => {
      totals[d] = columns.reduce((s, col) => s + ((values[col.key] || EMPTY_COUNTS)[d] || 0), 0);
    });
    return totals;
  }, [columns, values, showTotalColumn]);

  const grandTotal = useMemo(() => {
    if (!showTotalColumn) return 0;
    return DENOMINATIONS.reduce((s, d) => s + (rowTotals[d] || 0), 0);
  }, [rowTotals, showTotalColumn]);

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const getQty = (reaisValue: number, denom: string): number => {
    const d = Number(denom);
    if (d === 0) return 0;
    return Math.round(reaisValue / d);
  };

  const handleQtyChange = (colKey: string, denom: string, qty: number) => {
    const reais = qty * Number(denom);
    onChange(colKey, denom, reais);
  };

  const handleReaisChange = (colKey: string, denom: string, reais: number) => {
    onChange(colKey, denom, reais);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-24">Denominação</TableHead>
              {columns.map(col => (
                <TableHead key={`qty-${col.key}`} className="text-right text-xs whitespace-nowrap">Qtd {col.label.replace(' (R$)', '')}</TableHead>
              ))}
              {columns.map(col => (
                <TableHead key={`val-${col.key}`} className="text-right text-xs whitespace-nowrap">{col.label}</TableHead>
              ))}
              {showTotalColumn && <TableHead className="text-right">Total (R$)</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {DENOMINATIONS.map(d => {
              const denomValue = Number(d);
              return (
                <TableRow key={d}>
                  <TableCell className="font-medium text-muted-foreground">R$ {d}</TableCell>
                  {/* Qty inputs */}
                  {columns.map(col => {
                    const reais = (values[col.key] || EMPTY_COUNTS)[d] || 0;
                    const qty = getQty(reais, d);
                    return (
                      <TableCell key={`qty-${col.key}`} className="p-1">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="h-9 text-right tabular-nums w-20"
                          value={qty || ''}
                          onChange={e => handleQtyChange(col.key, d, parseInt(e.target.value) || 0)}
                          disabled={readOnly}
                          placeholder="0"
                        />
                      </TableCell>
                    );
                  })}
                  {/* R$ inputs */}
                  {columns.map(col => (
                    <TableCell key={`val-${col.key}`} className="p-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-9 text-right tabular-nums"
                        value={(values[col.key] || EMPTY_COUNTS)[d] || ''}
                        onChange={e => handleReaisChange(col.key, d, parseFloat(e.target.value) || 0)}
                        disabled={readOnly}
                        placeholder="0"
                      />
                    </TableCell>
                  ))}
                  {showTotalColumn && (
                    <TableCell className="text-right font-medium tabular-nums">
                      {fmt(rowTotals[d] || 0)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-primary/10 font-bold">
              <TableCell className="font-bold">TOTAL</TableCell>
              {/* Empty cells for qty columns */}
              {columns.map(col => {
                const totalQty = DENOMINATIONS.reduce((s, d) => s + getQty((values[col.key] || EMPTY_COUNTS)[d] || 0, d), 0);
                return (
                  <TableCell key={`qty-total-${col.key}`} className="text-right font-bold tabular-nums text-muted-foreground">
                    {totalQty}
                  </TableCell>
                );
              })}
              {columns.map(col => (
                <TableCell key={col.key} className="text-right font-bold tabular-nums">
                  {fmt(columnTotals[col.key] || 0)}
                </TableCell>
              ))}
              {showTotalColumn && (
                <TableCell className="text-right font-bold tabular-nums text-primary">
                  {fmt(grandTotal)}
                </TableCell>
              )}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
