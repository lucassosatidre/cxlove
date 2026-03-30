import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type AppRole = 'admin' | 'caixa_tele' | 'caixa_salao' | 'entregador';

export function useUserRole() {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!error && data) {
        setRole(data.role as AppRole);
      }
      setLoading(false);
    };

    fetchRole();
  }, [user]);

  const isAdmin = role === 'admin';
  const isCaixaTele = role === 'caixa_tele';
  const isCaixaSalao = role === 'caixa_salao';
  const isEntregador = role === 'entregador';

  return { role, isAdmin, isCaixaTele, isCaixaSalao, isEntregador, loading };
}
