import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parseAllCardTransactions } from '@/lib/card-transaction-parser';
import { Button } from '@/components/ui/button';
import AppLayout from '@/components/AppLayout';
import { Upload, AlertCircle, CheckCircle2, FileSpreadsheet, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

interface CardImportSummary {
  totalCount: number;
  deliveryCount: number;
  salonCount: number;
  deliveryDate: string;
  salonDate: string;
}

export default function Import() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<CardImportSummary | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setError('');
    setSummary(null);
    setFileName(file.name);
    setProcessing(true);

    try {
      const { delivery, salon, totalCount } = await parseAllCardTransactions(file);

      const deliveryDate = delivery[0]?.sale_date || '';
      const salonDate = salon[0]?.sale_date || '';

      let deliveryInserted = 0;
      if (delivery.length > 0 && deliveryDate) {
        let { data: dc } = await supabase
          .from('daily_closings')
          .select('id')
          .eq('closing_date', deliveryDate)
          .maybeSingle();

        if (!dc) {
          const { data: newDc, error } = await supabase
            .from('daily_closings')
            .insert({ closing_date: deliveryDate, user_id: user.id, status: 'pending' })
            .select('id')
            .single();
          if (error) throw error;
          dc = newDc;
        }

        await supabase.from('card_transactions').delete().eq('daily_closing_id', dc.id);

        const batch = delivery.map(t => ({
          daily_closing_id: dc!.id,
          user_id: user.id,
          sale_date: t.sale_date || null,
          sale_time: t.sale_time || null,
          payment_method: t.payment_method,
          brand: t.brand || null,
          gross_amount: t.gross_amount,
          net_amount: t.net_amount,
          machine_serial: t.machine_serial || null,
          transaction_id: t.transaction_id || null,
        }));

        const { error: insertErr } = await supabase.from('card_transactions').insert(batch);
        if (insertErr) throw insertErr;
        deliveryInserted = delivery.length;
      }

      let salonInserted = 0;
      if (salon.length > 0 && salonDate) {
        let { data: sc } = await supabase
          .from('salon_closings')
          .select('id')
          .eq('closing_date', salonDate)
          .maybeSingle();

        if (!sc) {
          const { data: newSc, error } = await supabase
            .from('salon_closings')
            .insert({ closing_date: salonDate, user_id: user.id })
            .select('id')
            .single();
          if (error) throw error;
          sc = newSc;
        }

        await supabase.from('salon_card_transactions').delete().eq('salon_closing_id', sc.id);

        const batch = salon.map(t => ({
          salon_closing_id: sc!.id,
          user_id: user.id,
          sale_date: t.sale_date || null,
          sale_time: t.sale_time || null,
          payment_method: t.payment_method,
          brand: t.brand || null,
          gross_amount: t.gross_amount,
          net_amount: t.net_amount,
          machine_serial: t.machine_serial || null,
          transaction_id: t.transaction_id || null,
        }));

        const { error: insertErr } = await supabase.from('salon_card_transactions').insert(batch);
        if (insertErr) throw insertErr;
        salonInserted = salon.length;
      }

      setSummary({
        totalCount,
        deliveryCount: deliveryInserted,
        salonCount: salonInserted,
        deliveryDate,
        salonDate,
      });

      toast.success(`${totalCount} transações importadas: ${deliveryInserted} tele, ${salonInserted} salão.`);
    } catch (err: any) {
      setError(err.message || 'Erro ao processar arquivo.');
    } finally {
      setProcessing(false);
    }
  }, [user]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <AppLayout title="Importar Maquininhas" subtitle="Importe o relatório de vendas por cartão para alimentar as conciliações">
      <div className="max-w-3xl">
        {!summary ? (
          <>
            <div
              className={`relative border-2 border-dashed rounded-xl p-12 text-center row-transition ${
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) processFile(file);
              }}
            >
              {processing ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mb-4" />
                  <p className="text-foreground font-medium">Processando {fileName}...</p>
                </div>
              ) : (
                <>
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-foreground font-semibold text-lg">Arraste o relatório de maquininhas aqui</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">ou clique para selecionar o arquivo (.xlsx)</p>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
                  />
                </>
              )}
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="mt-6 bg-card rounded-xl shadow-card border border-border p-4">
              <h3 className="font-medium text-foreground text-sm mb-3">Como funciona:</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>O sistema lê a aba <strong>Transações</strong> e separa automaticamente pelo serial:</p>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <span>Maquininhas de <strong>entregadores</strong> → Conciliação Tele</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>Maquininhas <strong>fixas do salão</strong> → Conciliação Salão</span>
                </div>
              </div>
            </div>

            <div className="mt-4 bg-card rounded-xl shadow-card border border-border p-4">
              <h3 className="font-medium text-foreground text-sm mb-3">Colunas utilizadas:</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { col: 'A', name: 'Data da Venda' },
                  { col: 'B', name: 'Hora da Venda' },
                  { col: 'D', name: 'Método' },
                  { col: 'H', name: 'Valor Bruto' },
                  { col: 'O', name: 'Serial da Máquina' },
                ].map((c) => (
                  <div key={c.col} className="flex items-center gap-2 text-muted-foreground">
                    <span className="font-mono-tabular text-xs bg-muted rounded px-1.5 py-0.5">{c.col}</span>
                    {c.name}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="bg-card rounded-xl shadow-card border border-border p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Importação Concluída</h2>
                  <p className="text-sm text-muted-foreground">{fileName}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <SummaryCard label="Total transações" value={summary.totalCount} />
                <SummaryCard label="Tele (entregadores)" value={summary.deliveryCount} highlight />
                <SummaryCard label="Salão (fixas)" value={summary.salonCount} highlight />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {summary.deliveryDate && (
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Fechamento Tele</p>
                    <p className="text-sm font-medium text-foreground">{formatDate(summary.deliveryDate)}</p>
                  </div>
                )}
                {summary.salonDate && (
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">Fechamento Salão</p>
                    <p className="text-sm font-medium text-foreground">{formatDate(summary.salonDate)}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setSummary(null); setFileName(''); }}>
                <Upload className="h-4 w-4 mr-2" />
                Importar outro arquivo
              </Button>
              <Button className="flex-1 bg-primary hover:bg-primary/90" onClick={() => navigate('/')}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Ver fechamentos
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? 'bg-primary/5 border border-primary/20' : 'bg-muted'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold font-mono-tabular ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}
