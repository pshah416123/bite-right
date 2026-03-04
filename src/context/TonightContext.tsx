import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface TonightSessionState {
  sessionId: string;
  code: string;
  participantId: string;
  sessionName?: string | null;
  participantCount?: number;
}

interface TonightContextValue {
  session: TonightSessionState | null;
  setSession: (s: TonightSessionState | null) => void;
  clearSession: () => void;
}

const TonightContext = createContext<TonightContextValue | undefined>(undefined);

export function TonightProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<TonightSessionState | null>(null);

  const setSession = useCallback((s: TonightSessionState | null) => {
    setSessionState(s);
  }, []);

  const clearSession = useCallback(() => {
    setSessionState(null);
  }, []);

  const value: TonightContextValue = {
    session,
    setSession,
    clearSession,
  };

  return (
    <TonightContext.Provider value={value}>
      {children}
    </TonightContext.Provider>
  );
}

export function useTonightSession(): TonightContextValue {
  const ctx = useContext(TonightContext);
  if (!ctx) {
    throw new Error('useTonightSession must be used within TonightProvider');
  }
  return ctx;
}
