import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, UploadCloud, CheckCircle2, ListChecks, ExternalLink, Receipt } from 'lucide-react';

type Operadora = 'pluxee' | 'alelo' | 'vr' | 'ticket';

type VoucherImport = {
  id: string;
  operadora: string;
  filename: string;
  rows_imported: number;
  created_at: string;
};

const META: Record<Operadora, { title: string; accept: string; functionName: string; tip: string }> = {
  pluxee: {
    title: 'Pluxee (CSV)',
    accept: '.csv',
    functionName: 'import-voucher-pluxee',
    tip: 'Portal Pluxee → Extrato → exportar CSV (latin-1 ou UTF-8). Cada lote tem cabeçalho "Data de Pagamento" + transações + tarifas (Reembolso = admin 3,5%, Reembolso Expresso = antecipação).',
  },
  alelo: {
    title: 'Alelo (XLSX)',
    accept: '.xlsx',
    functionName: 'import-voucher-alelo',
    tip: 'Portal Alelo → Recebimentos. O arquivo tem 3 abas: Recebimentos (transações), Outras Transações (anuidade/compensações) e Não Exportadas (ignorada).',
  },
  vr: {
    title: 'VR (XLS)',
    accept: '.xls,.xlsx',
    functionName: 'import-voucher-vr',
    tip: 'Portal VR → Guias de Reembolso. Cada linha é 1 guia paga. Antecipação ativa: cálculo da taxa adm é teórico (PAT 3,6% / Auxílio 6,3%) e o residual vai para antecipação.',
  },
  ticket: {
    title: 'Ticket (XLSX detalhado)',
    accept: '.xlsx',
    functionName: 'import-voucher-ticket',
    tip: 'Portal Ticket → Extrato de Reembolso DETALHADO. Hierárquico: transações + Subtotal + Tarifa de gestão (R$ fixa) + Taxa TPE (admin %) + Valor Líquido.',
  },
};

const ORDER: Operadora[] = ['pluxee', 'alelo', 'vr', 'ticket'];

