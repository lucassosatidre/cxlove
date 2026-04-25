import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';

export function useScreenContext() {
  const location = useLocation();

  return useMemo(() => {
    const path = location.pathname;
    let pageName = 'Desconhecida';

    if (path === '/') pageName = 'Painel principal';
    else if (path.startsWith('/admin/auditoria/match')) pageName = 'Auditoria do Match';
    else if (path.startsWith('/admin/auditoria/ifood')) pageName = 'Auditoria iFood (Cresol)';
    else if (path.startsWith('/admin/auditoria/voucher')) pageName = 'Auditoria Vouchers';
    else if (path.startsWith('/admin/auditoria/importar')) pageName = 'Importação de extratos';
    else if (path.startsWith('/admin/auditoria')) pageName = 'Dashboard Auditoria de Taxas';
    else if (path.startsWith('/tele')) pageName = 'Operação Tele';
    else if (path.startsWith('/salao')) pageName = 'Operação Salão';
    else if (path.startsWith('/admin/maquininhas')) pageName = 'Maquininhas';
    else if (path.startsWith('/admin/usuarios')) pageName = 'Usuários';
    else if (path.startsWith('/admin/clau')) pageName = 'Memória da Clau';
    else if (path.startsWith('/admin/entregadores')) pageName = 'Gestão de Entregadores';

    return {
      page: pageName,
      path: path,
    };
  }, [location.pathname]);
}
