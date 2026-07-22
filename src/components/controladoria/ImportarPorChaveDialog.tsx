import { useState } from 'react';
import { Loader2, ScanLine, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Aviso = { tipo: 'espera' | 'erro'; texto: string };

export default function ImportarPorChaveDialog({
  open, onClose, onImported,
}: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const digits = raw.replace(/\D/g, '');

  function fechar() {
    setRaw('');
    setAviso(null);
    onClose();
  }

  async function importar() {
    if (digits.length !== 44) {
      toast.error('A chave precisa ter 44 dígitos.');
      return;
    }
    setLoading(true);
    setAviso(null);
    try {
      const { data, error } = await supabase.functions.invoke('espiao-sync-entrada', {
        body: { chave: digits },
      });
      if (error) throw error;
      if (data?.ok) {
        if (data.imported > 0) toast.success('Nota importada com sucesso.');
        else toast.info(data.message || 'Essa nota já estava importada.');
        setRaw('');
        setAviso(null);
        onImported();
        onClose();
      } else {
        const msg: string = data?.message || 'Não foi possível importar a nota.';
        const naoDisponivel = /não encontrada|nao encontrada|espião|espiao/i.test(msg);
        if (naoDisponivel) {
          setAviso({
            tipo: 'espera',
            texto:
              'Essa nota ainda não foi disponibilizada pelo Espião. Notas recém-emitidas costumam levar algumas horas para aparecer — o sistema busca sozinho de hora em hora. É só tentar de novo mais tarde que ela entra completa, com as parcelas.',
          });
        } else {
          setAviso({ tipo: 'erro', texto: msg });
        }
      }
    } catch (e: any) {
      setAviso({ tipo: 'erro', texto: `Erro: ${e?.message ?? e}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) fechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Importar nota por chave</DialogTitle>
          <DialogDescription>
            Escaneie o código de barras da DANFE (com um leitor) ou digite/cole a chave de acesso de 44 dígitos.
            A nota é buscada no Espião e entra como pendente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Chave de acesso / código de barras</Label>
          <Input
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); importar(); } }}
            placeholder="Chave de 44 dígitos"
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">{digits.length}/44 dígitos</p>
        </div>

        {aviso && (
          <div
            className={
              aviso.tipo === 'espera'
                ? 'flex gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200'
                : 'flex gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200'
            }
          >
            {aviso.tipo === 'espera'
              ? <Clock className="h-4 w-4 mt-0.5 shrink-0" />
              : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <span>{aviso.texto}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={fechar} disabled={loading}>Fechar</Button>
          <Button onClick={importar} disabled={loading || digits.length !== 44}>
            {loading
              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Buscando…</>
              : aviso?.tipo === 'espera' ? 'Tentar de novo' : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
