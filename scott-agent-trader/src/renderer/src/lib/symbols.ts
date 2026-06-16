// Symbol ordering for filter dropdowns: QQQ first, TQQQ second, the rest A→Z.
// Shared by the 批次交易 / 帳戶總覽 filters and the 交易記錄 filter so every
// 標的 dropdown lists symbols in the same order.
export const SYMBOL_SORT_RANK: Record<string, number> = { QQQ: 0, TQQQ: 1 }

export const compareSymbols = (a: string, b: string): number => {
  const ra = SYMBOL_SORT_RANK[a] ?? 99
  const rb = SYMBOL_SORT_RANK[b] ?? 99
  return ra !== rb ? ra - rb : a.localeCompare(b)
}
