import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type AppRole = 'admin' | 'caixa_tele' | 'caixa_salao' | 'entregador' | 'lider';

export function useUserRole() {
  const { user } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRoles([]);
      setLoading(false);
      return;
    }

    const fetchRoles = async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (!error && data) {
        setRoles(data.map((r) => r.role as AppRole));
      }
      setLoading(false);
    };

    fetchRoles();
  }, [user]);

  const role: AppRole | null = roles[0] ?? null;
  const isAdmin = roles.includes('admin');
  const isCaixaTele = roles.includes('caixa_tele');
  const isCaixaSalao = roles.includes('caixa_salao');
  const isEntregador = roles.includes('entregador');
  const isLider = roles.includes('lider');

  return { role, roles, isAdmin, isCaixaTele, isCaixaSalao, isEntregador, isLider, loading };
}
