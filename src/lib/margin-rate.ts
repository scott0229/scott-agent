/**
 * Canonical 潛在融資 (potential margin) helper.
 *
 * 潛在融資 represents the cash an account would need to borrow if every
 * open short PUT were exercised at once. Previously the rate was computed
 * as `(put_covered_capital + max(0, -cash)) / equity` — only existing
 * negative-cash debt was counted, the positive cash balance was ignored.
 * That overstated the rate for accounts sitting on a meaningful cash
 * cushion (e.g. evan.287 showed 75.5% while $294k cash on hand could
 * have absorbed most of the PUT obligation).
 *
 * New formula: subtract the cash balance from the PUT capital first; if
 * cash exceeds the obligation, no margin is needed at all. Handles both
 * positive and negative cash uniformly — a negative balance increases
 * the borrow figure (existing debt + new PUT obligation), a positive
 * balance reduces it (cash absorbs the obligation up to its value).
 */
export function calculateMarginUsed(
    putCoveredCapital: number | null | undefined,
    cashBalance: number | null | undefined,
): number {
    const put = putCoveredCapital || 0;
    const cash = cashBalance || 0;
    return Math.max(0, put - cash);
}

export function calculateMarginRate(
    putCoveredCapital: number | null | undefined,
    cashBalance: number | null | undefined,
    equity: number | null | undefined,
): number {
    const eq = equity || 0;
    if (eq <= 0) return 0;
    return calculateMarginUsed(putCoveredCapital, cashBalance) / eq;
}
