import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Receipt, FileText, Send, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function InterPagamentosCard() {
  // Boleto
  const [codigoBarras, setCodigoBarras] = useState('');
  const [valorBoleto, setValorBoleto] = useState('');
  const [dataPagamento, setDataPagamento] = useState(todayISO());
  const [descBoleto, setDescBoleto] = useState('');
  const [loadingBoleto, setLoadingBoleto] = useState(false);

  // DARF
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [codigoReceita, setCodigoReceita] = useState('');
  const [dataApuracao, setDataApuracao] = useState('');
  const [dataVencimento, setDataVencimento] = useState('');
  const [valorPrincipal, setValorPrincipal] = useState('');
  const [valorMulta, setValorMulta] = useState('');
  const [valorJuros, setValorJuros] = useState('');
  const [descDarf, setDescDarf] = useState('');
  const [loadingDarf, setLoadingDarf] = useState(false);

  // Pix
  const [chavePix, setChavePix] = useState('');
  const [valorPix, setValorPix] = useState('');
  const [descPix, setDescPix] = useState('');
  const [loadingPix, setLoadingPix] = useState(false);
  const [ultimoPix, setUltimoPix] = useState<string | null>(null);

  // Lote
  const [loteTexto, setLoteTexto] = useState('');
  const [loteData, setLoteData] = useState(todayISO());
  const [loteValorPadrao, setLoteValorPadrao] = useState('');
  const [loadingLote, setLoadingLote] = useState(false);
  const [ultimoLote, setUltimoLote] = useState<{ id: string; total: number } | null>(null);

  async function enviarPix() {
    setLoadingPix(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-pix', {
        body: {
          chave_pix: chavePix.trim(),
          valor: Number(valorPix.replace(',', '.')),
          descricao: descPix || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const codigo = (data as any)?.codigoSolicitacao ?? (data as any)?.endToEnd ?? '(sem código)';
      setUltimoPix(String(codigo));
      toast.success(`Pix enviado (${codigo})`);
      setChavePix(''); setValorPix(''); setDescPix('');
    } catch (e: any) {
      toast.error(`Falha Pix: ${e?.message || e}`);
    } finally {
      setLoadingPix(false);
    }
  }

  async function processarLote() {
    setLoadingLote(true);
    try {
      const linhas = loteTexto
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const pagamentos: any[] = [];
      for (const l of linhas) {
        // Formato aceito: "codigo_barras[;valor]"
        const [cbRaw, vRaw] = l.split(/[;\t,|]/).map((x) => x?.trim());
        const cb = String(cbRaw ?? '').replace(/\D/g, '');
        if (!cb) continue;
        const v = vRaw ? Number(vRaw.replace(',', '.')) : Number((loteValorPadrao || '0').replace(',', '.'));
        pagamentos.push({
          codigo_barras: cb,
          data_pagamento: loteData,
          valor_pagar: v,
        });
      }
      if (pagamentos.length === 0) throw new Error('Nenhum boleto válido no lote');
      if (pagamentos.length > 100) throw new Error('Máximo 100 boletos por lote');
      const semValor = pagamentos.filter((p) => !isFinite(p.valor_pagar) || p.valor_pagar <= 0);
      if (semValor.length > 0) {
        throw new Error(
          `${semValor.length} boleto(s) sem valor. Informe valor padrão ou use "codigo;valor" por linha.`,
        );
      }

      const { data, error } = await supabase.functions.invoke('inter-pagar-lote', {
        body: { pagamentos },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const idLote = (data as any)?.idLote ?? (data as any)?.meuIdentificador;
      setUltimoLote({ id: String(idLote), total: pagamentos.length });
      toast.success(`Lote enviado (${pagamentos.length} boletos) — id ${idLote}`);
      setLoteTexto('');
    } catch (e: any) {
      toast.error(`Falha lote: ${e?.message || e}`);
    } finally {
      setLoadingLote(false);
    }
  }

  async function checarLote() {
    if (!ultimoLote?.id) return;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inter-pagar-lote?idLote=${encodeURIComponent(ultimoLote.id)}`;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token ?? anon;
      const r = await fetch(url, {
        headers: { apikey: anon, Authorization: `Bearer ${token}` },
      });
      const resultado = await r.json();
      if (!r.ok || resultado?.error) throw new Error(resultado?.error ?? `HTTP ${r.status}`);
      toast.success(`Status: ${resultado?.situacao ?? resultado?.status ?? 'consultado'}`);
      console.log('Lote status', resultado);
    } catch (e: any) {
      toast.error(`Falha ao consultar lote: ${e?.message || e}`);
    }
  }



  async function pagarBoleto() {
    setLoadingBoleto(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-pagar-boleto', {
        body: {
          codigo_barras: codigoBarras.replace(/\D/g, ''),
          data_vencimento: dataPagamento,
          valor_pagar: valorBoleto ? Number(valorBoleto.replace(',', '.')) : undefined,
          descricao: descBoleto || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Boleto enviado para pagamento');
      setCodigoBarras(''); setValorBoleto(''); setDescBoleto('');
    } catch (e: any) {
      toast.error(`Falha no pagamento: ${e?.message || e}`);
    } finally {
      setLoadingBoleto(false);
    }
  }

  async function pagarDarf() {
    setLoadingDarf(true);
    try {
      const { data, error } = await supabase.functions.invoke('inter-pagar-darf', {
        body: {
          cnpj_cpf: cnpjCpf.replace(/\D/g, ''),
          codigo_receita: codigoReceita,
          data_apuracao: dataApuracao,
          data_vencimento: dataVencimento,
          valor_principal: Number(valorPrincipal.replace(',', '.')),
          valor_multa: valorMulta ? Number(valorMulta.replace(',', '.')) : undefined,
          valor_juros: valorJuros ? Number(valorJuros.replace(',', '.')) : undefined,
          descricao: descDarf || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('DARF enviado para pagamento');
      setCodigoReceita(''); setValorPrincipal(''); setValorMulta(''); setValorJuros(''); setDescDarf('');
    } catch (e: any) {
      toast.error(`Falha no DARF: ${e?.message || e}`);
    } finally {
      setLoadingDarf(false);
    }
  }

  const boletoOk = codigoBarras.replace(/\D/g, '').length >= 44 && !!dataPagamento;
  const darfOk =
    cnpjCpf.replace(/\D/g, '').length >= 11 &&
    !!codigoReceita && !!dataApuracao && !!dataVencimento &&
    Number(valorPrincipal.replace(',', '.')) > 0;

  return (
    <Card className="border-l-4" style={{ borderLeftColor: '#FF6B00' }}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Receipt className="h-5 w-5" style={{ color: '#FF6B00' }} />
          Pagamentos Inter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Boleto */}
        <div className="space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Pagar boleto
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="cb" className="text-xs text-muted-foreground">Código de barras / linha digitável</Label>
              <Input
                id="cb" value={codigoBarras}
                onChange={(e) => setCodigoBarras(e.target.value)}
                placeholder="Cole aqui (com ou sem espaços)"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vb" className="text-xs text-muted-foreground">Valor (R$) — opcional</Label>
              <Input
                id="vb" inputMode="decimal" value={valorBoleto}
                onChange={(e) => setValorBoleto(e.target.value)}
                placeholder="usa o do boleto se vazio"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dp" className="text-xs text-muted-foreground">Data do pagamento</Label>
              <Input
                id="dp" type="date" value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="db" className="text-xs text-muted-foreground">Descrição (opcional)</Label>
              <Input id="db" value={descBoleto} onChange={(e) => setDescBoleto(e.target.value)} />
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={!boletoOk || loadingBoleto}
                style={{ backgroundColor: '#FF6B00', color: '#fff' }}
              >
                {loadingBoleto && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Pagar agora
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar pagamento de boleto</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza? Isso debitará da conta Inter na data selecionada
                  ({dataPagamento}) — {valorBoleto ? `R$ ${valorBoleto}` : 'valor do boleto'}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={pagarBoleto}>Pagar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator />

        {/* DARF */}
        <div className="space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> Pagar DARF
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cnpj" className="text-xs text-muted-foreground">CNPJ / CPF</Label>
              <Input id="cnpj" value={cnpjCpf} onChange={(e) => setCnpjCpf(e.target.value)} placeholder="somente dígitos" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cr" className="text-xs text-muted-foreground">Código da receita</Label>
              <Input id="cr" value={codigoReceita} onChange={(e) => setCodigoReceita(e.target.value)} placeholder="ex: 0220" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="da" className="text-xs text-muted-foreground">Data de apuração</Label>
              <Input id="da" type="date" value={dataApuracao} onChange={(e) => setDataApuracao(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dv" className="text-xs text-muted-foreground">Data de vencimento</Label>
              <Input id="dv" type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vp" className="text-xs text-muted-foreground">Valor principal (R$)</Label>
              <Input id="vp" inputMode="decimal" value={valorPrincipal} onChange={(e) => setValorPrincipal(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vm" className="text-xs text-muted-foreground">Multa (R$) — opcional</Label>
              <Input id="vm" inputMode="decimal" value={valorMulta} onChange={(e) => setValorMulta(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vj" className="text-xs text-muted-foreground">Juros (R$) — opcional</Label>
              <Input id="vj" inputMode="decimal" value={valorJuros} onChange={(e) => setValorJuros(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="dd" className="text-xs text-muted-foreground">Descrição (opcional)</Label>
              <Input id="dd" value={descDarf} onChange={(e) => setDescDarf(e.target.value)} />
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={!darfOk || loadingDarf}
                style={{ backgroundColor: '#FF6B00', color: '#fff' }}
              >
                {loadingDarf && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Pagar DARF
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar pagamento de DARF</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza? Isso debitará R$ {valorPrincipal} (+ multa/juros)
                  da conta Inter no vencimento {dataVencimento}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={pagarDarf}>Pagar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
