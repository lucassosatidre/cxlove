import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { FileText, Download, Loader2, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
};

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type InterTx = {
  dataEntrada?: string;
  dataLancamento?: string;
  dataTransacao?: string;
  descricao?: string;
  detalhes?: any;
  tipoTransacao?: string;
  tipoOperacao?: string; // C | D
  valor?: number | string;
  categoria?: string;
  subcategoria?: string;
};

export default function ExtratoInterCard() {
  const [dataInicio, setDataInicio] = useState(firstOfMonth());
  const [dataFim, setDataFim] = useState(todayISO());
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [rows, setRows] = useState<InterTx[] | null>(null);

  async function verExtrato() {
    if (!dataInicio || !dataFim) {
      toast.error('Informe data início e fim.');
      return;
    }
    setLoadingList(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-extrato-completo', {
        body: { data_inicio: dataInicio, data_fim: dataFim },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const txs: InterTx[] = (data as any)?.transacoes ?? [];
      setRows(txs);
      toast.success(`${txs.length} lançamentos carregados`);
    } catch (e: any) {
      toast.error(`Falha: ${e?.message || e}`);
    } finally {
      setLoadingList(false);
    }
  }

  async function baixarPdf() {
    if (!dataInicio || !dataFim) {
      toast.error('Informe data início e fim.');
      return;
    }
    setLoadingPdf(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-extrato-pdf', {
        body: { data_inicio: dataInicio, data_fim: dataFim },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any)?.url;
      if (!url) throw new Error('URL não retornada');
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('PDF gerado');
    } catch (e: any) {
      toast.error(`Falha PDF: ${e?.message || e}`);
    } finally {
      setLoadingPdf(false);
    }
  }

  return (
    <Card className="border-l-4" style={{ borderLeftColor: '#FF6B00' }}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Landmark className="h-5 w-5" style={{ color: '#FF6B00' }} />
          Extrato Inter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="inter-di" className="text-xs text-muted-foreground">Data início</Label>
            <Input
              id="inter-di" type="date" value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)} className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inter-df" className="text-xs text-muted-foreground">Data fim</Label>
            <Input
              id="inter-df" type="date" value={dataFim}
              onChange={(e) => setDataFim(e.target.value)} className="w-40"
            />
          </div>
          <Button
            onClick={verExtrato} disabled={loadingList}
            style={{ backgroundColor: '#FF6B00', color: '#fff' }}
          >
            {loadingList ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
            Ver extrato detalhado
          </Button>
          <Button variant="outline" onClick={baixarPdf} disabled={loadingPdf}>
            {loadingPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            Baixar PDF
          </Button>
        </div>

        {rows && (
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento no período.</p>
          ) : (
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t, i) => {
                    const dt = t.dataEntrada ?? t.dataLancamento ?? t.dataTransacao;
                    const valor = Number(t.valor ?? 0);
                    const tipo = String(t.tipoOperacao ?? '').toUpperCase();
                    const isDebit = tipo === 'D' || valor < 0;
                    const shown = Math.abs(valor) * (isDebit ? -1 : 1);
                    const cat = t.categoria ?? (t as any).tipoTransacao;
                    const sub = t.subcategoria;
                    return (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap text-sm">{fmtDate(dt)}</TableCell>
                        <TableCell className="text-sm max-w-[380px]">
                          <div className="truncate" title={t.descricao ?? ''}>{t.descricao ?? '—'}</div>
                          {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
                        </TableCell>
                        <TableCell>
                          {cat ? <Badge variant="outline" className="text-[10px]">{String(cat)}</Badge> : '—'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-mono tabular-nums text-sm',
                            isDebit ? 'text-destructive' : 'text-emerald-600',
                          )}
                        >
                          {fmtBRL(shown)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
