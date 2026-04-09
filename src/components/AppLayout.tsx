import { ReactNode, useState, useEffect } from 'react';
import AppSidebar from './AppSidebar';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  headerActions?: ReactNode;
}

export default function AppLayout({ children, title, subtitle, headerActions }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cx-sidebar-collapsed') === 'true';
    }
    return false;
  });
  const { isAdmin } = useUserRole();
  const [noScheduleAlert, setNoScheduleAlert] = useState(false);

  const handleToggleCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('cx-sidebar-collapsed', String(next));
      return next;
    });
  };

  // Check if today has shifts configured (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    const checkTodaySchedule = async () => {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const { count } = await supabase
        .from('delivery_shifts')
        .select('*', { count: 'exact', head: true })
        .eq('data', todayStr);
      setNoScheduleAlert((count || 0) === 0);
    };
    checkTodaySchedule();
  }, [isAdmin]);

  const sidebarWidth = isMobile ? '' : sidebarCollapsed ? 'ml-16' : 'ml-56';

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        open={!isMobile || sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={!isMobile && sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
      />

      <div className={`transition-all duration-300 ${sidebarWidth}`}>
        {/* Mobile header with hamburger */}
        {isMobile && (
          <header className="sticky top-0 z-10 bg-sidebar px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setSidebarOpen(true)} className="text-sidebar-foreground">
                <Menu className="h-5 w-5" />
              </button>
              <span className="text-sm font-bold text-sidebar-accent-foreground">Conferência</span>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell />
            </div>
          </header>
        )}

        {/* Desktop notification bell + theme toggle */}
        {!isMobile && (
          <div className="absolute top-4 right-6 z-10 flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
          </div>
        )}

        {/* Admin alert: no schedule for today */}
        {isAdmin && noScheduleAlert && (
          <div className="mx-4 sm:mx-8 mt-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 flex items-center gap-2">
            <span>⚠️</span>
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
              Atenção: não há escala de entregadores configurada para hoje ({format(new Date(), 'dd/MM')})
            </p>
          </div>
        )}

        {title && (
          <header className="px-4 sm:px-8 pt-6 sm:pt-8 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
              </div>
              {headerActions && <div className="flex items-center gap-3">{headerActions}</div>}
            </div>
          </header>
        )}
        <main className="px-4 sm:px-8 py-4 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
