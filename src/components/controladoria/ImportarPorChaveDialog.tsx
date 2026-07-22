import { useState } from 'react';
import { Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ImportarPorChaveDialog({
  open, onClose, onImported,
}: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const digits = raw.replace(/\D/g, '');

  async function importar() {
    if (digits.length !== 44) {
      toast.error('A chave precisa ter 44 dígitos.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('espiao-sync-entrada', {
        body: { chave: digits },
      });
      if (error) throw error;
      if (data?.ok) {
        if (data.imported > 0) toast.success('Nota importada com sucesso.');
        else toast.info(data.message || 'Essa nota já estava importada.');
        setRaw('');
        onImported();
        onClose();
      } else {
        toast.error(data?.message || 'Não foi possível importar a nota.');
      }
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) onClose(); }}>
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
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={importar} disabled={loading || digits.length !== 44}>
            {loading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Buscando…</> : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
