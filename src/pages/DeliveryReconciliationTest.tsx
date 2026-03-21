import { TestModeProvider } from '@/hooks/useTestMode';
import DeliveryReconciliation from './DeliveryReconciliation';

export default function DeliveryReconciliationTest() {
  return (
    <TestModeProvider isTest={true}>
      <DeliveryReconciliation />
    </TestModeProvider>
  );
}
