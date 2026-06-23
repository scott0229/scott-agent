// Symbol ordering for filter dropdowns: QQQ, QLD, TQQQ first (in that order),
// the rest A→Z. Shared by the 批次交易 / 帳戶總覽 filters, the 交易記錄 filter, and
// the 昨日成交 groups so every 標的 list uses the same order.
export const SYMBOL_SORT_RANK: Record<string, number> = { QQQ: 0, QLD: 1, TQQQ: 2 }

export const compareSymbols = (a: string, b: string): number => {
  const ra = SYMBOL_SORT_RANK[a] ?? 99
  const rb = SYMBOL_SORT_RANK[b] ?? 99
  return ra !== rb ? ra - rb : a.localeCompare(b)
}
