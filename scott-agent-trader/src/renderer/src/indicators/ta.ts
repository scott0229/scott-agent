// Technical Analysis utilities ported from Pine Script ta.*

/** Exponential Moving Average */
export function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = new Array(values.length).fill(NaN)
  let ema = NaN
  for (let i = 0; i < values.length; i++) {
    if (isNaN(values[i])) continue
    if (isNaN(ema)) {
      // Seed with SMA of first `period` values
      if (i + 1 >= period) {
        let sum = 0
        for (let j = i - period + 1; j <= i; j++) sum += values[j]
        ema = sum / period
      } else {
        continue
      }
    } else {
      ema = values[i] * k + ema * (1 - k)
    }
    result[i] = ema
  }
  return result
}

export interface BBResult {
  mid: number[]
  upper: number[]
  lower: number[]
}

/** Bollinger Bands using Simple Moving Average */
export function calcBB(values: number[], period: number, stdDevMult: number): BBResult {
  const n = values.length
  const mid: number[] = new Array(n).fill(NaN)
  const upper: number[] = new Array(n).fill(NaN)
  const lower: number[] = new Array(n).fill(NaN)

  for (let i = period - 1; i < n; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    const avg = sum / period
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - avg) ** 2
    const sd = Math.sqrt(variance / period)
    mid[i] = avg
    upper[i] = avg + stdDevMult * sd
    lower[i] = avg - stdDevMult * sd
  }
  return { mid, upper, lower }
}

/** Returns true if series a crossed above series b at offset bars ago (0 = current bar) */
export function crossover(a: number[], b: number[], index: number, offset = 0): boolean {
  const i = index - offset
  if (i < 1) return false
  return a[i] > b[i] && a[i - 1] <= b[i - 1]
}

/** Returns true if series a crossed below series b at offset bars ago */
export function crossunder(a: number[], b: number[], index: number, offset = 0): boolean {
  const i = index - offset
  if (i < 1) return false
  return a[i] < b[i] && a[i - 1] >= b[i - 1]
}

/** CAGR: Compound Annual Growth Rate */
export function calcCAGR(startMs: number, startVal: number, endMs: number, endVal: number): number {
  if (startVal <= 0 || endVal <= 0) return 0
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000)
  if (years <= 0) return 0
  return (Math.pow(endVal / startVal, 1 / years) - 1) * 100
}
