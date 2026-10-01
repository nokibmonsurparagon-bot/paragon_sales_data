import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { ApiError } from '../api/client';

type Severity = 'success' | 'info' | 'warning' | 'error';
interface Message {
  id: number;
  text: string;
  severity: Severity;
}

interface NotifierValue {
  notify(text: string, severity?: Severity): void;
  notifyError(err: unknown): void;
}

const Ctx = createContext<NotifierValue | null>(null);

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
    const ref = err.requestId && err.status >= 500 ? ` (ref ${err.requestId})` : '';
    return (detail && err.code === 'VALIDATION_ERROR' ? `${err.message} – ${detail}` : err.message) + ref;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function NotifierProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Message | null>(null);
  const notify = useCallback((text: string, severity: Severity = 'success') => setMsg({ id: Date.now(), text, severity }), []);
  const notifyError = useCallback((err: unknown) => notify(errorText(err), 'error'), [notify]);

  return (
    <Ctx.Provider value={{ notify, notifyError }}>
      {children}
      <Snackbar
        key={msg?.id}
        open={!!msg}
        autoHideDuration={msg?.severity === 'error' ? 8000 : 4000}
        onClose={(_e, reason) => reason !== 'clickaway' && setMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={msg?.severity ?? 'info'} variant="filled" onClose={() => setMsg(null)} sx={{ maxWidth: 640 }}>
          {msg?.text}
        </Alert>
      </Snackbar>
    </Ctx.Provider>
  );
}

export function useNotifier(): NotifierValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifier must be used inside <NotifierProvider>');
  return ctx;
}
