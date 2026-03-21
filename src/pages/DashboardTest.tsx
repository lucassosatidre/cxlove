import { TestModeProvider } from '@/hooks/useTestMode';
import Dashboard from './Dashboard';

export default function DashboardTest() {
  return (
    <TestModeProvider isTest={true}>
      <Dashboard />
    </TestModeProvider>
  );
}
