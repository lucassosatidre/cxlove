import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, LogOut, FileSpreadsheet, Clock } from 'lucide-react';

interface ImportRow {
  id: string;
  created_at: string;
  file_name: string;
  total_rows: number;
  status: string;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadImports();
  }, []);

  const loadImports = async () => {
    const { data } = await supabase
      .from('imports')
      .select('*')
      .order('created_at', { ascending: false });
    setImports(data || []);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <FileSpreadsheet className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">Conferência Saipos</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Histórico de Importações</h2>
          <Button onClick={() => navigate('/import')}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Importação
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-lg shadow-card">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhuma importação realizada</h3>
            <p className="text-sm text-muted-foreground mb-6">Importe seu primeiro relatório do Saipos para começar.</p>
            <Button onClick={() => navigate('/import')}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Importação
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {imports.map((imp) => (
              <button
                key={imp.id}
                onClick={() => navigate(`/reconciliation/${imp.id}`)}
                className="w-full text-left bg-card rounded-lg shadow-card p-4 hover:shadow-card-lg row-transition flex items-center justify-between group"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                    <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground group-hover:text-primary row-transition">{imp.file_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {new Date(imp.created_at).toLocaleString('pt-BR')}
                      </span>
                      <span className="text-xs text-muted-foreground">• {imp.total_rows} pedidos</span>
                    </div>
                  </div>
                </div>
                <Badge variant={imp.status === 'completed' ? 'default' : 'secondary'} className={imp.status === 'completed' ? 'bg-success text-success-foreground' : 'bg-warning/15 text-warning border-warning/30'}>
                  {imp.status === 'completed' ? 'Concluído' : 'Pendente'}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
