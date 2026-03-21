import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useUserRole } from './useUserRole';

export const ALL_PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'salon', label: 'Salão' },
  { key: 'reconciliation', label: 'Conciliação' },
  { key: 'delivery_reconciliation', label: 'Conciliação Delivery' },
] as const;

export type PermissionKey = typeof ALL_PERMISSIONS[number]['key'];

export function useUserPermissions() {
  const { user } = useAuth();
  const { isAdmin, isCaixaTele, isCaixaSalao, loading: roleLoading } = useUserRole();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    if (roleLoading) return;

    // Admins have all permissions
    if (isAdmin) {
      setPermissions(ALL_PERMISSIONS.map(p => p.key));
      setLoading(false);
      return;
    }

    // Role-based fixed permissions
    if (isCaixaTele) {
      setPermissions(['dashboard']);
      setLoading(false);
      return;
    }

    if (isCaixaSalao) {
      setPermissions(['salon']);
      setLoading(false);
      return;
    }

    // Fallback: load from user_permissions table
    const fetch = async () => {
      const { data } = await supabase
        .from('user_permissions')
        .select('permission')
        .eq('user_id', user.id);

      setPermissions(data?.map(d => d.permission) || []);
      setLoading(false);
    };

    fetch();
  }, [user, isAdmin, isCaixaTele, isCaixaSalao, roleLoading]);

  const hasPermission = (key: string) => isAdmin || permissions.includes(key);

  return { permissions, hasPermission, loading };
}
