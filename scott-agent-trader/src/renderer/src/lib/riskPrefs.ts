// Local (per-device) risk-warning preferences. Kept in localStorage so the
// Settings toggles and the roll dialog can share them without prop-drilling
// through the whole component tree.

const KEYS = {
  qqqDays: 'trader.warnQqqLongRoll',
  tqqqDays: 'trader.warnTqqqLongRoll',
  qqqStrike: 'trader.warnQqqLargeStrike',
  tqqqStrike: 'trader.warnTqqqLargeStrike',
  qqqBreach: 'trader.warnQqqBreachNoImprove',
  tqqqBreach: 'trader.warnTqqqBreachNoImprove'
}

function getBool(key: string): boolean {
  return localStorage.getItem(key) !== 'false' // default on
}
function setBool(key: string, enabled: boolean): void {
  localStorage.setItem(key, enabled ? 'true' : 'false')
}

// QQQ / TQQQ — long-roll (展期天數) warnings.
export const getWarnQqqLongRoll = (): boolean => getBool(KEYS.qqqDays)
export const setWarnQqqLongRoll = (v: boolean): void => setBool(KEYS.qqqDays, v)
export const getWarnTqqqLongRoll = (): boolean => getBool(KEYS.tqqqDays)
export const setWarnTqqqLongRoll = (v: boolean): void => setBool(KEYS.tqqqDays, v)

// QQQ / TQQQ — large strike-move (滾動行權價 %) warnings.
export const getWarnQqqLargeStrike = (): boolean => getBool(KEYS.qqqStrike)
export const setWarnQqqLargeStrike = (v: boolean): void => setBool(KEYS.qqqStrike, v)
export const getWarnTqqqLargeStrike = (): boolean => getBool(KEYS.tqqqStrike)
export const setWarnTqqqLargeStrike = (v: boolean): void => setBool(KEYS.tqqqStrike, v)

// QQQ / TQQQ — strike breached by the underlying and the roll doesn't improve it.
export const getWarnQqqBreachNoImprove = (): boolean => getBool(KEYS.qqqBreach)
export const setWarnQqqBreachNoImprove = (v: boolean): void => setBool(KEYS.qqqBreach, v)
export const getWarnTqqqBreachNoImprove = (): boolean => getBool(KEYS.tqqqBreach)
export const setWarnTqqqBreachNoImprove = (v: boolean): void => setBool(KEYS.tqqqBreach, v)

// Per-symbol roll-risk rules. `rollDays` warns when the target is more than
// `threshold` trading days out; `strikePct` warns when the strike moves more
// than `threshold` percent. Each `get` is the on/off Settings toggle.
export interface SymbolRiskRules {
  rollDays?: { threshold: number; get: () => boolean }
  strikePct?: { threshold: number; get: () => boolean }
  // Warn when the short strike is breached (ITM) by more than `threshold`% of
  // the underlying AND the roll keeps the strike on the wrong side (a short
  // CALL not rolled up, or a short PUT not rolled down).
  breachNoImprove?: { threshold: number; get: () => boolean }
}
export const SYMBOL_RISK_RULES: Record<string, SymbolRiskRules> = {
  QQQ: {
    rollDays: { threshold: 2, get: getWarnQqqLongRoll },
    strikePct: { threshold: 0.5, get: getWarnQqqLargeStrike },
    breachNoImprove: { threshold: 0.5, get: getWarnQqqBreachNoImprove }
  },
  TQQQ: {
    rollDays: { threshold: 5, get: getWarnTqqqLongRoll },
    strikePct: { threshold: 3, get: getWarnTqqqLargeStrike },
    breachNoImprove: { threshold: 5, get: getWarnTqqqBreachNoImprove }
  }
}
