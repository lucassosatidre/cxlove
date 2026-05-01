import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, Loader2, ShieldAlert } from 'lucide-react';

type Action = {
  id: string;
  action_type: 'mutation' | 'invoke_function';
  payload: string;
  args: any;
  explanation: string | null;
  status: string;
  created_at: string;
};

export default function ClauPendingActions({ conversationId }: { conversationId: string }) {
  const [actions, setActions] = useState<Action[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const { data } = await supabase
      .from('clau_actions_log')
      .select('id, action_type, payload, args, explanation, status, created_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true });
    setActions((data ?? []) as Action[]);
  };

  useEffect(() => {
    refresh();
    // Polling leve: a cada 3s checa novas ações pendentes (Clau pode propor sem refresh do user)
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (action: Action) => {
    setBusy(action.id);
    try {
      // 1) Marca como approved (RPC valida admin + status)
      const { error: apprErr } = await supabase.rpc('clau_approve_action', { p_action_id: action.id });
      if (apprErr) throw apprErr;

      // 2) Executa
      if (action.action_type === 'mutation') {
        const { data, error } = await supabase.rpc('clau_exec_mutation', { p_action_id: action.id });
        if (error) throw error;
        const result = data as { rows_affected?: number } | null;
        toast({
          title: '✓ Mutação executada',
          description: `${result?.rows_affected ?? '?'} linhas afetadas`,
        });
      } else {
        // invoke_function
        const { data, error } = await supabase.functions.invoke(action.payload, {
          body: action.args ?? {},
        });
        // Marca executed/failed manualmente pra invoke
        if (error || data?.error) {
          await supabase.from('clau_actions_log').update({
            status: 'failed',
            error_message: error?.message || data?.error || 'Erro desconhecido',
          }).eq('id', action.id);
          throw new Error(error?.message || data?.error);
        }
        await supabase.from('clau_actions_log').update({
          status: 'executed',
          output: data,
        }).eq('id', action.id);
        toast({
          title: '✓ Função executada',
          description: data?.message ?? 'OK',
        });
      }
      await refresh();
    } catch (e: any) {
      toast({
        title: 'Erro ao executar',
        description: e?.message ?? 'Erro inesperado',
        variant: 'destructive',
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const reject = async (action: Action) => {
    setBusy(action.id);
    try {
      const { error } = await supabase.rpc('clau_reject_action', { p_action_id: action.id });
      if (error) throw error;
      toast({ title: 'Ação rejeitada' });
      await refresh();
    } catch (e: any) {
      toast({ title: 'Erro ao rejeitar', description: e?.message ?? 'Erro', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (actions.length === 0) return null;

  return (
    <div className="space-y-2">
      {actions.map(a => (
        <div
          key={a.id}
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <Badge variant="outline" className="text-[10px] uppercase">
              {a.action_type === 'mutation' ? 'Mutação proposta' : 'Função proposta'}
            </Badge>
          </div>
          {a.explanation && (
            <div className="text-xs">
              <strong>Justificativa:</strong> {a.explanation}
            </div>
          )}
          <div className="text-xs">
            <strong>{a.action_type === 'mutation' ? 'SQL:' : 'Função:'}</strong>
            <pre className="mt-1 bg-background border rounded p-2 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
              {a.action_type === 'mutation'
                ? a.payload
                : `${a.payload}(${JSON.stringify(a.args ?? {}, null, 2)})`}
            </pre>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              className="bg-green-600 hover:bg-green-700 text-white gap-2 h-8"
              disabled={busy === a.id}
              onClick={() => approve(a)}
            >
              {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Aprovar e executar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2 h-8"
              disabled={busy === a.id}
              onClick={() => reject(a)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Rejeitar
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
