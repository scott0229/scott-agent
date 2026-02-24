import { calcEMA, calcBB, crossover, crossunder, calcCAGR } from './ta'
import type { BarData } from '../hooks/useHistoricalData'

export interface Bar extends BarData {
  timeMs: number
}

export interface SignalPoint {
  time: number // unix seconds
  type: 'buy' | 'sell'
  price: number
}

export interface StrategyStats {
  initCap: number
  myCap: number
  myCagr: number
  myMaxDDPct: number
  myMaxDDTime: number
  bhEtfCap: number
  bhEtfCagr: number
  bhEtfMaxDDPct: number
  bhLetfCap: number
  bhLetfCagr: number
  bhLetfMaxDDPct: number
  rebaseEntryCnt: number
  rebaseExitCnt: number
  sigAddExpoCnt: number
  sigRedExpoCnt: number
  totalBarsLETFPct: number
  daysPerRebase: number
  etfPos: number
  letfPos: number
  letfCashReserve: number
  isHoldingLETF: boolean
}

export interface IndicatorResult {
  // Time-indexed arrays matching the etf bars
  etfBBUpper: (number | null)[]
  etfBBLower: (number | null)[]
  etfBBMid: (number | null)[]
  etfEMA: (number | null)[]
  letfBBUpper: (number | null)[]
  letfBBLower: (number | null)[]
  letfBBMid: (number | null)[]
  letfEMA: (number | null)[]
  signals: SignalPoint[]
  stats: StrategyStats | null
}

export interface StrategyConfig {
  bbLenETF?: number
  bbSdETF?: number
  emaLenETF?: number
  bbLenLETF?: number
  bbSdLETF?: number
  emaLenLETF?: number
  initCap?: number
  etfLimProfitEnabled?: boolean
  etfLimProfitLine?: number
  etfLimProfitInterval?: number
  etfLimProfitPct?: number
}

