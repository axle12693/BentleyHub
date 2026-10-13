'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useHub } from './hub';

/** For pages sitters may not use. True while the visitor is a sitter: render nothing, they are being redirected. */
export function useBlockSitter(): boolean {
  const { isSitter } = useHub();
  const router = useRouter();
  useEffect(() => {
    if (isSitter) router.replace('/');
  }, [isSitter, router]);
  return isSitter;
}
