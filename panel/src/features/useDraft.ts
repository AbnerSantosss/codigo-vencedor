import { useEffect, useState } from 'react';

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Refresh clean fields while keeping local edits, including edits in other tabs. */
export function reconcileDraft<T extends object>(value: T, base: T, incoming: T): T {
  const next = { ...value };
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if (sameValue(value[key], base[key])) next[key] = incoming[key];
  }
  return next;
}

export function useDraft<T extends object>(source: T) {
  const [state, setState] = useState({ value: source, base: source });
  useEffect(() => {
    setState((s) => sameValue(s.base, source) ? s : {
      value: reconcileDraft(s.value, s.base, source), base: source,
    });
  }, [source]);
  const setValue = (update: T | ((previous: T) => T)) => setState((s) => ({
    ...s, value: typeof update === 'function' ? (update as (p: T) => T)(s.value) : update,
  }));
  const accept = (submitted: Partial<T>, saved: T) => setState((s) => {
    const value = { ...s.value }, base = { ...s.base };
    for (const key of Object.keys(submitted) as (keyof T)[]) {
      if (sameValue(value[key], submitted[key])) value[key] = saved[key];
      base[key] = saved[key];
    }
    return { value, base };
  });
  return { value: state.value, base: state.base, setValue, accept, dirty: !sameValue(state.value, state.base) };
}
