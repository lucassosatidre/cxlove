import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

type Tab = {
  id: string;
  label: string;
  path: string;
  matchPaths?: string[];
};

const TABS: Tab[] = [
  { id: 'importacoes', label: 'Importações', path: '/admin/auditoria/importacoes' },
  { id: 'maquinona', label: 'Maquinona', path: '/admin/auditoria/maquinona', matchPaths: ['/admin/auditoria/maquinona'] },
  { id: 'vouchers', label: 'Vouchers', path: '/admin/auditoria/vouchers' },
  { id: 'brendi', label: 'Brendi', path: '/admin/auditoria/brendi' },
  { id: 'ifood', label: 'iFood Marketplace', path: '/admin/auditoria/ifood-marketplace' },
  { id: 'relatorios', label: 'Relatórios', path: '/admin/auditoria/relatorios' },
];

type Props = {
  /** Período opcional pra preservar query params month/year ao navegar */
  preserveParams?: boolean;
};

export default function AuditNavTabs({ preserveParams = true }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const search = preserveParams ? location.search : '';

  const isActive = (tab: Tab) => {
    if (tab.matchPaths) {
      return tab.matchPaths.some(p => location.pathname === p);
    }
    return location.pathname.startsWith(tab.path);
  };

  return (
    <div className="border-b border-border mb-4">
      <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Navegação de auditoria">
        {TABS.map(tab => {
          const active = isActive(tab);
          return (
            <button
              key={tab.id}
              onClick={() => navigate(`${tab.path}${search}`)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
