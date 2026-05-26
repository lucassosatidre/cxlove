// Página de entrada de Auditoria. Decide pra onde redirecionar baseado no
// status do período do mês atual (ou mês na URL):
//   - conciliado/fechado → /admin/auditoria-v2/relatorios
//   - aberto/sem período → /admin/auditoria-v2/importacoes
//
// A aba Maquinona (que era a entrada antiga) agora vive em /admin/auditoria-v2/maquinona.

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';

export default function AuditEntryV2() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin) return;

    const now = new Date();
    const month = Number(searchParams.get('month')) || now.getMonth() + 1;
    const year = Number(searchParams.get('year')) || now.getFullYear();

    let active = true;
    (async () => {
      const { data } = await supabase
        .from('audit_periods')
        .select('status')
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();
      if (!active) return;
      const status = (data as any)?.status as string | undefined;
      const params = `?month=${month}&year=${year}`;
      if (status === 'conciliado' || status === 'fechado') {
        navigate(`/admin/auditoria-v2/relatorios${params}`, { replace: true });
      } else {
        navigate(`/admin/auditoria-v2/importacoes${params}`, { replace: true });
      }
    })();
    return () => { active = false; };
  }, [isAdmin, roleLoading, navigate, searchParams]);

  return (
    <AppLayout title="Auditoria">
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </AppLayout>
  );
}
