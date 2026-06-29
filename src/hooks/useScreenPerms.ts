import { useUserRole } from '@/hooks/useUserRole';
import { usePermissions } from '@/contexts/PermissionsContext';

/**
 * Combina o papel admin (via useUserRole) com os grants granulares
 * (menu_permissions). Admins reais NUNCA perdem poder: o helper sempre
 * faz OR com isAdmin.
 *
 * Use a chave da TELA (ex.: 'op.tele', 'op.salao', 'op.entregadores',
 * 'op.maquininhas', 'fluxo_caixa', 'audit.*') para gatear ações.
 */
export function useScreenPerms(key: string) {
  const { isAdmin } = useUserRole();
  const { canView, canCreate, canEdit, canDelete } = usePermissions();
  return {
    isAdmin,
    canSee: isAdmin || canView(key),
    canCreate: isAdmin || canCreate(key),
    canEdit: isAdmin || canEdit(key),
    canDelete: isAdmin || canDelete(key),
  };
}