function parseTimeMs(bar: BarData): number {
  const t = bar.time
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return new Date(t + 'T00:00:00Z').getTime()
  }
  // YYYYMMDD
  if (/^\d{8}$/.test(t)) {
    return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00Z`).getTime()
  }
  // Numeric unix seconds
  const n = Number(t)
  if (!isNaN(n)) return n * 1000
  return new Date(t).getTime()
}

/** Align letf bars to etf bars by date string/time */
function alignBars(etfBars: BarData[], letfBars: BarData[]): [BarData[], BarData[]] {
  const letfMap = new Map<string, BarData>()
  for (const b of letfBars) letfMap.set(b.time, b)
  const aligned: BarData[] = []
  const alignedEtf: BarData[] = []
  for (const b of etfBars) {
    const l = letfMap.get(b.time)
    if (l) {
      alignedEtf.push(b)
      aligned.push(l)
    }
  }
  return [alignedEtf, aligned]
}

export function runStrategy(
  rawEtf: BarData[],
  rawLetf: BarData[],
  cfg: StrategyConfig = {}
): IndicatorResult {
  const {
    bbLenETF = 50,
    bbSdETF = 2.0,
    emaLenETF = 5,
    bbLenLETF = 50,
    bbSdLETF = 2.05,
    emaLenLETF = 5,
    initCap = 1_000_000,
    etfLimProfitEnabled = true,
    etfLimProfitLine = 0.2,
    etfLimProfitInterval = 0.05,
    etfLimProfitPct = 0.05
  } = cfg

  const [etfBars, letfBars] = alignBars(rawEtf, rawLetf)
  const n = etfBars.length
  if (n < 2) {
    return {
      etfBBUpper: [],
      etfBBLower: [],
      etfBBMid: [],
      etfEMA: [],
      letfBBUpper: [],
      letfBBLower: [],
      letfBBMid: [],
      letfEMA: [],
      signals: [],
      stats: null
    }
  }

  const etfClose = etfBars.map((b) => b.close)
  const letfClose = letfBars.map((b) => b.close)

  // ── TA calculations ──────────────────────────────
  const { upper: etfBBUp, lower: etfBBLow, mid: etfBBMidArr } = calcBB(etfClose, bbLenETF, bbSdETF)
  const etfEMAArr = calcEMA(etfClose, emaLenETF)
  const {
    upper: letfBBUp,
    lower: letfBBLow,
    mid: letfBBMidArr
  } = calcBB(letfClose, bbLenLETF, bbSdLETF)
  const letfEMAArr = calcEMA(letfClose, emaLenLETF)

  // ── Signal detection ─────────────────────────────
  const signals: SignalPoint[] = []

  // Strategy state
  const EXPO_LOW = 0
  const EXPO_HIGH = 2
  let expoLevel = EXPO_LOW
  let etfPos = 0
  let letfPos = 0
  let letfCashReserve = 0
  let etfLastRedExpoClose = 0
  let etfHighestClose = 0
  let sigAddExpoCnt = 0
  let sigRedExpoCnt = 0
  let rebaseEntryCnt = 0
  let rebaseExitCnt = 0
  let totalBarsLETF = 0
  let redMoreExpoCnt = 0

  let myTotalCap = 0
  let myMaxCap = 0
  let myMaxDD = 0
  let myMaxDDPct = 0
  let myMaxDDTime = 0
  let bhEtfCap = 0
  let bhLetfCap = 0
  let bhEtfPos = 0
  let bhLetfPos = 0
  let bhEtfMaxCap = 0
  let bhLetfMaxCap = 0
  let bhEtfMaxDD = 0
  let bhLetfMaxDD = 0
  let bhEtfMaxDDPct = 0
  let bhLetfMaxDDPct = 0

  let testStartMs = 0
  let testEndMs = 0
  let needInit = true

  for (let i = 0; i < n; i++) {
    const etfC = etfClose[i]
    const letfC = letfClose[i]
    const tMs = parseTimeMs(etfBars[i])
    const tSec = Math.floor(tMs / 1000)

    if (isNaN(etfC) || isNaN(letfC)) continue

    // ── Buy signal on ETF chart ──────────────────────
    const etfBbBreakout = [0, 1, 2, 3, 4].some((off) => crossover(etfClose, etfBBLow, i, off))
    const etfEmaBreakout = [0, 1, 2, 3].some((off) => crossover(etfClose, etfEMAArr, i, off))
    const sigAddExpo = etfBbBreakout && etfEmaBreakout

    // ── Sell signal on LETF chart ────────────────────
    const letfBbBreakout = [0, 1, 2, 3, 4].some((off) => crossunder(letfClose, letfBBUp, i, off))
    const letfEmaBreakout = [0, 1, 2, 3].some((off) => crossunder(letfClose, letfEMAArr, i, off))
    const sigRedExpo = letfBbBreakout && letfEmaBreakout

    if (sigAddExpo) sigAddExpoCnt++
    if (sigRedExpo) sigRedExpoCnt++

    // ── Portfolio simulation ─────────────────────────
    if (needInit) {
      needInit = false
      bhEtfPos = initCap / etfC
      bhLetfPos = initCap / letfC
      etfPos = initCap / etfC
      letfPos = 0
      letfCashReserve = 0
      expoLevel = EXPO_LOW
      testStartMs = tMs
      etfHighestClose = 0
    }
    testEndMs = tMs

    // Add exposure: switch from ETF -> LETF
    if (expoLevel === EXPO_LOW && sigAddExpo) {
      rebaseEntryCnt++
      expoLevel = EXPO_HIGH
      const etfReturns = etfPos * etfC
      letfPos = (etfReturns + letfCashReserve) / letfC
      letfCashReserve = 0
      etfPos = 0
      signals.push({ time: tSec, type: 'buy', price: etfC })
    }

    // Reduce exposure: switch from LETF -> ETF
    if (expoLevel === EXPO_HIGH && sigRedExpo && etfC > etfHighestClose) {
      expoLevel = EXPO_LOW
      etfLastRedExpoClose = etfC
      rebaseExitCnt++
      const letfReturns = letfPos * letfC
      etfPos = (letfReturns + letfCashReserve) / etfC
      letfCashReserve = 0
      letfPos = 0
      redMoreExpoCnt = 0
      signals.push({ time: tSec, type: 'sell', price: etfC })
    } else if (expoLevel === EXPO_LOW && rebaseExitCnt > 0 && etfLimProfitEnabled) {
      // ETF profit-taking
      const triggerPct = etfLimProfitLine + redMoreExpoCnt * etfLimProfitInterval
      if (
        etfLastRedExpoClose > 0 &&
        (etfC - etfLastRedExpoClose) / etfLastRedExpoClose > triggerPct
      ) {
        letfCashReserve += etfPos * etfLimProfitPct * etfC
        etfPos = etfPos * (1 - etfLimProfitPct)
        redMoreExpoCnt++
      }
    }

    // Track ETF highest close when in ETF mode
    if (expoLevel === EXPO_LOW && etfC > etfHighestClose) {
      etfHighestClose = etfC
    }

    // ── Update stats ─────────────────────────────────
    totalBarsLETF = expoLevel === EXPO_HIGH ? totalBarsLETF + 1 : totalBarsLETF
    myTotalCap = etfPos * etfC + letfCashReserve + letfPos * letfC
    bhEtfCap = bhEtfPos * etfC
    bhLetfCap = bhLetfPos * letfC

    if (myTotalCap > myMaxCap) myMaxCap = myTotalCap
    if (myMaxCap - myTotalCap > myMaxDD) {
      myMaxDD = myMaxCap - myTotalCap
      myMaxDDPct = (myMaxDD * 100) / myMaxCap
      myMaxDDTime = tMs
    }
    if (bhEtfCap > bhEtfMaxCap) bhEtfMaxCap = bhEtfCap
    if (bhEtfMaxCap - bhEtfCap > bhEtfMaxDD) {
      bhEtfMaxDD = bhEtfMaxCap - bhEtfCap
      bhEtfMaxDDPct = (bhEtfMaxDD * 100) / bhEtfMaxCap
    }
    if (bhLetfCap > bhLetfMaxCap) bhLetfMaxCap = bhLetfCap
    if (bhLetfMaxCap - bhLetfCap > bhLetfMaxDD) {
      bhLetfMaxDD = bhLetfMaxCap - bhLetfCap
      bhLetfMaxDDPct = (bhLetfMaxDD * 100) / bhLetfMaxCap
    }
  }

  const totalBars = n
  const myCagr = calcCAGR(testStartMs, initCap, testEndMs, myTotalCap)
  const bhEtfCagr = calcCAGR(testStartMs, initCap, testEndMs, bhEtfCap)
  const bhLetfCagr = calcCAGR(testStartMs, initCap, testEndMs, bhLetfCap)
  const daysTotal = (testEndMs - testStartMs) / (1000 * 60 * 60 * 24)
  const daysPerRebase =
    rebaseEntryCnt + rebaseExitCnt > 0 ? daysTotal / (rebaseEntryCnt + rebaseExitCnt) : 0

  const toNullable = (arr: number[]): (number | null)[] => arr.map((v) => (isNaN(v) ? null : v))

  return {
    etfBBUpper: toNullable(etfBBUp),
    etfBBLower: toNullable(etfBBLow),
    etfBBMid: toNullable(etfBBMidArr),
    etfEMA: toNullable(etfEMAArr),
    letfBBUpper: toNullable(letfBBUp),
    letfBBLower: toNullable(letfBBLow),
    letfBBMid: toNullable(letfBBMidArr),
    letfEMA: toNullable(letfEMAArr),
    signals,
    stats: {
      initCap,
      myCap: myTotalCap,
      myCagr,
      myMaxDDPct,
      myMaxDDTime,
      bhEtfCap,
      bhEtfCagr,
      bhEtfMaxDDPct,
      bhLetfCap,
      bhLetfCagr,
      bhLetfMaxDDPct,
      rebaseEntryCnt,
      rebaseExitCnt,
      sigAddExpoCnt,
      sigRedExpoCnt,
      totalBarsLETFPct: totalBars > 0 ? (totalBarsLETF * 100) / totalBars : 0,
      daysPerRebase,
      etfPos,
      letfPos,
      letfCashReserve,
      isHoldingLETF: expoLevel === EXPO_HIGH
    }
  }
}
