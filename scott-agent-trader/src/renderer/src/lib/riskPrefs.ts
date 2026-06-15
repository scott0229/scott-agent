// Risk-warning preferences. Each rule has an on/off toggle and an editable
// threshold. localStorage is the synchronous cache; changes are mirrored to D1
// (via notifyPrefChange → the settings hook) so they sync across builds/devices.

import { notifyPrefChange } from './prefsSync'

function getBool(key: string): boolean {
  return localStorage.getItem(key) !== 'false' // default on
}
function setBool(key: string, enabled: boolean): void {
  localStorage.setItem(key, enabled ? 'true' : 'false')
  notifyPrefChange()
}
function getNum(key: string, def: number): number {
  const raw = localStorage.getItem(key)
  const n = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : def
}
function setNum(key: string, v: number): void {
  localStorage.setItem(key, String(v))
  notifyPrefChange()
}

export type RiskKind = 'rollDays' | 'strikePct' | 'breach'

export interface RiskRuleDef {
  id: string
  symbol: string
  kind: RiskKind
  enabledKey: string
  thresholdKey: string
  defaultThreshold: number
  // The Settings label is rendered as: labelBefore + [editable number] + labelAfter
  labelBefore: string
  labelAfter: string
  step: number
}

export const RISK_RULES: RiskRuleDef[] = [
  {
    id: 'qqqDays',
    symbol: 'QQQ',
    kind: 'rollDays',
    enabledKey: 'trader.warnQqqLongRoll',
    thresholdKey: 'trader.thQqqLongRoll',
    defaultThreshold: 2,
    labelBefore: 'QQQ 展期天數超過',
    labelAfter: '時將有提示',
    step: 1
  },
  {
    id: 'tqqqDays',
    symbol: 'TQQQ',
    kind: 'rollDays',
    enabledKey: 'trader.warnTqqqLongRoll',
    thresholdKey: 'trader.thTqqqLongRoll',
    defaultThreshold: 5,
    labelBefore: 'TQQQ 展期天數超過',
    labelAfter: '時將有提示',
    step: 1
  },
  {
    id: 'qqqStrike',
    symbol: 'QQQ',
    kind: 'strikePct',
    enabledKey: 'trader.warnQqqLargeStrike',
    thresholdKey: 'trader.thQqqLargeStrike',
    defaultThreshold: 0.5,
    labelBefore: 'QQQ 滾動行權價超過',
    labelAfter: '% 將有提示',
    step: 0.1
  },
  {
    id: 'tqqqStrike',
    symbol: 'TQQQ',
    kind: 'strikePct',
    enabledKey: 'trader.warnTqqqLargeStrike',
    thresholdKey: 'trader.thTqqqLargeStrike',
    defaultThreshold: 3,
    labelBefore: 'TQQQ 滾動行權價超過',
    labelAfter: '% 將有提示',
    step: 0.1
  },
  {
    id: 'qqqBreach',
    symbol: 'QQQ',
    kind: 'breach',
    enabledKey: 'trader.warnQqqBreachNoImprove',
    thresholdKey: 'trader.thQqqBreach',
    defaultThreshold: 0.5,
    labelBefore: 'QQQ 被突破',
    labelAfter: '%，滾動不改善將提示',
    step: 0.1
  },
  {
    id: 'tqqqBreach',
    symbol: 'TQQQ',
    kind: 'breach',
    enabledKey: 'trader.warnTqqqBreachNoImprove',
    thresholdKey: 'trader.thTqqqBreach',
    defaultThreshold: 5,
    labelBefore: 'TQQQ 被突破',
    labelAfter: '%，滾動不改善將提示',
    step: 0.1
  }
]

export const getRuleEnabled = (r: RiskRuleDef): boolean => getBool(r.enabledKey)
export const setRuleEnabled = (r: RiskRuleDef, v: boolean): void => setBool(r.enabledKey, v)
export const getRuleThreshold = (r: RiskRuleDef): number => getNum(r.thresholdKey, r.defaultThreshold)
export const setRuleThreshold = (r: RiskRuleDef, v: number): void => setNum(r.thresholdKey, v)

export interface SymbolRiskRules {
  rollDays?: { threshold: number; get: () => boolean }
  strikePct?: { threshold: number; get: () => boolean }
  breachNoImprove?: { threshold: number; get: () => boolean }
}

// Built fresh each call so the roll dialog always sees the latest edited values.
export function getSymbolRiskRules(symbol: string): SymbolRiskRules {
  const out: SymbolRiskRules = {}
  for (const r of RISK_RULES) {
    if (r.symbol !== symbol) continue
    const entry = { threshold: getRuleThreshold(r), get: (): boolean => getRuleEnabled(r) }
    if (r.kind === 'rollDays') out.rollDays = entry
    else if (r.kind === 'strikePct') out.strikePct = entry
    else if (r.kind === 'breach') out.breachNoImprove = entry
  }
  return out
}
