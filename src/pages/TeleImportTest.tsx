import { TestModeProvider } from '@/hooks/useTestMode';
import TeleImport from './TeleImport';

export default function TeleImportTest() {
  return (
    <TestModeProvider isTest={true}>
      <TeleImport />
    </TestModeProvider>
  );
}
