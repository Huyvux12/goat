import { createContext, useContext, useRef, useState, useSyncExternalStore } from "react";

/**
 * Home's state that must outlive one panel. A presentation change (docked, sheet, hidden behind a
 * task) mounts a new GoatBotWorkPanel, which reads where Home was from here. `position:` keys say
 * where Home was and reset when the person closes Home; `input:` keys hold what they typed or
 * chose until its form saves or cancels. Memory only, one store per chat view and bot.
 */
export interface GoatBotHomeStore {
  readonly homeKey: string;
  has(key: string): boolean;
  get(key: string): unknown;
  keys(): ReadonlyArray<string>;
  /** Writes without notifying, for values only read at mount, such as a scroll offset. */
  put(key: string, value: unknown): void;
  write(key: string, value: unknown): void;
  remove(match: (key: string) => boolean): void;
  subscribe(key: string, listener: () => void): () => void;
}

export function createGoatBotHomeStore(homeKey: string): GoatBotHomeStore {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener();
  };
  return {
    homeKey,
    has: (key) => values.has(key),
    get: (key) => values.get(key),
    keys: () => [...values.keys()],
    put: (key, value) => {
      values.set(key, value);
    },
    write(key, value) {
      // Re-inserting keeps the map in write order, which closing Home reads.
      values.delete(key);
      values.set(key, value);
      notify(key);
    },
    remove(match) {
      for (const key of values.keys()) {
        if (!match(key)) continue;
        values.delete(key);
        notify(key);
      }
    },
    subscribe(key, listener) {
      let keyListeners = listeners.get(key);
      if (keyListeners === undefined) {
        keyListeners = new Set();
        listeners.set(key, keyListeners);
      }
      keyListeners.add(listener);
      return () => {
        keyListeners.delete(listener);
        if (keyListeners.size === 0) listeners.delete(key);
      };
    },
  };
}

/** The chat view's store for this bot's Home; another bot or environment starts empty. */
export function useGoatBotHomeStore(homeKey: string): GoatBotHomeStore {
  const [store, setStore] = useState(() => createGoatBotHomeStore(homeKey));
  if (store.homeKey === homeKey) return store;
  const next = createGoatBotHomeStore(homeKey);
  setStore(next);
  return next;
}

/**
 * The person closed Home: where it was resets, Edit bot's draft goes, and typed input stays, with at
 * most one note's wording (the last one written). That leaves at most six entries: the wording and
 * the check-in form's open state, time, days, saving and error.
 */
export function closeGoatBotHome(store: GoatBotHomeStore) {
  const keep = store.keys().findLast((key) => key.startsWith("input:wording:"));
  store.remove(
    (key) =>
      key.startsWith("position:") ||
      key.startsWith("input:editBot:") ||
      (key.startsWith("input:wording:") && key !== keep),
  );
}

export const GoatBotHomeStoreContext = createContext<GoatBotHomeStore | null>(null);

const NONE = Symbol("none");
const noSubscription = () => () => {};

/**
 * `useState` kept in Home's store: a remounted panel shows it, and a write from an unmounted one (a
 * save ending after a flip) reaches the one on screen. Writing the mount's initial value removes the
 * entry. `fresh`, read at mount, ignores what is stored until the first write. Outside Home: useState.
 */
export function useGoatBotHomeState<T>(
  key: string,
  initial: T,
  options?: { readonly fresh?: boolean },
): readonly [T, (next: T | ((current: T) => T)) => void] {
  const store = useContext(GoatBotHomeStoreContext);
  const [local, setLocal] = useState(initial);
  const [mountInitial] = useState(initial);
  const [fresh, setFresh] = useState(options?.fresh === true);
  const stored = useSyncExternalStore(
    store === null ? noSubscription : (listener: () => void) => store.subscribe(key, listener),
    () => (store === null || fresh || !store.has(key) ? NONE : store.get(key)),
  );
  if (store === null) return [local, setLocal];
  const value = stored === NONE ? mountInitial : (stored as T);
  const set = (next: T | ((current: T) => T)) => {
    const current = !fresh && store.has(key) ? (store.get(key) as T) : mountInitial;
    const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
    if (Object.is(resolved, mountInitial)) store.remove((candidate) => candidate === key);
    else store.write(key, resolved);
    if (fresh) setFresh(false);
  };
  return [value, set];
}

/** A value in Home's store that never re-renders, read in callbacks: a scroll offset. */
export function useGoatBotHomeRef<T>(
  key: string,
  initial: T,
  options?: { readonly fresh?: boolean },
): { readonly get: () => T; readonly set: (value: T) => void } {
  const store = useContext(GoatBotHomeStoreContext);
  const local = useRef(initial);
  const fresh = useRef(options?.fresh === true);
  return {
    get: () =>
      store === null
        ? local.current
        : !fresh.current && store.has(key)
          ? (store.get(key) as T)
          : initial,
    set: (value) => {
      if (store === null) {
        local.current = value;
        return;
      }
      fresh.current = false;
      store.put(key, value);
    },
  };
}

/** Removes Home's entries a form owns once it saves or cancels; outside Home its state goes with it. */
export function useGoatBotHomeRemove(): (match: (key: string) => boolean) => void {
  const store = useContext(GoatBotHomeStoreContext);
  return (match) => store?.remove(match);
}
