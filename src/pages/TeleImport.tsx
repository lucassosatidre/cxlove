import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { parseExcelFile } from '@/lib/excel-parser';
import { isAllOnline } from '@/lib/payment-utils';
import { Button } from '@/components/ui/button';
import AppLayout from '@/components/AppLayout';
import TestBanner from '@/components/TestBanner';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';

interface ImportSummary {
  totalRead: number;
  existing: number;
  newOrders: number;
  closingDate: string;
  isNewClosing: boolean;
}

export default function TeleImport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isTestMode } = useTestMode();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setProcessing(true);
    setError('');
    setFileName(file.name);

    try {
      const orders = await parseExcelFile(file);
      if (orders.length === 0) {
        setError('Nenhum pedido encontrado no arquivo.');
        setProcessing(false);
        return;
      }

      // Determine closing date from first order with a date
      const firstDate = orders.find(o => o.sale_date)?.sale_date || new Date().toISOString().split('T')[0];

      // Find or create daily closing for this date
      let { data: existingClosing } = await supabase
        .from('daily_closings')
        .select('id')
        .eq('closing_date', firstDate)
        .eq('is_test', isTestMode)
        .maybeSingle();

      let closingId: string;
      let isNewClosing = false;

      if (existingClosing) {
        closingId = existingClosing.id;
      } else {
        const { data: newClosing, error: closingErr } = await supabase
          .from('daily_closings')
          .insert({ closing_date: firstDate, user_id: user.id, is_test: isTestMode })
          .select('id')
          .single();
        if (closingErr || !newClosing) throw new Error('Erro ao criar fechamento.');
        closingId = newClosing.id;
        isNewClosing = true;
      }

      // Check for existing orders to avoid duplicates
      const { data: existingOrders } = await supabase
        .from('imported_orders')
        .select('order_number')
        .eq('daily_closing_id', closingId);

      const existingSet = new Set((existingOrders || []).map(o => o.order_number));
      const newOrders = orders.filter(o => !existingSet.has(o.order_number));
      const duplicateCount = orders.length - newOrders.length;

      // Create import record
      const { data: importRecord, error: importErr } = await supabase
        .from('imports')
        .insert({
          user_id: user.id,
          file_name: file.name,
          total_rows: orders.length,
          new_rows: newOrders.length,
          duplicate_rows: duplicateCount,
          daily_closing_id: closingId,
          status: 'completed',
          is_test: isTestMode,
        })
        .select('id')
        .single();

      if (importErr || !importRecord) throw new Error('Erro ao salvar importação.');

      // Insert new orders in batches
      if (newOrders.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < newOrders.length; i += batchSize) {
          const batch = newOrders.slice(i, i + batchSize).map(o => {
            const allOnline = isAllOnline(o.payment_method);
            return {
              import_id: importRecord.id,
              daily_closing_id: closingId,
              order_number: o.order_number,
              payment_method: o.payment_method,
              total_amount: o.total_amount,
              delivery_person: o.delivery_person,
              sale_date: o.sale_date || null,
              sale_time: o.sale_time || null,
              sales_channel: o.sales_channel || null,
              partner_order_number: o.partner_order_number || null,
              is_confirmed: allOnline,
              confirmed_at: allOnline ? new Date().toISOString() : null,
              confirmed_by: allOnline ? user!.id : null,
            };
          });
          const { error: insertErr } = await supabase.from('imported_orders').insert(batch);
          if (insertErr) throw new Error('Erro ao inserir pedidos.');
        }
      }

      setSummary({
        totalRead: orders.length,
        existing: duplicateCount,
        newOrders: newOrders.length,
        closingDate: firstDate,
        isNewClosing,
      });
    } catch (err: any) {
      setError(err.message || 'Erro ao processar o arquivo.');
    } finally {
      setProcessing(false);
    }
  }, [user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <AppLayout title="Importar Tele" subtitle="Importe relatórios de vendas da tele-entrega">
      {!summary ? (
        <div className="max-w-xl mx-auto">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            {processing ? (
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full" />
                <p className="text-sm text-muted-foreground">Processando {fileName}...</p>
              </div>
            ) : (
              <>
                <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Arraste o arquivo aqui</h3>
                <p className="text-sm text-muted-foreground mb-4">ou clique para selecionar</p>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileInput}
                  className="hidden"
                  id="tele-file-upload"
                />
                <Button asChild variant="outline">
                  <label htmlFor="tele-file-upload" className="cursor-pointer">
                    Selecionar arquivo
                  </label>
                </Button>
              </>
            )}
          </div>

          {error && (
            <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-xl flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="mt-6 p-4 bg-muted/50 rounded-xl">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Colunas utilizadas (Saipos):</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• <strong>A</strong> — Nº do Pedido</li>
              <li>• <strong>F</strong> — Canal de Venda</li>
              <li>• <strong>H</strong> — Nº Pedido Parceiro</li>
              <li>• <strong>I</strong> — Data/Hora da venda</li>
              <li>• <strong>L</strong> — Forma de pagamento</li>
              <li>• <strong>R</strong> — Entregador</li>
              <li>• <strong>Y</strong> — Total</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="max-w-xl mx-auto space-y-4">
          <div className="bg-card rounded-xl shadow-card border border-border p-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Importação concluída!</h3>
            <p className="text-sm text-muted-foreground">
              Fechamento: <strong>{formatDate(summary.closingDate)}</strong>
              {summary.isNewClosing ? ' (novo)' : ' (existente)'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <SummaryCard icon={<FileSpreadsheet className="h-5 w-5" />} label="Total lidos" value={summary.totalRead} />
            <SummaryCard icon={<CheckCircle2 className="h-5 w-5 text-success" />} label="Novos" value={summary.newOrders} />
            <SummaryCard icon={<AlertCircle className="h-5 w-5 text-muted-foreground" />} label="Duplicados" value={summary.existing} />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setSummary(null)} className="flex-1">
              <Upload className="h-4 w-4 mr-2" />
              Nova importação
            </Button>
            <Button onClick={() => navigate('/tele')} className="flex-1">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar ao Tele
            </Button>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-card rounded-xl shadow-card border border-border p-4 flex items-center gap-3">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