export default function VoucherSettlementsImportSection({
  periodId,
  periodMonth,
  periodYear,
  disabled,
}: {
  periodId: string | null;
  periodMonth: number | null;
  periodYear: number | null;
  disabled: boolean;
}) {
  const navigate = useNavigate();
  const [imports, setImports] = useState<VoucherImport[]>([]);
  const [matching, setMatching] = useState(false);
  const [lastMatch, setLastMatch] = useState<any>(null);

  const refresh = async () => {
    if (!periodId) return;
    const { data } = await supabase
      .from('voucher_imports')
      .select('*')
      .eq('audit_period_id', periodId)
      .order('imported_at', { ascending: false });
    setImports((data as VoucherImport[]) ?? []);
  };

  useEffect(() => { refresh(); }, [periodId]);

  const importsByOp = ORDER.reduce((acc, op) => {
    acc[op] = imports.filter(i => i.operadora === op);
    return acc;
  }, {} as Record<Operadora, VoucherImport[]>);

  const allFour = ORDER.every(op => importsByOp[op]?.length > 0);

  const runMatch = async () => {
    if (!periodId) return;
    setMatching(true);
    try {
      const { data, error } = await supabase.rpc('match_voucher_lots', { p_period_id: periodId });
      if (error) throw error;
      setLastMatch(data);
      toast.success('✓ Conciliação concluída', {
        description: `${(data as any)?.matched_items ?? 0} itens casados, ${(data as any)?.matched_lots ?? 0} lotes ↔ BB. Confira o relatório abaixo ↓`,
      });
    } catch (e: any) {
      toast.error('Erro ao conciliar extratos', { description: e?.message });
    } finally {
      setMatching(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-5 w-5 text-primary" />
          Extratos das Operadoras (Voucher Settlements)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Importe os extratos detalhados de cada operadora para calcular taxa real efetiva (sem chute).
          Após importar os 4, clique em "Conciliar Extratos" para casar transações ↔ lotes ↔ depósitos BB.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ORDER.map(op => (
            <OperadoraDropzone
              key={op}
              op={op}
              periodId={periodId}
              disabled={disabled}
              imports={importsByOp[op]}
              onAfter={refresh}
            />
          ))}
        </div>

        <Separator />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {allFour
              ? <span className="text-foreground">✓ Os 4 extratos foram importados. Pronto para conciliar.</span>
              : <span>Importe os 4 extratos para habilitar a conciliação.</span>}
            {lastMatch && (
              <div className="text-xs mt-1">
                Último match: <span className="font-medium text-foreground">{lastMatch.matched_items}</span> itens casados, {' '}
                <span className="font-medium text-foreground">{lastMatch.unmatched_items}</span> sem match · {' '}
                <span className="font-medium text-foreground">{lastMatch.matched_lots}</span> lotes ↔ BB casados
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={runMatch}
              disabled={!allFour || matching || disabled}
              className="gap-2"
            >
              {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              Conciliar Extratos
            </Button>
            {periodId && periodMonth && periodYear && (
              <Button
                variant="outline"
                onClick={() => navigate(`/admin/auditoria/voucher-settlements?period=${periodId}&month=${periodMonth}&year=${periodYear}`)}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Ver relatório
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OperadoraDropzone({
  op, periodId, disabled, imports, onAfter,
}: {
  op: Operadora;
  periodId: string | null;
  disabled: boolean;
  imports: VoucherImport[];
  onAfter: () => Promise<void>;
}) {
  const meta = META[op];
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!periodId) return;
    setUploading(true);
    try {
      let body: any = { audit_period_id: periodId, file_name: file.name };

      if (op === 'pluxee') {
        const text = await readAsTextDetect(file);
        const sep = text.split('\n')[0].includes(';') ? ';' : ',';
        const rows = text.split('\n').map(l => l.split(sep).map(c => c.trim()));
        body.rows = rows;
      } else if (op === 'alelo') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const recebimentosSheet = wb.SheetNames.find(n => /recebimentos/i.test(n)) ?? wb.SheetNames[1];
        const outrasSheet = wb.SheetNames.find(n => /outras/i.test(n));
        // Envia como array de arrays (header:1) — backend faz busca dinâmica do header,
        // pois o XLSX da Alelo costuma ter linhas de título/branding antes do cabeçalho real.
        body.recebimentos_rows = recebimentosSheet
          ? XLSX.utils.sheet_to_json(wb.Sheets[recebimentosSheet], { header: 1, defval: null, raw: true })
          : [];
        body.outras_rows = outrasSheet
          ? XLSX.utils.sheet_to_json(wb.Sheets[outrasSheet], { header: 1, defval: null, raw: true })
          : [];
      } else if (op === 'vr') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        body.rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
      } else if (op === 'ticket') {
        // Envia o arquivo cru (base64) para o backend parsear.
        // Motivo: o XLSX da Ticket contém uma imagem PNG embutida que faz
        // o SheetJS no browser falhar ("Bad uncompressed size"). No Deno o parse funciona.
        // Usamos FileReader (nativo) em vez de for+btoa que estoura memória no mobile.
        body.file_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.substring(result.indexOf(',') + 1);
            resolve(base64);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      }

      const { data, error } = await supabase.functions.invoke(meta.functionName, { body });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha na importação');

      toast.success(`✓ ${meta.title}`, {
        description: `${data.imported_lots} lotes · ${data.imported_items} itens · ${data.imported_adjustments} ajustes`,
      });
      await onAfter();
    } catch (e: any) {
      toast.error(`Erro ao importar ${meta.title}`, { description: e?.message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">{meta.title}</p>
        {imports.length > 0 ? (
          <Badge variant="secondary" className="bg-green-500/10 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {imports[0].imported_lots} lotes
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-muted-foreground">não importado</Badge>
        )}
      </div>

      {imports.length > 0 && (
        <p className="text-xs text-muted-foreground truncate" title={imports[0].file_name}>
          {imports[0].file_name}
        </p>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => !uploading && !disabled && inputRef.current?.click()}
        className={`rounded border-2 border-dashed px-2 py-3 text-center text-xs cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
        } ${disabled || uploading ? 'opacity-60 pointer-events-none' : ''}`}
      >
        {uploading ? (
          <span className="flex items-center justify-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Importando...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-1.5 text-muted-foreground">
            <UploadCloud className="h-3 w-3" />
            {imports.length > 0 ? `Substituir ${meta.accept}` : `Arraste ${meta.accept}`}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={meta.accept}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      <p className="text-[11px] text-muted-foreground/80 leading-snug">{meta.tip}</p>
    </div>
  );
}

async function readAsTextDetect(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Tenta UTF-8 primeiro
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return utf8;
  } catch {
    // Fallback latin-1
    return new TextDecoder('latin1').decode(bytes);
  }
}
