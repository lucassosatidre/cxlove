import { useState } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Lock, LockOpen } from 'lucide-react';

export function CloseConfirmDialog({
  open, onOpenChange, periodLabel, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  periodLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const ok = text.trim().toUpperCase() === 'FECHAR';

  const handle = async () => {
    if (!ok) return;
    setLoading(true);
    try { await onConfirm(); setText(''); } finally { setLoading(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!loading) { onOpenChange(o); if (!o) setText(''); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" /> Fechar Período — {periodLabel}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>Fechar o período <strong>trava o mês</strong>:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Uma cópia (backup) do relatório contábil é salva neste momento</li>
                <li>A tela de Relatórios passa a mostrar esse backup — os números <strong>não mudam mais</strong>, mesmo que arquivos sejam reimportados</li>
                <li>Nenhuma nova importação ou reexecução de auditoria deve ser feita num mês fechado</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Precisa mexer de novo? Use "Reabrir o mês": o período volta a ficar aberto,
                e o backup do fechamento é mantido no histórico. Apenas administradores podem reabrir.
              </p>
              <div className="space-y-1.5 pt-2">
                <label className="text-xs font-medium">Digite "FECHAR" para confirmar:</label>
                <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus disabled={loading} />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <Button onClick={handle} disabled={!ok || loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Fechar Período
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ReopenDialog({
  open, onOpenChange, periodLabel, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  periodLabel: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const ok = reason.trim().length >= 10;

  const handle = async () => {
    if (!ok) return;
    setLoading(true);
    try { await onConfirm(reason.trim()); setReason(''); } finally { setLoading(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!loading) { onOpenChange(o); if (!o) setReason(''); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <LockOpen className="h-5 w-5" /> Reabrir o mês — {periodLabel}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Reabrir destrava o mês: o período volta ao status <strong>aberto</strong> e
                será preciso reexecutar a auditoria em Importações para gerar relatórios de novo.
              </p>
              <p className="text-xs text-muted-foreground">
                O backup salvo no fechamento é <strong>mantido</strong> e esta reabertura será registrada no histórico.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Motivo da reabertura (obrigatório, mínimo 10 caracteres):</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} disabled={loading} autoFocus />
                <p className="text-xs text-muted-foreground">{reason.trim().length}/10 caracteres mínimos</p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <Button onClick={handle} disabled={!ok || loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
            Reabrir o mês
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
