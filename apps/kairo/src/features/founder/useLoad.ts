import { useCallback, useEffect, useRef, useState } from 'react';

/** Load once per dependency change; keeps the last good data visible while reloading; ignores stale responses. */
export function useLoad<T>(fn: (fresh: boolean) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback((fresh = false) => {
    const id = ++seq.current;
    setLoading(true); setError(null);
    fn(fresh).then((d) => { if (id === seq.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (id === seq.current) { setError(e); setLoading(false); } });
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: () => run(true) };
}
