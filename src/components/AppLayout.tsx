import { ReactNode, useState, useEffect } from 'react';
import AppSidebar from './AppSidebar';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import NotificationBell from './NotificationBell';

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
              <span className="font-brand text-base tracking-[0.18em] text-sidebar-accent-foreground">VIGIA</span>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell className="relative p-2 rounded-lg text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60 transition-colors" />
            </div>
          </header>
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

        {/* Desktop header: title + page actions + notification bell (in-flow, never floating) */}
        {!isMobile ? (
          <header className="px-4 sm:px-8 pt-6 sm:pt-8 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {title && <h1 className="font-brand text-2xl sm:text-3xl text-foreground tracking-wide">{title}</h1>}
                {title && subtitle && <p className="font-title italic text-sm text-muted-foreground mt-1">{subtitle}</p>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {headerActions}
                <NotificationBell />
              </div>
            </div>
          </header>
        ) : (
          title && (
            <header className="px-4 sm:px-8 pt-6 pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="font-brand text-2xl sm:text-3xl text-foreground tracking-wide">{title}</h1>
                  {subtitle && <p className="font-title italic text-sm text-muted-foreground mt-1">{subtitle}</p>}
                </div>
                {headerActions && <div className="flex items-center gap-3 shrink-0">{headerActions}</div>}
              </div>
            </header>
          )
        )}
        <main className="px-4 sm:px-8 py-4 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
