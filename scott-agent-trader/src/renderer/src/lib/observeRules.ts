// Local (per-device) default roll-observation rules. Each rule is a relative
// roll spec — N trading days out, M strike points — with an on/off toggle.
// Persisted in localStorage so the Settings panel and the batch-card "套用
// 預設觀察" action share them without prop-drilling.

import { notifyPrefChange } from './prefsSync'

function getBool(key: string, def = true): boolean {
  const raw = localStorage.getItem(key)
  return raw == null ? def : raw === 'true'
}
function setBool(key: string, enabled: boolean): void {
  localStorage.setItem(key, enabled ? 'true' : 'false')
  notifyPrefChange()
}
function getNum(key: string, def: number): number {
  const raw = localStorage.getItem(key)
  const n = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(n) ? n : def
}
function setNum(key: string, v: number): void {
  localStorage.setItem(key, String(v))
  notifyPrefChange()
}

export type DteOp = '>' | '<'
// Per-rule DTE gate shown as a 高/低/無關 selector: 'high' = remaining DTE ≥
// DTE_HIGH_THRESHOLD, 'low' = below it, 'any' = no DTE gate.
export type DteMode = 'high' | 'low' | 'any'

// Lead% thresholds that split the three OTM rule sets:
//   leadPct > HIGH            → leadFar  (comfortable, 領先 > 2%)
//   LOW ≤ leadPct ≤ HIGH      → leadMid  (領先 1%~2%)
//   leadPct < LOW             → leadNear (getting close, 領先 < 1%)
export const LEAD_HIGH_PCT = 2
export const LEAD_LOW_PCT = 1
// Breach% threshold that splits the two ITM (落後) rule sets. Breached by less
// than this is shallow; more than this is deep.
export const BREACH_THRESHOLD_PCT = 1.0
// A position's remaining DTE at/above this counts as "high" for the 高/低 gate.
export const DTE_HIGH_THRESHOLD = 3

export type ObserveCategory =
  | 'leadFar'
  | 'leadMid'
  | 'leadNear'
  | 'breachedNear'
  | 'breachedFar'

export interface ObserveRuleDef {
  id: string
  enabledKey: string
  // When false the rule has no DTE gate — it always applies and the DTE
  // field is hidden in Settings.
  hasDte: boolean
  // false → 展 N 點 (signed strike delta). true → 追 N 點 (chase: move the
  // strike N points in the breach direction — +N for calls, −N for puts).
  chase: boolean
  dteOpKey: string
  dteKey: string
  daysKey: string
  pointsKey: string
  defaultDteOp: DteOp
  defaultDte: number
  defaultDays: number
  defaultPoints: number
  // Optional: when set, the row shows a DTE 高/低/無關 selector that gates the
  // rule on the position's remaining DTE (高 = DTE ≥ DTE_HIGH_THRESHOLD).
  showDteMode?: boolean
  dteModeKey?: string
  defaultDteMode?: DteMode
}

export const OBSERVE_RULES: ObserveRuleDef[] = [
  {
    id: 'obs3',
    enabledKey: 'trader.obs3.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obs3.dteOp',
    dteKey: 'trader.obs3.dte',
    daysKey: 'trader.obs3.days',
    pointsKey: 'trader.obs3.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 0
  },
  {
    id: 'obs4',
    enabledKey: 'trader.obs4.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obs4.dteOp',
    dteKey: 'trader.obs4.dte',
    daysKey: 'trader.obs4.days',
    pointsKey: 'trader.obs4.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 1
  },
  {
    id: 'obs5',
    enabledKey: 'trader.obs5.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obs5.dteOp',
    dteKey: 'trader.obs5.dte',
    daysKey: 'trader.obs5.days',
    pointsKey: 'trader.obs5.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 2
  },
  {
    id: 'obs6',
    enabledKey: 'trader.obs6.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obs6.dteOp',
    dteKey: 'trader.obs6.dte',
    daysKey: 'trader.obs6.days',
    pointsKey: 'trader.obs6.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 3
  },
  {
    id: 'obs7',
    enabledKey: 'trader.obs7.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obs7.dteOp',
    dteKey: 'trader.obs7.dte',
    daysKey: 'trader.obs7.days',
    pointsKey: 'trader.obs7.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 4
  }
]

