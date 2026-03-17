import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parseExcelFile, ParsedOrder } from '@/lib/excel-parser';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Import() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setError('');
    setFileName(file.name);
    setProcessing(true);

    try {
      const orders = await parseExcelFile(file);

      // Create import record
      const { data: importData, error: importError } = await supabase
        .from('imports')
        .insert({
          file_name: file.name,
          user_id: user.id,
          total_rows: orders.length,
          status: 'pending',
        })
        .select()
        .single();

      if (importError) throw importError;

      // Insert orders in batches of 100
      const batchSize = 100;
      for (let i = 0; i < orders.length; i += batchSize) {
        const batch = orders.slice(i, i + batchSize).map((o) => ({
          import_id: importData.id,
          order_number: o.order_number,
          payment_method: o.payment_method,
          total_amount: o.total_amount,
          delivery_person: o.delivery_person,
        }));

        const { error: ordersError } = await supabase.from('imported_orders').insert(batch);
        if (ordersError) throw ordersError;
      }

      toast.success(`${orders.length} pedidos importados com sucesso!`);
      navigate(`/reconciliation/${importData.id}`);
    } catch (err: any) {
      setError(err.message || 'Erro ao processar arquivo.');
    } finally {
      setProcessing(false);
    }
  }, [user, navigate]);

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold text-foreground">Nova Importação</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
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
              <p className="text-sm text-muted-foreground mt-1">Lendo planilha e importando pedidos</p>
            </div>
          ) : (
            <>
              <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-medium text-lg">Arraste o relatório do Saipos aqui</p>
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

        <div className="mt-6 bg-card rounded-lg shadow-card p-4">
          <h3 className="font-medium text-foreground text-sm mb-3">Colunas esperadas no relatório:</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { col: 'A', name: 'Pedido' },
              { col: 'L', name: 'Pagamento' },
              { col: 'R', name: 'Entregador' },
              { col: 'Y', name: 'Total' },
            ].map((c) => (
              <div key={c.col} className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono-tabular text-xs bg-secondary rounded px-1.5 py-0.5">{c.col}</span>
                {c.name}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
