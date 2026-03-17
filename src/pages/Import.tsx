import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parseExcelFile, ParsedOrder } from '@/lib/excel-parser';
import { isAllOnline } from '@/lib/payment-utils';
import { Button } from '@/components/ui/button';
import AppLayout from '@/components/AppLayout';
import { Upload, AlertCircle, CheckCircle2, FileSpreadsheet, Info, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface ImportSummary {
  totalRead: number;
  alreadyExisted: number;
  newInserted: number;
  totalAccumulated: number;
  closingDate: string;
  isNewClosing: boolean;
}

export default function Import() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setError('');
    setSummary(null);
    setFileName(file.name);
    setProcessing(true);

    try {
      const orders = await parseExcelFile(file);
      const closingDate = orders[0]?.sale_date;
      if (!closingDate) {
        throw new Error('Não foi possível identificar a data de competência (coluna I) no relatório. Verifique se a coluna existe.');
      }

      const ordersForDate = orders.filter(o => o.sale_date === closingDate);

      let dailyClosingId: string;
      let isNewClosing = false;

      const { data: existingClosing } = await supabase
        .from('daily_closings')
        .select('id')
        .eq('closing_date', closingDate)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingClosing) {
        dailyClosingId = existingClosing.id;
      } else {
        const { data: newClosing, error: closingError } = await supabase
          .from('daily_closings')
          .insert({ closing_date: closingDate, user_id: user.id, status: 'pending' })
          .select('id')
          .single();
        if (closingError) throw closingError;
        dailyClosingId = newClosing.id;
        isNewClosing = true;
      }

      const buildOrderKey = (saleDate: string, totalAmount: number) => `${saleDate}|${totalAmount}`;

      const { data: existingOrders, error: existingOrdersError } = await supabase
        .from('imported_orders')
        .select('id, sale_date, total_amount, delivery_person, sale_time, sales_channel, partner_order_number')
        .eq('daily_closing_id', dailyClosingId);

      if (existingOrdersError) throw existingOrdersError;

      interface ExistingOrderInfo {
        id: string;
        delivery_person: string | null;
        sale_time: string | null;
        sales_channel: string | null;
        partner_order_number: string | null;
      }

      const existingOrdersByKey = new Map<string, ExistingOrderInfo>();
      (existingOrders || []).forEach((order) => {
        const key = buildOrderKey(order.sale_date ?? '', order.total_amount);
        if (!existingOrdersByKey.has(key)) {
          existingOrdersByKey.set(key, {
            id: order.id,
            delivery_person: order.delivery_person,
            sale_time: order.sale_time,
            sales_channel: order.sales_channel,
            partner_order_number: order.partner_order_number,
          });
        }
      });

      const newOrders = ordersForDate.filter((order) => {
        const key = buildOrderKey(order.sale_date, order.total_amount);
        return !existingOrdersByKey.has(key);
      });

      const duplicateCount = ordersForDate.length - newOrders.length;

      const fieldUpdates = new Map<string, Record<string, string>>();
      ordersForDate.forEach((order) => {
        const existingOrder = existingOrdersByKey.get(buildOrderKey(order.sale_date, order.total_amount));
        if (!existingOrder) return;
        const updates: Record<string, string> = {};
        if (!existingOrder.delivery_person?.trim() && order.delivery_person.trim()) updates.delivery_person = order.delivery_person.trim();
        if (!existingOrder.sale_time?.trim() && order.sale_time.trim()) updates.sale_time = order.sale_time.trim();
        if (!existingOrder.sales_channel?.trim() && order.sales_channel.trim()) updates.sales_channel = order.sales_channel.trim();
        if (!existingOrder.partner_order_number?.trim() && order.partner_order_number.trim()) updates.partner_order_number = order.partner_order_number.trim();
        if (Object.keys(updates).length > 0) fieldUpdates.set(existingOrder.id, updates);
      });

      const { data: importData, error: importError } = await supabase
        .from('imports')
        .insert({
          file_name: file.name,
          user_id: user.id,
          total_rows: ordersForDate.length,
          new_rows: newOrders.length,
          duplicate_rows: duplicateCount,
          status: 'pending',
          daily_closing_id: dailyClosingId,
        })
        .select('id')
        .single();

      if (importError) throw importError;

      if (newOrders.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < newOrders.length; i += batchSize) {
          const batch = newOrders.slice(i, i + batchSize).map((o) => ({
            import_id: importData.id,
            daily_closing_id: dailyClosingId,
            order_number: o.order_number,
            payment_method: o.payment_method,
            total_amount: o.total_amount,
            delivery_person: o.delivery_person,
            sale_date: o.sale_date,
            sale_time: o.sale_time || null,
            sales_channel: o.sales_channel || null,
            partner_order_number: o.partner_order_number || null,
            is_confirmed: isAllOnline(o.payment_method),
            confirmed_at: isAllOnline(o.payment_method) ? new Date().toISOString() : null,
          }));
          const { error: ordersError } = await supabase.from('imported_orders').insert(batch);
          if (ordersError) throw ordersError;
        }
      }

      if (fieldUpdates.size > 0) {
        const updateResults = await Promise.all(
          Array.from(fieldUpdates.entries()).map(([id, updates]) =>
            supabase.from('imported_orders').update(updates).eq('id', id)
          )
        );
        const updateError = updateResults.find((result) => result.error)?.error;
        if (updateError) throw updateError;
      }

      const { count: totalAccumulated } = await supabase
        .from('imported_orders')
        .select('id', { count: 'exact', head: true })
        .eq('daily_closing_id', dailyClosingId);

      await supabase
        .from('daily_closings')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', dailyClosingId);

      setSummary({
        totalRead: ordersForDate.length,
        alreadyExisted: duplicateCount,
        newInserted: newOrders.length,
        totalAccumulated: totalAccumulated || 0,
        closingDate,
        isNewClosing,
      });

      if (newOrders.length > 0) {
        toast.success(`${newOrders.length} novo(s) pedido(s) adicionado(s) ao fechamento!`);
      } else {
        toast.info('Todos os pedidos já existiam no fechamento.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao processar arquivo.');
    } finally {
      setProcessing(false);
    }
  }, [user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.xlsx')) {
      processFile(file);
    } else {
      setError('Por favor, selecione um arquivo .xlsx');
    }
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
    <AppLayout title="Nova Importação" subtitle="Importe o relatório do Saipos para criar ou atualizar um fechamento">
      <div className="max-w-3xl">
        {!summary ? (
          <>
            <div
              className={`relative border-2 border-dashed rounded-xl p-12 text-center row-transition ${
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {processing ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mb-4" />
                  <p className="text-foreground font-medium">Processando {fileName}...</p>
                  <p className="text-sm text-muted-foreground mt-1">Lendo planilha, verificando duplicatas e importando novos pedidos</p>
                </div>
              ) : (
                <>
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Upload className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-foreground font-semibold text-lg">Arraste o relatório do Saipos aqui</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">ou clique para selecionar o arquivo (.xlsx)</p>
                  <input
                    type="file"
                    accept=".xlsx"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileInput}
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
              <h3 className="font-medium text-foreground text-sm mb-3">Colunas esperadas no relatório:</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { col: 'A', name: 'Pedido' },
                  { col: 'F', name: 'Canal de Venda' },
                  { col: 'H', name: 'Nº Pedido Parceiro' },
                  { col: 'I', name: 'Data/Hora Venda' },
                  { col: 'L', name: 'Pagamento' },
                  { col: 'R', name: 'Entregador' },
                  { col: 'Y', name: 'Total' },
                ].map((c) => (
                  <div key={c.col} className="flex items-center gap-2 text-muted-foreground">
                    <span className="font-mono-tabular text-xs bg-muted rounded px-1.5 py-0.5">{c.col}</span>
                    {c.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 p-3 bg-primary/5 rounded-lg text-sm text-muted-foreground border border-primary/10">
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
              <p>O sistema detecta automaticamente se já existe um fechamento para a mesma data. Pedidos duplicados não serão importados novamente.</p>
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

              <div className="bg-muted rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-foreground mb-1">
                  Fechamento: {formatDate(summary.closingDate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {summary.isNewClosing ? 'Novo fechamento criado' : 'Adicionado ao fechamento existente'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SummaryCard label="Lidos no arquivo" value={summary.totalRead} />
                <SummaryCard label="Já existiam" value={summary.alreadyExisted} />
                <SummaryCard label="Novos adicionados" value={summary.newInserted} highlight />
                <SummaryCard label="Total acumulado" value={summary.totalAccumulated} highlight />
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
