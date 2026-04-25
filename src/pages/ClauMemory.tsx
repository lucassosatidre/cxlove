import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Navigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { Brain, Save } from 'lucide-react';

export default function ClauMemory() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [content, setContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedByEmail, setUpdatedByEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMemory();
  }, []);

  async function loadMemory() {
    setLoading(true);
    const { data } = await supabase
      .from('clau_project_memory')
      .select('content, updated_at, updated_by')
      .eq('app_origin', 'cx-love')
      .maybeSingle();

    if (data) {
      setContent(data.content);
      setUpdatedAt(data.updated_at);
      setUpdatedByEmail(data.updated_by);
    }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('clau_project_memory')
      .update({
        content,
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id,
      })
      .eq('app_origin', 'cx-love');

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Memória atualizada', description: 'Clau vai ler isso na próxima conversa.' });
      loadMemory();
    }
  }

  if (roleLoading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout
      title="Memória da Clau"
      subtitle="Conteúdo lido pela assistente em toda conversa"
      headerActions={
        <Button onClick={save} disabled={saving || loading} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      }
    >
      <div className="max-w-4xl space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm flex gap-2">
          <Brain className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-300">Atenção</p>
            <p className="text-amber-700/80 dark:text-amber-300/80">
              Esta memória é injetada no prompt da Clau em toda conversa. Edite com cuidado — texto muito longo aumenta o
              custo de tokens.
            </p>
          </div>
        </div>

        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={loading}
          className="min-h-[60vh] font-mono text-sm"
          placeholder="Markdown..."
        />

        {updatedAt && (
          <p className="text-xs text-muted-foreground">
            Atualizado em {new Date(updatedAt).toLocaleString('pt-BR')}
            {updatedByEmail ? ` por ${updatedByEmail}` : ''}
          </p>
        )}
      </div>
    </AppLayout>
  );
}
