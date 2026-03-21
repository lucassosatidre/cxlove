import { TestModeProvider } from '@/hooks/useTestMode';
import Reconciliation from './Reconciliation';

export default function ReconciliationTest() {
  return (
    <TestModeProvider isTest={true}>
      <Reconciliation />
    </TestModeProvider>
  );
}
