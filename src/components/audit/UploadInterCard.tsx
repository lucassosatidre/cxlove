import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Download, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { AuditPeriodLite } from './UploadCards';

interface Props {
  period: AuditPeriodLite | null;
  ensurePeriod: () => Promise<AuditPeriodLite | null>;
  onAfter: () => Promise<void> | void;
}

function ymRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

export default function UploadInterCard({ period, ensurePeriod, onAfter }: Props) {
  const now = new Date();
  const initYear = period?.year ?? now.getFullYear();
  const initMonth = period?.month ?? (now.getMonth() + 1);
  const { start, end } = ymRange(initYear, initMonth);

  const [dataInicio, setDataInicio] = useState<string>(start);
  const [dataFim, setDataFim] = useState<string>(end);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number; total: number } | null>(null);

  const handleImport = async () => {
    const p = await ensurePeriod();
    if (!p) {
      toast.error('Não foi possível abrir o período.');
      return;
    }
    if (!dataInicio || !dataFim) {
      toast.error('Informe data início e data fim.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('import-inter', {
        body: { audit_period_id: p.id, data_inicio: dataInicio, data_fim: dataFim },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha ao importar');
      setResult({
        imported: data.imported ?? 0,
        duplicates: data.duplicates ?? 0,
        total: data.total ?? 0,
      });
      toast.success(`${data.imported} lançamentos importados do Inter`, {
        description: `${data.total} recebidos · ${data.duplicates} duplicatas ignoradas`,
      });
      await onAfter();
    } catch (e: any) {
      toast.error('Erro ao importar Inter', { description: e?.message ?? 'Erro desconhecido' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-l-4" style={{ borderLeftColor: '#FF6B00' }}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" style={{ color: '#FF6B00' }} />
          <span>Banco Inter</span>
          <span className="text-xs font-normal text-muted-foreground">
            (API direta — sem upload de arquivo)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="inter-inicio" className="text-xs uppercase text-muted-foreground">
              Data início
            </Label>
            <Input
              id="inter-inicio"
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inter-fim" className="text-xs uppercase text-muted-foreground">
              Data fim
            </Label>
            <Input
              id="inter-fim"
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
          <Button
            onClick={handleImport}
            disabled={loading || !period}
            className="h-9 gap-2"
            style={{ backgroundColor: '#FF6B00', color: 'white' }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {loading ? 'Puxando extrato...' : 'Importar extrato do Inter'}
          </Button>
        </div>
        {result && (
          <div className="text-xs text-muted-foreground">
            ✓ {result.imported} lançamentos importados · {result.duplicates} duplicatas · {result.total} recebidos
          </div>
        )}
        {!period && (
          <div className="text-xs text-amber-600 dark:text-amber-400">
            Selecione um período antes de importar.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
