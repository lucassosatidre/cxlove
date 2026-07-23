import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parsePickNGoFile } from '@/lib/pickngo-parser';
import { resolveCanonicalName, firstNameOriginal, FROTA_GARANTIDA_LABEL } from '@/lib/driver-name-match';
import { Button } from '@/components/ui/button';
import AppLayout from '@/components/AppLayout';
import { Upload, Bike, CheckCircle2, AlertCircle, ArrowLeft, Truck, UserX } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PickNGoSummary {
  totalRead: number;
  named: number;        // pedidos que ganharam nome real do motoboy
  frota: number;        // pedidos marcados como Frota Garantida
  updated: number;      // quantos foram realmente alterados no banco
  notFound: number;     // códigos do PickNGo sem pedido correspondente no cx love
  noClosing: string[];  // datas do PickNGo sem caixa aberto no cx love
  unknownNames: string[]; // nomes do PickNGo que não estão no cadastro de entregadores
  closingDates: string[];
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

export default function PickNGoImport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<PickNGoSummary | null>(null);

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setProcessing(true);
    setError('');
    setFileName(file.name);

    try {
      const { rows } = await parsePickNGoFile(file);

      // Cadastro oficial de entregadores (alimenta a Escala) — para normalizar nomes
      const { data: driverRows } = await supabase.from('delivery_drivers_public' as any).select('nome');
      const driverNames = ((driverRows as any[]) || []).map((d: any) => d.nome).filter(Boolean) as string[];

      // Agrupa as linhas do PickNGo por data
      const byDate = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.sale_date || '';
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key)!.push(r);
      }

      let named = 0;
      let frota = 0;
      let notFound = 0;
      const noClosing: string[] = [];
      const unknownNames = new Set<string>();
      const closingDates = new Set<string>();
      const updates: { id: string; delivery_person: string }[] = [];

      for (const [date, dateRows] of byDate) {
        if (!date) {
          notFound += dateRows.length;
          continue;
        }

        const { data: closing } = await supabase
          .from('daily_closings')
          .select('id')
          .eq('closing_date', date)
          .maybeSingle();

        if (!closing) {
          noClosing.push(date);
          notFound += dateRows.length;
          continue;
        }
        closingDates.add(date);

        const { data: orders } = await supabase
          .from('imported_orders')
          .select('id, order_number, delivery_person')
          .eq('daily_closing_id', closing.id);

        const orderMap = new Map((orders || []).map(o => [o.order_number, o]));

        for (const r of dateRows) {
          const order = orderMap.get(r.order_number);
          if (!order) {
            notFound++;
            continue;
          }

          let newName: string;
          if (!r.delivery_person) {
            newName = FROTA_GARANTIDA_LABEL;
            frota++;
          } else {
            const canonical = resolveCanonicalName(r.delivery_person, driverNames);
            if (canonical) {
              newName = canonical;
            } else {
              newName = firstNameOriginal(r.delivery_person);
              unknownNames.add(firstNameOriginal(r.delivery_person));
            }
            named++;
          }

          if ((order.delivery_person || '') !== newName) {
            updates.push({ id: order.id, delivery_person: newName });
          }
        }
      }

      // Aplica as atualizações em blocos
      const chunkSize = 25;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(u =>
            supabase.from('imported_orders').update({ delivery_person: u.delivery_person }).eq('id', u.id)
          )
        );
      }

      setSummary({
        totalRead: rows.length,
        named,
        frota,
        updated: updates.length,
        notFound,
        noClosing,
        unknownNames: [...unknownNames],
        closingDates: [...closingDates],
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

  return (
    <AppLayout title="Importar PickNGo" subtitle="Preenche o nome real do entregador nos pedidos da Tele">
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
                <h3 className="text-lg font-medium text-foreground mb-2">Arraste o relatório do PickNGo aqui</h3>
                <p className="text-sm text-muted-foreground mb-4">arquivo .csv (relatorioGeral) — ou clique para selecionar</p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileInput}
                  className="hidden"
                  id="pickngo-file-upload"
                />
                <Button asChild variant="outline">
                  <label htmlFor="pickngo-file-upload" className="cursor-pointer">
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

          <Alert className="mt-4">
            <AlertDescription>
              Importe os pedidos do Saipos <strong>antes</strong> deste arquivo. O PickNGo só troca o "Pickngo"
              pelo nome real do entregador, casando pelo número do pedido. Pedidos da Frota Garantida (iFood)
              ficam marcados como <strong>Frota Garantida</strong>.
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="max-w-xl mx-auto space-y-4">
          <div className="bg-card rounded-xl shadow-card border border-border p-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-1">Importação concluída!</h3>
            <p className="text-sm text-muted-foreground">
              {summary.closingDates.length > 0
                ? <>Dia(s): <strong>{summary.closingDates.map(formatDate).join(', ')}</strong></>
                : 'Nenhum caixa correspondente encontrado.'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <SummaryCard icon={<Bike className="h-5 w-5 text-success" />} label="Com nome" value={summary.named} />
            <SummaryCard icon={<Truck className="h-5 w-5 text-muted-foreground" />} label="Frota Garantida" value={summary.frota} />
            <SummaryCard icon={<UserX className="h-5 w-5 text-muted-foreground" />} label="Sem par no caixa" value={summary.notFound} />
          </div>

          <Alert>
            <AlertDescription>
              {summary.updated} pedido(s) atualizado(s). Agora abra a <strong>Conciliação</strong> do dia e clique em
              <strong> Reprocessar</strong> para o sistema usar os nomes no match das maquininhas.
            </AlertDescription>
          </Alert>

          {summary.unknownNames.length > 0 && (
            <Alert>
              <AlertDescription>
                <strong>{summary.unknownNames.length} nome(s)</strong> não estão no cadastro de entregadores
                (e por isso não entram na Escala): {summary.unknownNames.join(', ')}. Vale cadastrá-los.
              </AlertDescription>
            </Alert>
          )}

          {summary.noClosing.length > 0 && (
            <Alert>
              <AlertDescription>
                Não há caixa aberto no cx love para: {summary.noClosing.map(formatDate).join(', ')}.
                Importe o Saipos desse dia primeiro.
              </AlertDescription>
            </Alert>
          )}

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