// Rules applied when the position is OTM and leading by a middling amount
// (領先 1%~2%) — between comfortable and getting close.
export const OBSERVE_RULES_MID: ObserveRuleDef[] = [
  {
    id: 'obsM0',
    enabledKey: 'trader.obsM0.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsM0.dteOp',
    dteKey: 'trader.obsM0.dte',
    daysKey: 'trader.obsM0.days',
    pointsKey: 'trader.obsM0.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 0,
    defaultPoints: -2
  },
  {
    id: 'obsM1',
    enabledKey: 'trader.obsM1.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsM1.dteOp',
    dteKey: 'trader.obsM1.dte',
    daysKey: 'trader.obsM1.days',
    pointsKey: 'trader.obsM1.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: -1
  },
  {
    id: 'obsM2',
    enabledKey: 'trader.obsM2.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsM2.dteOp',
    dteKey: 'trader.obsM2.dte',
    daysKey: 'trader.obsM2.days',
    pointsKey: 'trader.obsM2.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 0
  },
  {
    id: 'obsM3',
    enabledKey: 'trader.obsM3.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsM3.dteOp',
    dteKey: 'trader.obsM3.dte',
    daysKey: 'trader.obsM3.days',
    pointsKey: 'trader.obsM3.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 1
  },
  {
    id: 'obsM4',
    enabledKey: 'trader.obsM4.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsM4.dteOp',
    dteKey: 'trader.obsM4.dte',
    daysKey: 'trader.obsM4.days',
    pointsKey: 'trader.obsM4.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 2
  }
]

// Rules applied when the position is still OTM but leading by LESS than the
// low threshold — getting close to the strike, so lean toward pulling the
// strike back for cushion.
export const OBSERVE_RULES_NEAR: ObserveRuleDef[] = [
  {
    id: 'obsN0',
    enabledKey: 'trader.obsN0.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsN0.dteOp',
    dteKey: 'trader.obsN0.dte',
    daysKey: 'trader.obsN0.days',
    pointsKey: 'trader.obsN0.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 0
  },
  {
    id: 'obsN1',
    enabledKey: 'trader.obsN1.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsN1.dteOp',
    dteKey: 'trader.obsN1.dte',
    daysKey: 'trader.obsN1.days',
    pointsKey: 'trader.obsN1.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: -1
  },
  {
    id: 'obsN2',
    enabledKey: 'trader.obsN2.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsN2.dteOp',
    dteKey: 'trader.obsN2.dte',
    daysKey: 'trader.obsN2.days',
    pointsKey: 'trader.obsN2.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: -2
  },
  {
    id: 'obsN3',
    enabledKey: 'trader.obsN3.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsN3.dteOp',
    dteKey: 'trader.obsN3.dte',
    daysKey: 'trader.obsN3.days',
    pointsKey: 'trader.obsN3.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 2,
    defaultPoints: -2
  }
]

// Rules applied when the short option has been breached SHALLOWLY (落後 < 1% —
// price just past the strike). Defaults lean to rolling further out / away.
export const OBSERVE_RULES_BREACHED: ObserveRuleDef[] = [
  {
    id: 'obsB1',
    enabledKey: 'trader.obsB1.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsB1.dteOp',
    dteKey: 'trader.obsB1.dte',
    daysKey: 'trader.obsB1.days',
    pointsKey: 'trader.obsB1.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 1,
    showDteMode: true,
    dteModeKey: 'trader.obsB1.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsB2',
    enabledKey: 'trader.obsB2.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsB2.dteOp',
    dteKey: 'trader.obsB2.dte',
    daysKey: 'trader.obsB2.days',
    pointsKey: 'trader.obsB2.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 2,
    defaultPoints: 2,
    showDteMode: true,
    dteModeKey: 'trader.obsB2.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsB3',
    enabledKey: 'trader.obsB3.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsB3.dteOp',
    dteKey: 'trader.obsB3.dte',
    daysKey: 'trader.obsB3.days',
    pointsKey: 'trader.obsB3.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 5,
    defaultPoints: 3,
    showDteMode: true,
    dteModeKey: 'trader.obsB3.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsB4',
    enabledKey: 'trader.obsB4.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsB4.dteOp',
    dteKey: 'trader.obsB4.dte',
    daysKey: 'trader.obsB4.days',
    pointsKey: 'trader.obsB4.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 5,
    defaultPoints: 4,
    showDteMode: true,
    dteModeKey: 'trader.obsB4.dteMode',
    defaultDteMode: 'any'
  }
]

