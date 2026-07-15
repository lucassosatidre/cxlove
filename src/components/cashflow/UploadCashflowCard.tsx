import { useRef, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, UploadCloud, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { readWorkbookFixed, sheetToRows } from '@/lib/cashflow-parsers';

export type ParseFileInput = { rows?: unknown[][]; text?: string; fileName: string };
export type ParseFileResult = {
  rows: Record<string, unknown>[];
  account_id: string | null;
  warn?: string;
  closing?: { balance: number | null; as_of: string | null };
};

type Table = 'cashflow_transactions' | 'cashflow_saipos';

export type UploadCashflowCardProps = {
  label: string;
  icon: LucideIcon;
  accept: string;
  fileType: string;
  table: Table;
  parse: (input: ParseFileInput) => Promise<ParseFileResult> | ParseFileResult;
  onAfter: () => void | Promise<void>;
  extra?: ReactNode;
  onImportSuccess?: () => void;
};

const TX_COLS = [
  'account_id', 'tx_date', 'description', 'detail', 'amount', 'running_balance',
  'category', 'is_internal_transfer', 'counterparty', 'doc_number', 'source',
  'source_seq', 'is_future', 'import_id',
] as const;

const SAIPOS_COLS = [
  'company', 'vencimento', 'emissao', 'pagamento', 'amount', 'payment_method',
  'category', 'fornecedor', 'descricao', 'paid', 'is_frente_caixa', 'conta', 'is_retido', 'source',
  'source_seq', 'import_id',
] as const;

function pick<T extends readonly string[]>(row: Record<string, unknown>, cols: T) {
  const out: Record<string, unknown> = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
}

export default function UploadCashflowCard({
  label, icon: Icon, accept, fileType, table, parse, onAfter, extra, onImportSuccess,
}: UploadCashflowCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setProgress({ current: 0, total: files.length });

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    let okCount = 0;
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      setProgress({ current: idx + 1, total: files.length });

      let importId: string | null = null;
      try {
        // 1. Ler arquivo
        let input: ParseFileInput;
        if (accept.includes('.csv') && file.name.toLowerCase().endsWith('.csv')) {
          let text = await file.text();
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          input = { text, fileName: file.name };
        } else {
          const buf = await file.arrayBuffer();
          const wb = readWorkbookFixed(buf);
          const rows = sheetToRows(wb.Sheets[wb.SheetNames[0]]);
          input = { rows, fileName: file.name };
        }

        // 2. Parse
        const { rows, account_id, warn, closing } = await parse(input);
        if (warn) toast.warning(warn);
        if (!rows || rows.length === 0) {
          toast.error(`${file.name}: nenhuma linha válida encontrada`);
          continue;
        }

        // 3. cashflow_imports
        const { data: imp, error: impErr } = await supabase
          .from('cashflow_imports')
          .insert({
            file_type: fileType,
            file_name: file.name,
            account_id,
            total_rows: rows.length,
            status: 'pending',
            created_by: userId,
          })
          .select()
          .single();
        if (impErr || !imp) throw new Error(impErr?.message ?? 'Falha ao criar import');
        importId = imp.id as string;

        // 4. Insert em chunks
        const cols = table === 'cashflow_transactions' ? TX_COLS : SAIPOS_COLS;
        const payload = rows.map((r) => {
          const base = pick(r, cols);
          base.import_id = importId;
          if (table === 'cashflow_transactions' && base.is_future === null) base.is_future = false;
          return base;
        });

        let inserted = 0;
        const CHUNK = 200;
        for (let i = 0; i < payload.length; i += CHUNK) {
          const chunk = payload.slice(i, i + CHUNK);
          const { data: ins, error: insErr } = await supabase
            .from(table)
            // upsert respeita unique(row_hash) calculado pelo trigger
            .upsert(chunk as never, { onConflict: 'row_hash', ignoreDuplicates: true })
            .select('id');
          if (insErr) throw new Error(insErr.message);
          inserted += ins?.length ?? 0;
        }

        // 4b. SUBSTITUIR: remove linhas antigas (de imports anteriores) no mesmo intervalo de datas.
        // Isso evita duplicatas quando o mesmo extrato/arquivo é reimportado (refresh limpo).
        const dateField = table === 'cashflow_transactions' ? 'tx_date' : 'vencimento';
        const dateVals = payload
          .map((r) => r[dateField])
          .filter((d): d is string => typeof d === 'string' && d.length >= 8)
          .sort();
        let periodMin: string | null = null;
        let periodMax: string | null = null;
        if (dateVals.length > 0) {
          const minD = dateVals[0];
          const maxD = dateVals[dateVals.length - 1];
          periodMin = minD;
          periodMax = maxD;
          if (table === 'cashflow_transactions') {
            if (account_id) {
              const { error: delErr } = await supabase
                .from('cashflow_transactions')
                .delete()
                .neq('import_id', importId)
                .gte('tx_date', minD)
                .lte('tx_date', maxD)
                .eq('account_id', account_id);
              if (delErr) toast.warning(`Limpeza do período: ${delErr.message}`);
            }
          } else {
            // cashflow_saipos: substitui só os lançamentos vindos do Saipos,
            // PRESERVA cargas manuais (ex.: faturas de cartão com source 'cartao_*').
            const { error: delErr } = await supabase
              .from('cashflow_saipos')
              .delete()
              .neq('import_id', importId)
              .gte('vencimento', minD)
              .lte('vencimento', maxD)
              .eq('source', 'saipos');
            if (delErr) toast.warning(`Limpeza do período: ${delErr.message}`);
          }
        }

        // 5. completar import
        await supabase.from('cashflow_imports').update({
          status: 'completed',
          imported_rows: inserted,
          duplicate_rows: rows.length - inserted,
        }).eq('id', importId);

        // 6. Atualizar saldo da conta a partir do extrato (quando aplicável)
        if (closing?.balance != null && closing.as_of && account_id) {
          const { error: balErr } = await supabase
            .from('cashflow_balances')
            .upsert(
              {
                account_id,
                as_of: closing.as_of,
                own_balance: closing.balance,
                provisioned: 0,
                limit_available: 0,
                note: 'atualizado pelo extrato',
              },
              { onConflict: 'account_id,as_of' },
            );
          if (balErr) {
            toast.warning(`Saldo não atualizado: ${balErr.message}`);
          }
          const { error: accErr } = await supabase
            .from('cashflow_accounts')
            .update({ balance_anchor: closing.balance, balance_anchor_date: closing.as_of })
            .eq('id', account_id);
          if (accErr) {
            toast.warning(`Âncora não atualizada: ${accErr.message}`);
          }
        }

        const periodMsg = periodMin && periodMax ? ` (período ${periodMin} a ${periodMax} atualizado)` : '';
        toast.success(`${file.name}: ${inserted} lançamentos${periodMsg}`);
        okCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (importId) {
          await supabase.from('cashflow_imports').update({
            status: 'failed', error_message: msg,
          }).eq('id', importId);
        }
        toast.error(`${file.name}: ${msg}`);
      }
    }

    setUploading(false);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
    if (okCount > 0) {
      await onAfter();
      onImportSuccess?.();
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <CardTitle className="text-base font-semibold">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) handleFiles(files);
          }}
        />
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          variant="outline"
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {progress ? `Enviando ${progress.current}/${progress.total}…` : 'Enviando…'}
            </>
          ) : (
            <>
              <UploadCloud className="h-4 w-4 mr-2" />
              Selecionar arquivo
            </>
          )}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Aceita: {accept}</p>
        {extra ? <div className="mt-3">{extra}</div> : null}
      </CardContent>
    </Card>
  );
}
