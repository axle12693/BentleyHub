'use client';

import { useCallback, useState } from 'react';
import { errMsg } from './api';

/** Busy/error state for a form action. `run` resolves true on success, false (with `error` set) on failure. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
