import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Landmark, CreditCard, FileSpreadsheet, Trash2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import UploadCashflowCard, { type ParseFileInput, type ParseFileResult } from './UploadCashflowCard';
import ConectarBancoOpenFinance from './ConectarBancoOpenFinance';
import InterWebhookCard from './InterWebhookCard';
import {
  parseBB, parseCresol, parseC6, parseSicredi, parseIfoodConta, parseSaipos,
} from '@/lib/cashflow-parsers';

type AccountLite = { id: string; name: string };
type ImportRow = {
  id: string;
  file_type: string;
  file_name: string;
  account_id: string | null;
  imported_rows: number | null;
  duplicate_rows: number | null;
  status: string;
  created_at: string;
};

const C6_ACCOUNT_MAP: Record<string, string> = {
  '362176477': 'C6 Propósito',
  '360427901': 'C6 Prover',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge className="bg-emerald-700 hover:bg-emerald-700">Concluído</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Falhou</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function ImportacoesCashflow() {
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ifoodClosingBalance, setIfoodClosingBalance] = useState<string>('');

  const accByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.name, a.id);
    return m;
  }, [accounts]);
  const accById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const accId = useCallback((name: string) => accByName.get(name) ?? null, [accByName]);

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from('cashflow_accounts')
      .select('id,name')
      .order('name');
    if (error) { toast.error(`Contas: ${error.message}`); return; }
    setAccounts((data ?? []) as AccountLite[]);
  }, []);

  const loadImports = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('cashflow_imports')
      .select('id,file_type,file_name,account_id,imported_rows,duplicate_rows,status,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) { toast.error(`Histórico: ${error.message}`); return; }
    setImports((data ?? []) as ImportRow[]);
  }, []);

  useEffect(() => {
    loadAccounts();
    loadImports();
  }, [loadAccounts, loadImports]);

  const onAfter = useCallback(async () => { await loadImports(); }, [loadImports]);

  const handleDelete = async (imp: ImportRow) => {
    try {
      const table = imp.file_type === 'saipos' ? 'cashflow_saipos' : 'cashflow_transactions';
      const { error: delDataErr } = await supabase.from(table).delete().eq('import_id', imp.id);
      if (delDataErr) throw new Error(delDataErr.message);
      const { error: delImpErr } = await supabase.from('cashflow_imports').delete().eq('id', imp.id);
      if (delImpErr) throw new Error(delImpErr.message);
      toast.success('Importação apagada');
      await loadImports();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ───── Parsers wrappers ─────
  const pBB = (i: ParseFileInput): ParseFileResult => {
    const acc = accId('Banco do Brasil');
    const { rows, closing } = parseBB(i.rows ?? [], acc);
    return { rows: rows as unknown as Record<string, unknown>[], account_id: acc, closing };
  };
  const pCresol = (i: ParseFileInput): ParseFileResult => {
    const acc = accId('Cresol');
    const { rows, closing } = parseCresol(i.rows ?? [], acc);
    return { rows: rows as unknown as Record<string, unknown>[], account_id: acc, closing };
  };
  const pC6 = (i: ParseFileInput): ParseFileResult => {
    const { rows, account_number, closing } = parseC6(i.rows ?? [], null);
    const name = account_number ? C6_ACCOUNT_MAP[account_number] : null;
    const acc = name ? accId(name) : null;
    const warn = acc ? undefined :
      `Não identifiquei a conta C6 no arquivo${account_number ? ` (nº ${account_number})` : ''}.`;
    const enriched = rows.map((r) => ({ ...r, account_id: acc }));
    return { rows: enriched as unknown as Record<string, unknown>[], account_id: acc, warn, closing };
  };
  const pIfood = async (i: ParseFileInput): Promise<ParseFileResult> => {
    const acc = accId('iFood Pago');
    let result: ParseFileResult;
    if (i.fileName.toLowerCase().endsWith('.pdf') && i.buffer) {
      const { parseIfoodPdf } = await import('@/lib/ifood-pdf-parser');
      const { rows, closing, cleanRange } = await parseIfoodPdf(i.buffer, acc);
      result = { rows: rows as unknown as Record<string, unknown>[], account_id: acc, closing, cleanRange };
    } else {
      const raw = ifoodClosingBalance.trim();
      let closingBal: number | null = null;
      if (raw) {
        const normalized = raw.replace(/[R$\s.]/g, '').replace(',', '.');
        const n = Number(normalized);
        if (Number.isFinite(n)) closingBal = n;
      }
      const { rows, closing } = parseIfoodConta(i.text ?? i.rows ?? '', acc, closingBal);
      result = { rows: rows as unknown as Record<string, unknown>[], account_id: acc, closing };
    }
    if (result.cleanRange && result.account_id) {
      const { error } = await supabase.from('cashflow_transactions')
        .delete()
        .eq('source', 'ifood')
        .eq('account_id', result.account_id)
        .gte('tx_date', result.cleanRange.start)
        .lte('tx_date', result.cleanRange.end);
      if (error) toast.error(`Limpeza iFood: ${error.message}`);
    }
    return result;
  };
  const pSicredi = (i: ParseFileInput): ParseFileResult => {
    const acc = accId('Sicredi');
    const { rows, closing } = parseSicredi(i.rows ?? [], acc);
    return { rows: rows as unknown as Record<string, unknown>[], account_id: acc, closing };
  };
  const pSaipos = (i: ParseFileInput): ParseFileResult => {
    const { rows } = parseSaipos(i.rows ?? []);
    return { rows: rows as unknown as Record<string, unknown>[], account_id: null };
  };

  return (
    <div className="space-y-6">
      <ConectarBancoOpenFinance />

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Importar extratos e lançamentos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <UploadCashflowCard label="Extrato Banco do Brasil" icon={Landmark}
              accept=".xlsx,.xls" fileType="bb" table="cashflow_transactions"
              parse={pBB} onAfter={onAfter} />
            <UploadCashflowCard label="Extrato Cresol" icon={Landmark}
              accept=".xlsx,.xls" fileType="cresol" table="cashflow_transactions"
              parse={pCresol} onAfter={onAfter} />
            <UploadCashflowCard label="Extrato C6 (Propósito/Prover)" icon={Landmark}
              accept=".xlsx" fileType="c6" table="cashflow_transactions"
              parse={pC6} onAfter={onAfter} />
            <UploadCashflowCard label="Extrato iFood (Conta)" icon={CreditCard}
              accept=".csv,.pdf" fileType="ifood" table="cashflow_transactions"
              parse={pIfood} onAfter={onAfter}
              onImportSuccess={() => setIfoodClosingBalance('')}
              extra={
                <div className="space-y-1">
                  <Label htmlFor="ifood-closing" className="text-xs text-muted-foreground">
                    Saldo atual da conta iFood (R$) — só para CSV
                  </Label>
                  <Input
                    id="ifood-closing"
                    type="text"
                    inputMode="decimal"
                    placeholder="ex: 37842,64 (ignorado se importar PDF)"
                    value={ifoodClosingBalance}
                    onChange={(e) => setIfoodClosingBalance(e.target.value)}
                  />
                </div>
              } />

            <UploadCashflowCard label="Extrato Sicredi" icon={Landmark}
              accept=".xls,.xlsx" fileType="sicredi" table="cashflow_transactions"
              parse={pSicredi} onAfter={onAfter} />
            {/* Importador manual de Lançamentos Saipos ocultado — dados vêm ao vivo via edge sync-saipos-financeiro */}
          </div>
        </CardContent>
      </Card>

      <InterWebhookCard />

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg font-semibold">Histórico de importações</CardTitle>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma importação registrada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                    <TableHead className="text-right">Duplicadas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map((imp) => (
                    <TableRow key={imp.id}>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDate(imp.created_at)}</TableCell>
                      <TableCell><Badge variant="outline" className="uppercase">{imp.file_type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs max-w-[280px] truncate" title={imp.file_name}>
                        {imp.file_name}
                      </TableCell>
                      <TableCell className="text-sm">{imp.account_id ? accById.get(imp.account_id) ?? '—' : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{imp.imported_rows ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {imp.duplicate_rows ?? 0}
                      </TableCell>
                      <TableCell><StatusBadge status={imp.status} /></TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" title="Apagar importação">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Apagar importação</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso apaga as {imp.imported_rows ?? 0} linhas importadas deste arquivo ({imp.file_name}).
                                Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(imp)}>
                                Apagar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
