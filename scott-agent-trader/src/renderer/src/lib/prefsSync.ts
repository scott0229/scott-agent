// Bridges the localStorage-backed risk/observe preferences to D1 so they sync
// across builds (dev vs packaged), reinstalls, and devices — instead of silently
// resetting to defaults. localStorage stays the synchronous read cache; D1 is the
// source of truth. On load we hydrate localStorage from D1; on every edit we push
// the whole `trader.*` blob back to D1 (debounced by the caller).

const PREFIX = 'trader.'
// Prefixes that mark a *user-tuned* setting (risk thresholds + observe rules),
// vs incidental trader.* keys. Used to decide whether a device has real settings
// worth seeding into an empty D1.
const MEANINGFUL = ['trader.obs', 'trader.warn', 'trader.th']

// All trader.* localStorage entries as a flat {key: value} object.
export function collectTraderPrefs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(PREFIX)) {
      const v = localStorage.getItem(k)
      if (v != null) out[k] = v
    }
  }
  return out
}

// True if this device has any user-tuned risk/observe value stored locally.
export function hasUserPrefs(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && MEANINGFUL.some((p) => k.startsWith(p))) return true
  }
  return false
}

// Write a D1 blob into localStorage. Returns true if anything actually changed
// (so the caller can force a re-render of synchronous consumers). Writes go
// straight to localStorage — NOT through the setters — so they don't echo back
// out as a change event (no save feedback loop).
export function hydrateTraderPrefs(obj: Record<string, unknown>): boolean {
  let changed = false
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') continue
    if (localStorage.getItem(k) !== v) {
      localStorage.setItem(k, v)
      changed = true
    }
  }
  return changed
}

// pub/sub: pref setters call notifyPrefChange() after writing localStorage; the
// settings hook registers a debounced D1 push via onPrefChange().
let listeners: Array<() => void> = []
export function onPrefChange(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((l) => l !== cb)
  }
}
export function notifyPrefChange(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* ignore */
    }
  }
}
