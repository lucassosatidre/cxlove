// Notas de Serviços — NFS-e recebidas pela empresa.
import { useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Download, FileText, FileCode2, Loader2 } from 'lucide-react';

type Nfse = {
  id: string;
  chave_acesso: string | null;
  numero_nfse: string | null;
  data_emissao: string | null;
  valor_servico: number | null;
  situacao: string | null;
  descricao: string | null;
  municipio: string | null;
  prestador_cnpj: string | null;
  prestador_nome: string | null;
  has_xml: boolean;
  has_pdf: boolean;
};

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const fmtCnpj = (v: string | null) => {
  if (!v) return '';
  const s = v.replace(/\D/g, '');
  if (s.length === 14)
    return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return v;
};

function SituacaoBadge({ s }: { s: string | null }) {
  const v = (s ?? '').toLowerCase();
  if (v.includes('cancel'))
    return <Badge variant="outline" className="border-destructive/40 text-destructive/70">Cancelada</Badge>;
  if (v.includes('autoriz') || v === 'ok' || v === 'normal')
    return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Autorizada</Badge>;
  return <Badge variant="secondary">{s ?? '—'}</Badge>;
}

export default function NfseDocuments() {
  const [rows, setRows] = useState<Nfse[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const [de, setDe] = useState<string>(firstDay.toISOString().slice(0, 10));
  const [ate, setAte] = useState<string>(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10));
  const [situacao, setSituacao] = useState<string>('todas');

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('nfse_documents')
        .select('id,chave_acesso,numero_nfse,data_emissao,valor_servico,situacao,descricao,municipio,prestador_cnpj,prestador_nome,has_xml,has_pdf')
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .limit(2000);
      if (!cancel) {
        if (error) toast.error('Erro ao carregar NFS-e: ' + error.message);
        setRows((data ?? []) as Nfse[]);
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.data_emissao) {
        if (de && r.data_emissao < de) return false;
        if (ate && r.data_emissao > ate) return false;
      }
      if (situacao !== 'todas') {
        const s = (r.situacao ?? '').toLowerCase();
        if (situacao === 'autorizada' && !(s.includes('autoriz') || s === 'ok' || s === 'normal')) return false;
        if (situacao === 'cancelada' && !s.includes('cancel')) return false;
      }
      return true;
    });
  }, [rows, de, ate, situacao]);

  const totalValor = filtered.reduce((s, r) => s + (r.valor_servico ?? 0), 0);

  async function baixar(chave: string | null, kind: 'xml' | 'pdf') {
    if (!chave) return;
    setDownloading(`${chave}:${kind}`);
    try {
      const path = `${chave}.${kind}`;
      const { data, error } = await supabase.storage.from('nfse').createSignedUrl(path, 60);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'sem url');
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = path;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(`Falha ao baixar ${kind.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <AppLayout title="Notas de Serviços">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="font-brand text-3xl tracking-wide text-foreground">Notas de Serviços</h1>
          <p className="text-sm text-muted-foreground">NF-e de serviço recebidas pela empresa</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">De</Label>
              <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Até</Label>
              <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Situação</Label>
              <Select value={situacao} onValueChange={setSituacao}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="autorizada">Autorizada</SelectItem>
                  <SelectItem value="cancelada">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Resumo</div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono text-lg font-semibold text-foreground">{filtered.length}</span>
                  <span className="font-mono text-lg font-semibold text-gold-500">{brl(totalValor)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Documentos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Nenhuma nota encontrada no período.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prestador</TableHead>
                    <TableHead>Nº</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Município</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{r.prestador_nome ?? '—'}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{fmtCnpj(r.prestador_cnpj)}</div>
                      </TableCell>
                      <TableCell className="font-mono">{r.numero_nfse ?? '—'}</TableCell>
                      <TableCell>{fmtDate(r.data_emissao)}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="line-clamp-2 text-sm">{r.descricao ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.municipio ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{brl(r.valor_servico)}</TableCell>
                      <TableCell><SituacaoBadge s={r.situacao} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline" size="sm"
                            disabled={!r.has_xml || downloading === `${r.chave_acesso}:xml`}
                            onClick={() => baixar(r.chave_acesso, 'xml')}
                          >
                            {downloading === `${r.chave_acesso}:xml`
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <FileCode2 className="h-3.5 w-3.5" />}
                            XML
                          </Button>
                          <Button
                            variant="outline" size="sm"
                            disabled={!r.has_pdf || downloading === `${r.chave_acesso}:pdf`}
                            onClick={() => baixar(r.chave_acesso, 'pdf')}
                          >
                            {downloading === `${r.chave_acesso}:pdf`
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <FileText className="h-3.5 w-3.5" />}
                            PDF
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
