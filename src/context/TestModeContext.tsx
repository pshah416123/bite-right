import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface TestModeState {
  isTestMode: boolean;
  toggleTestMode: () => void;
}

const TestModeContext = createContext<TestModeState>({
  isTestMode: false,
  toggleTestMode: () => {},
});

export function TestModeProvider({ children }: { children: ReactNode }) {
  const [isTestMode, setIsTestMode] = useState(false);

  const toggleTestMode = useCallback(() => {
    if (!__DEV__) return;
    setIsTestMode((prev) => !prev);
  }, []);

  return (
    <TestModeContext.Provider value={{ isTestMode: __DEV__ ? isTestMode : false, toggleTestMode }}>
      {children}
    </TestModeContext.Provider>
  );
}

export function useTestMode(): TestModeState {
  return useContext(TestModeContext);
}