// Rules applied when the short option has been breached DEEPLY (落後 > 1% —
// price well past the strike). Defaults lean to rolling further still.
export const OBSERVE_RULES_BREACHED_FAR: ObserveRuleDef[] = [
  {
    id: 'obsBF0',
    enabledKey: 'trader.obsBF0.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsBF0.dteOp',
    dteKey: 'trader.obsBF0.dte',
    daysKey: 'trader.obsBF0.days',
    pointsKey: 'trader.obsBF0.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 1,
    defaultPoints: 1,
    showDteMode: true,
    dteModeKey: 'trader.obsBF0.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsBF1',
    enabledKey: 'trader.obsBF1.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsBF1.dteOp',
    dteKey: 'trader.obsBF1.dte',
    daysKey: 'trader.obsBF1.days',
    pointsKey: 'trader.obsBF1.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 2,
    defaultPoints: 2,
    showDteMode: true,
    dteModeKey: 'trader.obsBF1.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsBF2',
    enabledKey: 'trader.obsBF2.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsBF2.dteOp',
    dteKey: 'trader.obsBF2.dte',
    daysKey: 'trader.obsBF2.days',
    pointsKey: 'trader.obsBF2.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 5,
    defaultPoints: 3,
    showDteMode: true,
    dteModeKey: 'trader.obsBF2.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsBF3',
    enabledKey: 'trader.obsBF3.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsBF3.dteOp',
    dteKey: 'trader.obsBF3.dte',
    daysKey: 'trader.obsBF3.days',
    pointsKey: 'trader.obsBF3.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 5,
    defaultPoints: 5,
    showDteMode: true,
    dteModeKey: 'trader.obsBF3.dteMode',
    defaultDteMode: 'any'
  },
  {
    id: 'obsBF4',
    enabledKey: 'trader.obsBF4.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsBF4.dteOp',
    dteKey: 'trader.obsBF4.dte',
    daysKey: 'trader.obsBF4.days',
    pointsKey: 'trader.obsBF4.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 10,
    defaultPoints: 7,
    showDteMode: true,
    dteModeKey: 'trader.obsBF4.dteMode',
    defaultDteMode: 'any'
  }
]

export const getObserveEnabled = (r: ObserveRuleDef): boolean => getBool(r.enabledKey)
export const setObserveEnabled = (r: ObserveRuleDef, v: boolean): void => setBool(r.enabledKey, v)
export const getObserveDteOp = (r: ObserveRuleDef): DteOp => {
  const raw = localStorage.getItem(r.dteOpKey)
  return raw === '<' || raw === '>' ? raw : r.defaultDteOp
}
export const setObserveDteOp = (r: ObserveRuleDef, v: DteOp): void => {
  localStorage.setItem(r.dteOpKey, v)
  notifyPrefChange()
}
export const getObserveDte = (r: ObserveRuleDef): number => getNum(r.dteKey, r.defaultDte)
export const setObserveDte = (r: ObserveRuleDef, v: number): void => setNum(r.dteKey, v)
export const getObserveDays = (r: ObserveRuleDef): number => getNum(r.daysKey, r.defaultDays)
export const setObserveDays = (r: ObserveRuleDef, v: number): void => setNum(r.daysKey, v)
export const getObservePoints = (r: ObserveRuleDef): number => getNum(r.pointsKey, r.defaultPoints)
export const setObservePoints = (r: ObserveRuleDef, v: number): void => setNum(r.pointsKey, v)
// Every rule carries a DTE 高/低/無關 gate. The storage key derives from the rule
// id, so the explicit dteModeKeys still declared on the 落後 rules and the derived
// keys for every other rule resolve to the SAME `trader.<id>.dteMode` slot.
const dteModeKeyOf = (r: ObserveRuleDef): string => r.dteModeKey ?? `trader.${r.id}.dteMode`
export const getObserveDteMode = (r: ObserveRuleDef): DteMode => {
  const raw = localStorage.getItem(dteModeKeyOf(r))
  return raw === 'high' || raw === 'low' || raw === 'any' ? raw : r.defaultDteMode ?? 'any'
}
export const setObserveDteMode = (r: ObserveRuleDef, v: DteMode): void => {
  localStorage.setItem(dteModeKeyOf(r), v)
  notifyPrefChange()
}

// The enabled rules as plain {op, dte, days, points} specs. The rule applies
// only when the position DTE satisfies `DTE op dte` (e.g. DTE > 2).
export function getEnabledObserveRules(category: ObserveCategory = 'leadFar'): Array<{
  hasDte: boolean
  chase: boolean
  op: DteOp
  dte: number
  days: number
  points: number
  dteMode: DteMode
}> {
  const set =
    category === 'breachedFar'
      ? OBSERVE_RULES_BREACHED_FAR
      : category === 'breachedNear'
        ? OBSERVE_RULES_BREACHED
        : category === 'leadNear'
          ? OBSERVE_RULES_NEAR
          : category === 'leadMid'
            ? OBSERVE_RULES_MID
            : OBSERVE_RULES
  return set.filter(getObserveEnabled).map((r) => ({
    hasDte: r.hasDte,
    chase: r.chase,
    op: getObserveDteOp(r),
    dte: getObserveDte(r),
    days: getObserveDays(r),
    points: getObservePoints(r),
    dteMode: getObserveDteMode(r)
  }))
}
