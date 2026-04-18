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
              <p>Ao fechar este período:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Nenhuma nova importação poderá ser feita</li>
                <li>A conciliação não poderá ser reexecutada</li>
                <li>Apenas visualização e exportação serão permitidas</li>
              </ul>
              <p className="text-xs text-muted-foreground">Apenas administradores poderão reabrir.</p>
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
            <LockOpen className="h-5 w-5" /> Reabrir Período — {periodLabel}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>Esta ação será registrada no histórico.</p>
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
            Reabrir Período
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
