import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ALL_MENU_KEYS } from "@/lib/menu-config";

export interface MenuPermission {
  menu_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

interface PermissionsContextType {
  permissions: MenuPermission[];
  loading: boolean;
  canView: (menuKey: string) => boolean;
  canCreate: (menuKey: string) => boolean;
  canEdit: (menuKey: string) => boolean;
  canDelete: (menuKey: string) => boolean;
  refetch: () => void;
}

const PermissionsContext = createContext<PermissionsContextType>({
  permissions: [], loading: true,
  canView: () => false, canCreate: () => false, canEdit: () => false, canDelete: () => false,
  refetch: () => {},
});

export const usePermissions = () => useContext(PermissionsContext);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<MenuPermission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = async () => {
    if (!user) { setPermissions([]); setLoading(false); return; }
    const { data } = await supabase
      .from("menu_permissions")
      .select("menu_key, can_view, can_create, can_edit, can_delete")
      .eq("user_id", user.id);

    if (!data || data.length === 0) {
      const rows = ALL_MENU_KEYS.map((key) => ({
        user_id: user.id, menu_key: key, can_view: true, can_create: true, can_edit: true, can_delete: true,
      }));
      await supabase.from("menu_permissions").insert(rows);
      setPermissions(ALL_MENU_KEYS.map((key) => ({
        menu_key: key, can_view: true, can_create: true, can_edit: true, can_delete: true,
      })));
    } else {
      setPermissions(data.map((d) => ({
        menu_key: d.menu_key,
        can_view: d.can_view ?? false, can_create: d.can_create ?? false,
        can_edit: d.can_edit ?? false, can_delete: d.can_delete ?? false,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchPermissions(); }, [user]);

  const find = (key: string) => permissions.find((p) => p.menu_key === key);
  const getParent = (key: string) => key.split(".").slice(0, -1).join(".");
  const findWithParent = (key: string) =>
    find(key) ?? (key.includes(".") ? find(getParent(key)) : undefined);
  const canView = (key: string) => find(key)?.can_view ?? false;
  const canCreate = (key: string) => findWithParent(key)?.can_create ?? false;
  const canEdit = (key: string) => findWithParent(key)?.can_edit ?? false;
  const canDelete = (key: string) => findWithParent(key)?.can_delete ?? false;

  return (
    <PermissionsContext.Provider value={{ permissions, loading, canView, canCreate, canEdit, canDelete, refetch: fetchPermissions }}>
      {children}
    </PermissionsContext.Provider>
  );
};
