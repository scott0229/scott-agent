// Shared US-market trading-day helpers. Single source of truth for the holiday
// calendar so the roll dialog, the 展期觀察 chunk, and the group dialog all agree
// on 展 N 天 (e.g. Jun18→Jun22 is 1 trading day, not 2, because 6/19 is Juneteenth).
export const US_MARKET_HOLIDAYS = new Set([
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19',
  '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19',
  '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'
])

// Trading days between two YYYYMMDD dates — weekends AND US market holidays
// excluded. Returns null if either date is missing/short, 0 if to == from, and a
// NEGATIVE count when `to` is before `from` (a backward roll to a nearer expiry,
// e.g. a 展 -1 天 rule).
export function rollTradingDays(from?: string, to?: string | null): number | null {
  if (!from || from.length < 8 || !to || to.length < 8) return null
  const d1 = new Date(
    `${from.substring(0, 4)}-${from.substring(4, 6)}-${from.substring(6, 8)}T00:00:00`
  )
  const d2 = new Date(
    `${to.substring(0, 4)}-${to.substring(4, 6)}-${to.substring(6, 8)}T00:00:00`
  )
  if (d2.getTime() === d1.getTime()) return 0
  const forward = d2.getTime() > d1.getTime()
  const cur = new Date(forward ? d1 : d2)
  const endTime = (forward ? d2 : d1).getTime()
  let count = 0
  while (cur.getTime() < endTime) {
    cur.setDate(cur.getDate() + 1)
    const dow = cur.getDay() // 0 = Sun, 6 = Sat
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    if (dow !== 0 && dow !== 6 && !US_MARKET_HOLIDAYS.has(ds)) count++
  }
  return forward ? count : -count
}

// Return the YYYYMMDD that is `n` trading days from `from` (weekends + US
// holidays skipped). n = 0 returns `from` unchanged; NEGATIVE n steps BACKWARD
// to a nearer expiry (e.g. 展 -1 天). Used to turn a relative "展 N 天" observe
// rule into a concrete target expiry.
export function addTradingDays(from: string, n: number): string {
  if (!from || from.length < 8 || n === 0) return from
  const cur = new Date(
    `${from.substring(0, 4)}-${from.substring(4, 6)}-${from.substring(6, 8)}T00:00:00`
  )
  const step = n > 0 ? 1 : -1
  const target = Math.abs(n)
  let moved = 0
  while (moved < target) {
    cur.setDate(cur.getDate() + step)
    const dow = cur.getDay()
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    if (dow !== 0 && dow !== 6 && !US_MARKET_HOLIDAYS.has(ds)) moved++
  }
  return `${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, '0')}${String(cur.getDate()).padStart(2, '0')}`
}
