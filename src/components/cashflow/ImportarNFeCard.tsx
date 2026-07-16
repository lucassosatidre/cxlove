// Card de importação de NF-e (XML/ZIP) que gera contas a pagar em cashflow_launches.

import { useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, Upload, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';


import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import { supabase } from '@/integrations/supabase/client';
import {
  extractXmlFiles, parseNFeXml, nfeToLancamentos,
  type ParsedNFe,
} from '@/lib/nfeFinanceParser';

const CATEGORIAS = [
  'Matéria Prima',
  'Fornecedores',
  'Luz / Energia',
  'Água',
  'Internet',
  'Gás',
  'Contador',
  'Manutenção',
  'Marketing',
  'Impostos',
  'Outros',
];

type Preview = { fileName: string; parsed: ParsedNFe };

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtCNPJ(v: string) {
  const s = (v || '').padStart(14, '0');
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12, 14)}`;
}

export default function ImportarNFeCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [categoria, setCategoria] = useState<string>('Matéria Prima');
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSyncEspiao() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-nfe-vigia');
      if (error) throw error;
      const inserted = (data as any)?.inserted ?? 0;
      const skipped = (data as any)?.skipped ?? 0;
      toast.success(`Sincronizado: ${inserted} novas contas a pagar, ${skipped} já existiam`);
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && String(q.queryKey[0] ?? '').startsWith('cashflow_lancamentos'),
      });
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro na sincronização: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  }




  const totals = useMemo(() => {
    let total = 0, parcelas = 0;
    for (const p of previews) {
      total += p.parsed.duplicatas.length > 0
        ? p.parsed.duplicatas.reduce((s, d) => s + d.vDup, 0)
        : p.parsed.total_value;
      parcelas += Math.max(p.parsed.duplicatas.length, 1);
    }
    return { total, parcelas, notas: previews.length };
  }, [previews]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setLoading(true);
    setErrors([]);
    try {
      const list = Array.from(files);
      const xmls = await extractXmlFiles(list);
      if (xmls.length === 0) {
        toast.error('Nenhum XML encontrado nos arquivos.');
        setLoading(false);
        return;
      }
      const parsed: Preview[] = [];
      const errs: string[] = [];
      for (const x of xmls) {
        try {
          const p = parseNFeXml(x.text);
          if (!p.access_key || p.access_key.length !== 44) {
            errs.push(`${x.name}: chave de acesso inválida`);
            continue;
          }
          parsed.push({ fileName: x.name, parsed: p });
        } catch (e: any) {
          errs.push(`${x.name}: ${e?.message || e}`);
        }
      }
      // dedup por access_key na prévia
      const seen = new Set<string>();
      const unique: Preview[] = [];
      for (const p of parsed) {
        if (seen.has(p.parsed.access_key)) continue;
        seen.add(p.parsed.access_key);
        unique.push(p);
      }
      setPreviews(unique);
      setErrors(errs);
      if (unique.length > 0) toast.success(`${unique.length} NF-e(s) lida(s).`);
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro ao ler arquivos: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (previews.length === 0) return;
    setImporting(true);
    let inseridos = 0;
    let duplicados = 0;
    let erros = 0;
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id ?? null;

      const rows = previews.flatMap((p) =>
        nfeToLancamentos(p.parsed).map((l) => ({ ...l, category: categoria, created_by: uid })),
      );

      // Insere um-a-um para capturar duplicados sem abortar o batch.
      for (const r of rows) {
        const { error } = await (supabase as any).from('cashflow_launches').insert(r);
        if (!error) {
          inseridos++;
        } else {
          const msg = String(error.message || '').toLowerCase();
          if (error.code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
            duplicados++;
          } else {
            console.error(error);
            erros++;
          }
        }
      }

      if (erros > 0) {
        toast.error(`${inseridos} importados, ${duplicados} já existiam, ${erros} com erro`);
      } else {
        toast.success(`${inseridos} lançamentos importados, ${duplicados} já existiam (ignorados)`);
      }
      setPreviews([]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e: any) {
      console.error(e);
      toast.error(`Erro na importação: ${e?.message || e}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <FileUp className="h-5 w-5 text-primary" />
          Importar NF-e (XML/ZIP)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription className="text-sm">
            As notas de entrada geram contas a pagar automaticamente (uma por parcela do boleto).
            Enquanto a integração com o TecnoSpeed não fica pronta, importe aqui os XMLs das NF-e.
          </AlertDescription>
        </Alert>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground max-w-md">
            Puxa automaticamente todas as notas de entrada da SEFAZ (via Maná), sem precisar subir XML.
          </div>
          <Button size="sm" onClick={handleSyncEspiao} disabled={syncing || importing || loading}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar automático (Espião)
          </Button>
        </div>


        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2 space-y-1">
            <Label htmlFor="nfe-files" className="text-xs">Arquivos XML ou ZIP</Label>
            <Input
              ref={inputRef}
              id="nfe-files"
              type="file"
              accept=".xml,.zip"
              multiple
              disabled={loading || importing}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Categoria padrão</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo arquivos…
          </div>
        )}

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              <div className="font-medium mb-1">Arquivos ignorados:</div>
              <ul className="list-disc ml-4">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {previews.length > 0 && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Notas</div>
                <div className="font-mono text-lg font-semibold">{totals.notas}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Parcelas</div>
                <div className="font-mono text-lg font-semibold">{totals.parcelas}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total a pagar</div>
                <div className="font-mono text-lg font-semibold text-destructive">{fmtBRL(totals.total)}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Nº</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Parcelas</TableHead>
                    <TableHead>Vencimentos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previews.map((p, i) => {
                    const dups = p.parsed.duplicatas;
                    return (
                      <TableRow key={`${p.parsed.access_key}-${i}`}>
                        <TableCell className="text-sm max-w-[240px] truncate" title={p.parsed.emit_name}>
                          {p.parsed.emit_name || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{fmtCNPJ(p.parsed.emit_cnpj)}</TableCell>
                        <TableCell className="text-xs">{p.parsed.numero}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtDate(p.parsed.emission_date)}</TableCell>
                        <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                          {fmtBRL(p.parsed.total_value)}
                        </TableCell>
                        <TableCell className="text-center text-xs">{dups.length || 1}</TableCell>
                        <TableCell className="text-xs">
                          {dups.length > 0 ? (
                            <div className="space-y-0.5">
                              {dups.map((d, j) => (
                                <div key={j} className="flex gap-2">
                                  <span className="text-muted-foreground">{d.nDup}:</span>
                                  <span>{fmtDate(d.dVenc)}</span>
                                  <span className="font-mono">{fmtBRL(d.vDup)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">à vista ({fmtDate(p.parsed.emission_date)})</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setPreviews([]); if (inputRef.current) inputRef.current.value = ''; }} disabled={importing}>
                Limpar
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Importar para contas a pagar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
