/**
 * Canonical calculations for 期權收益 / 期權收益率.
 *
 * Centralised here so the summary card, equity chart, daily report,
 * and any future consumer always agree on the numerator (annualPremium)
 * and the denominator (cost base). Drift between these three surfaces
 * is what produced the 4.33% vs 4.04% mismatch we hit on 2026-05-25
 * for scott.238 — different code paths summed the same components
 * slightly differently.
 *
 * The formula matches what the daily report renders:
 *     annualPremium = sum(put_profit + call_profit)         from monthly_stats
 *                   + sum(stock_pnl)  ── if includeStockDiff
 *                   + total_daily_interest
 *     rate         = (annualPremium / costBase) * 100
 *     costBase     = initial_cost  or  net_deposit when initial_cost is 0
 */

export interface MonthlyStat {
    put_profit?: number;
    call_profit?: number;
    stock_pnl?: number;
}

export interface PremiumInput {
    monthly_stats?: MonthlyStat[];
    total_daily_interest?: number;
    initial_cost?: number | null;
    net_deposit?: number | null;
}

export function getPremiumCostBase(user: PremiumInput): number {
    if (user.initial_cost && user.initial_cost > 0) return user.initial_cost;
    return user.net_deposit || 0;
}

export function calculateAnnualPremium(
    user: PremiumInput,
    options: { includeStockDiff?: boolean } = {},
): number {
    const { includeStockDiff = true } = options;
    const stats = user.monthly_stats || [];
    const put = stats.reduce((s, m) => s + (m.put_profit || 0), 0);
    const call = stats.reduce((s, m) => s + (m.call_profit || 0), 0);
    const stock = stats.reduce((s, m) => s + (m.stock_pnl || 0), 0);
    return put + call + (includeStockDiff ? stock : 0) + (user.total_daily_interest || 0);
}

export function calculatePremiumRate(annualPremium: number, costBase: number): number {
    return costBase > 0 ? (annualPremium / costBase) * 100 : 0;
}
