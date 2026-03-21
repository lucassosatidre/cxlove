import { createContext, useContext, ReactNode } from 'react';

interface TestModeContextValue {
  isTestMode: boolean;
}

const TestModeContext = createContext<TestModeContextValue>({ isTestMode: false });

export function TestModeProvider({ children, isTest }: { children: ReactNode; isTest: boolean }) {
  return (
    <TestModeContext.Provider value={{ isTestMode: isTest }}>
      {children}
    </TestModeContext.Provider>
  );
}

export function useTestMode() {
  return useContext(TestModeContext);
}
