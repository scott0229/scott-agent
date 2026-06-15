// Local (per-device) default roll-observation rules. Each rule is a relative
// roll spec — N trading days out, M strike points — with an on/off toggle.
// Persisted in localStorage so the Settings panel and the batch-card "套用
// 預設觀察" action share them without prop-drilling.

function getBool(key: string, def = true): boolean {
  const raw = localStorage.getItem(key)
  return raw == null ? def : raw === 'true'
}
function setBool(key: string, enabled: boolean): void {
  localStorage.setItem(key, enabled ? 'true' : 'false')
}
function getNum(key: string, def: number): number {
  const raw = localStorage.getItem(key)
  const n = raw == null ? NaN : parseFloat(raw)
  return Number.isFinite(n) ? n : def
}
function setNum(key: string, v: number): void {
  localStorage.setItem(key, String(v))
}

export type DteOp = '>' | '<'

// Lead% threshold that splits the two OTM rule sets. A position leading by
// more than this is "comfortable"; below it, it's getting close to the strike.
export const LEAD_THRESHOLD_PCT = 1.5

export type ObserveCategory = 'leadFar' | 'leadNear' | 'breached'

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
  }
]

// Rules applied when the position is still OTM but leading by LESS than the
// threshold — getting close to the strike, so lean toward pulling the strike
// back for cushion.
export const OBSERVE_RULES_NEAR: ObserveRuleDef[] = [
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
  },
  {
    id: 'obsN4',
    enabledKey: 'trader.obsN4.enabled',
    hasDte: false,
    chase: true,
    dteOpKey: 'trader.obsN4.dteOp',
    dteKey: 'trader.obsN4.dte',
    daysKey: 'trader.obsN4.days',
    pointsKey: 'trader.obsN4.points',
    defaultDteOp: '>',
    defaultDte: 2,
    defaultDays: 2,
    defaultPoints: -3
  }
]

// Rules applied when the short option has been breached (現價已穿過履約價,
// i.e. ITM). Defaults lean to rolling further out / further away.
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
    defaultPoints: 1
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
    defaultPoints: 2
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
    defaultPoints: 3
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
    defaultPoints: 4
  }
]

export const getObserveEnabled = (r: ObserveRuleDef): boolean => getBool(r.enabledKey)
export const setObserveEnabled = (r: ObserveRuleDef, v: boolean): void => setBool(r.enabledKey, v)
export const getObserveDteOp = (r: ObserveRuleDef): DteOp => {
  const raw = localStorage.getItem(r.dteOpKey)
  return raw === '<' || raw === '>' ? raw : r.defaultDteOp
}
export const setObserveDteOp = (r: ObserveRuleDef, v: DteOp): void =>
  localStorage.setItem(r.dteOpKey, v)
export const getObserveDte = (r: ObserveRuleDef): number => getNum(r.dteKey, r.defaultDte)
export const setObserveDte = (r: ObserveRuleDef, v: number): void => setNum(r.dteKey, v)
export const getObserveDays = (r: ObserveRuleDef): number => getNum(r.daysKey, r.defaultDays)
export const setObserveDays = (r: ObserveRuleDef, v: number): void => setNum(r.daysKey, v)
export const getObservePoints = (r: ObserveRuleDef): number => getNum(r.pointsKey, r.defaultPoints)
export const setObservePoints = (r: ObserveRuleDef, v: number): void => setNum(r.pointsKey, v)

// The enabled rules as plain {op, dte, days, points} specs. The rule applies
// only when the position DTE satisfies `DTE op dte` (e.g. DTE > 2).
export function getEnabledObserveRules(category: ObserveCategory = 'leadFar'): Array<{
  hasDte: boolean
  chase: boolean
  op: DteOp
  dte: number
  days: number
  points: number
}> {
  const set =
    category === 'breached'
      ? OBSERVE_RULES_BREACHED
      : category === 'leadNear'
        ? OBSERVE_RULES_NEAR
        : OBSERVE_RULES
  return set.filter(getObserveEnabled).map((r) => ({
    hasDte: r.hasDte,
    chase: r.chase,
    op: getObserveDteOp(r),
    dte: getObserveDte(r),
    days: getObserveDays(r),
    points: getObservePoints(r)
  }))
}
