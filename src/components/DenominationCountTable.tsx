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
  /** One DenomCounts per column key */
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

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-24">Denominação</TableHead>
              {columns.map(col => (
                <TableHead key={col.key} className="text-right">{col.label}</TableHead>
              ))}
              {showTotalColumn && <TableHead className="text-right">Total (R$)</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {DENOMINATIONS.map(d => (
              <TableRow key={d}>
                <TableCell className="font-medium text-muted-foreground">R$ {d}</TableCell>
                {columns.map(col => (
                  <TableCell key={col.key} className="p-1">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-9 text-right tabular-nums"
                      value={(values[col.key] || EMPTY_COUNTS)[d] || ''}
                      onChange={e => onChange(col.key, d, parseFloat(e.target.value) || 0)}
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
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-primary/10 font-bold">
              <TableCell className="font-bold">TOTAL</TableCell>
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
