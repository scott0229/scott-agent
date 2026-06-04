/**
 * Canonical generator for the per-user daily trades text shown on
 * /daily-trades and (now) appended to BCC report emails when the
 * admin opts into 含當日操作.
 *
 * Pure function — takes the user's trades, the report date string
 * ("YYYY-MM-DD"), and the latest-known market price per symbol,
 * returns the multi-line text block. Output format matches what
 * the daily-trades page used to inline-render.
 */

import { getTradingDaysDiff } from '@/lib/holidays';

export interface DailyTradeRow {
    id: number;
    asset_type: 'stock' | 'option';
    action_type: 'open' | 'close';
    symbol: string;
    quantity: number;
    price?: number | null;
    open_price?: number | null;
    source?: string | null;
    close_source?: string | null;
    option_type?: 'CALL' | 'PUT' | string;
    strike_price?: number | null;
    to_date?: number | null;
    group_id?: string | number | null;
    profit?: number | null;
    old_premium?: number | null;
    operation?: string | null;
}

export interface UserDailyTradesGroup {
    user: { id: number; user_id?: string | null; name?: string | null; email?: string };
    trades: DailyTradeRow[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatNumber(val: number | null | undefined): string {
    if (val == null) return '-';
    return new Intl.NumberFormat('en-US').format(val);
}

export function generateDailyTradesText(
    userGroup: UserDailyTradesGroup,
    date: string,
    marketDataMap: Record<string, number>,
): string {
    let text = '';
    if (date) {
        const d = new Date(date);
        const dateStr = `${d.getFullYear().toString().slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        text += `交易日期 : ${dateStr}\n`;
        text += `----------------------------------------\n`;
    }

    const stockLines: string[] = [];
    const optionChunks: string[] = [];

    const formatOptionTrade = (trade: DailyTradeRow) => {
        const transactionQty = trade.action_type === 'close' ? -trade.quantity : trade.quantity;
        const qtyStr = transactionQty > 0 ? `+${transactionQty}` : `${transactionQty}`;

        let expiryStr = '';
        if (trade.to_date) {
            const expiryDate = new Date(trade.to_date * 1000);
            const monthName = MONTHS[expiryDate.getMonth()];
            const dayStr = String(expiryDate.getDate()).padStart(2, '0');
            const yearStr = String(expiryDate.getFullYear()).slice(2);
            expiryStr = ` ${monthName}${dayStr}'${yearStr}`;
        }

        const symbolStr = `${trade.symbol}${expiryStr} ${trade.strike_price}${trade.option_type === 'CALL' ? 'C' : 'P'}`;
        return `${qtyStr}口 ${symbolStr}`;
    };

    // Identify rolls
    const optionOpens = userGroup.trades.filter(t => t.asset_type === 'option' && t.action_type === 'open');
    const optionCloses = userGroup.trades.filter(t => t.asset_type === 'option' && t.action_type === 'close');

    const matchedOpenIds = new Set<number>();
    const matchedCloseIds = new Set<number>();

    const openGroups: Record<string, DailyTradeRow[]> = {};
    const closeGroups: Record<string, DailyTradeRow[]> = {};

    optionOpens.forEach(t => {
        const key = `${t.symbol}_${t.option_type}_${t.group_id || 'no_group'}`;
        if (!openGroups[key]) openGroups[key] = [];
        openGroups[key].push(t);
    });

    optionCloses.forEach(t => {
        const key = `${t.symbol}_${t.option_type}_${t.group_id || 'no_group'}`;
        if (!closeGroups[key]) closeGroups[key] = [];
        closeGroups[key].push(t);
    });

    const rollGroups: { closed: DailyTradeRow[]; opened: DailyTradeRow[] }[] = [];

    Object.keys(closeGroups).forEach(key => {
        if (openGroups[key]) {
            const matchedC = closeGroups[key].filter(t => !matchedCloseIds.has(t.id));
            const matchedO = openGroups[key].filter(t => !matchedOpenIds.has(t.id));
            if (matchedC.length === 0 || matchedO.length === 0) return;

            const sumC = matchedC.reduce((s, t) => s + t.quantity, 0);
            const sumO = matchedO.reduce((s, t) => s + t.quantity, 0);

            if (sumC === sumO && sumC !== 0) {
                matchedC.forEach(t => matchedCloseIds.add(t.id));
                matchedO.forEach(t => matchedOpenIds.add(t.id));
                rollGroups.push({ closed: matchedC, opened: matchedO });
            } else {
                let stillHasUnmatched = false;
                matchedC.forEach(c => {
                    if (matchedCloseIds.has(c.id)) return;
                    const oIndex = matchedO.findIndex(o => !matchedOpenIds.has(o.id) && o.quantity === c.quantity);
                    if (oIndex !== -1) {
                        const o = matchedO[oIndex];
                        matchedCloseIds.add(c.id);
                        matchedOpenIds.add(o.id);
                        rollGroups.push({ closed: [c], opened: [o] });
                    } else {
                        stillHasUnmatched = true;
                    }
                });

                if (stillHasUnmatched || matchedO.some(o => !matchedOpenIds.has(o.id))) {
                    const remainingC = matchedC.filter(c => !matchedCloseIds.has(c.id));
                    const remainingO = matchedO.filter(o => !matchedOpenIds.has(o.id));

                    if (remainingC.length > 0 && remainingO.length > 0) {
                        const remSumC = remainingC.reduce((s, t) => s + t.quantity, 0);
                        const remSumO = remainingO.reduce((s, t) => s + t.quantity, 0);

                        if (Math.sign(remSumC) === Math.sign(remSumO) && remSumC !== 0) {
                            remainingC.forEach(c => matchedCloseIds.add(c.id));
                            remainingO.forEach(o => matchedOpenIds.add(o.id));
                            rollGroups.push({ closed: remainingC, opened: remainingO });
                        }
                    }
                }
            }
        }
    });

    // Apply explicit ordering to the roll chunks so the card mirrors the
    // 持有期權 list in the daily report:
    //   1. underlying priority QQQ → QLD → TQQQ → others (alpha)
    //   2. CALL before PUT
    //   3. strike ascending
    // Same group's closed + opened share underlying/type, so any leg is a
    // valid sort key — use opened[0] (newer leg) for the strike comparison.
    const ROLL_SYMBOL_PRIORITY: Record<string, number> = { QQQ: 0, QLD: 1, TQQQ: 2 };
    const rollSymbolRank = (s: string | undefined) => (s && s in ROLL_SYMBOL_PRIORITY) ? ROLL_SYMBOL_PRIORITY[s] : 3;
    const rollTypeRank = (t: string | undefined) => t === 'CALL' ? 0 : t === 'PUT' ? 1 : 2;
    rollGroups.sort((a, b) => {
        const aRef = a.opened[0] ?? a.closed[0];
        const bRef = b.opened[0] ?? b.closed[0];
        const symRankA = rollSymbolRank(aRef.symbol);
        const symRankB = rollSymbolRank(bRef.symbol);
        if (symRankA !== symRankB) return symRankA - symRankB;
        // Same priority tier (e.g. both fall into the "others" bucket) →
        // alpha order so the chunk list stays stable.
        if (aRef.symbol !== bRef.symbol) return aRef.symbol.localeCompare(bRef.symbol);
        const typeRankA = rollTypeRank(aRef.option_type);
        const typeRankB = rollTypeRank(bRef.option_type);
        if (typeRankA !== typeRankB) return typeRankA - typeRankB;
        return (aRef.strike_price ?? 0) - (bRef.strike_price ?? 0);
    });

    // Format rolls
    rollGroups.forEach(rg => {
        const lines: string[] = [];

        let canCalc = true;
        let totalCostToClose = 0;
        rg.closed.forEach(c => {
            if (c.old_premium == null || c.profit == null) canCalc = false;
            totalCostToClose += ((c.old_premium ?? 0) - (c.profit ?? 0));
        });
        let totalPremiumOpened = 0;
        rg.opened.forEach(o => {
            if (o.price == null) canCalc = false;
            totalPremiumOpened += (o.price ?? 0);
        });

        const rollSegments: string[] = [];

        let daysDiffStr = '';
        if (rg.opened.length > 0 && rg.closed.length > 0) {
            const openToDate = rg.opened[0].to_date;
            const closeToDate = rg.closed[0].to_date;
            if (openToDate && closeToDate) {
                const daysDiff = Math.abs(getTradingDaysDiff(closeToDate, openToDate));
                daysDiffStr = ` ${daysDiff}`;
            }

            const newOpt = rg.opened[0];
            const oldOpt = rg.closed[0];
            const strikeDiff = (newOpt.strike_price ?? 0) - (oldOpt.strike_price ?? 0);
            if (strikeDiff !== 0) {
                rollSegments.push(`調價 ${strikeDiff > 0 ? '+' : ''}${strikeDiff.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`);
            }
        }

        let itmString = '';
        if (rg.opened.length > 0 && rg.closed.length > 0) {
            const newOpt = rg.opened[0];
            const currentPrice = marketDataMap[newOpt.symbol];
            if (currentPrice != null) {
                let diff = 0;
                if (newOpt.option_type === 'CALL') {
                    diff = currentPrice - (newOpt.strike_price ?? 0);
                } else if (newOpt.option_type === 'PUT') {
                    diff = (newOpt.strike_price ?? 0) - currentPrice;
                }
                if (diff > 0) {
                    itmString = `被突破 ${diff.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
                }
            }
        }

        if (canCalc) {
            const rollProfit = totalPremiumOpened - totalCostToClose;
            const sign = rollProfit > 0 ? '+' : '';
            rollSegments.push(`收益 ${sign}${rollProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`);
        }

        if (itmString) {
            rollSegments.push(itmString);
        }

        lines.push(`展期${daysDiffStr}${rollSegments.length > 0 ? ', ' + rollSegments.join(', ') : ''}`);

        rg.opened.forEach(o => lines.push(formatOptionTrade(o)));
        rg.closed.forEach(c => lines.push(formatOptionTrade(c)));

        optionChunks.push(lines.join('\n'));
    });

    const unmatchedOptions: DailyTradeRow[] = [];

    const STOCK_SYMBOL_PRIORITY: Record<string, number> = { QQQ: 0, QLD: 1, TQQQ: 2 };
    const stockSymbolRank = (s: string) => STOCK_SYMBOL_PRIORITY[s] ?? Number.MAX_SAFE_INTEGER;
    const sortedTrades = [...userGroup.trades].sort((a, b) => {
        if (a.asset_type !== 'stock' || b.asset_type !== 'stock') return 0;
        if (a.action_type !== b.action_type) return a.action_type === 'open' ? -1 : 1;
        const ra = stockSymbolRank(a.symbol);
        const rb = stockSymbolRank(b.symbol);
        if (ra !== rb) return ra - rb;
        return a.symbol.localeCompare(b.symbol);
    });

    sortedTrades.forEach(trade => {
        if (trade.asset_type === 'stock') {
            const transactionQty = trade.action_type === 'close' ? -trade.quantity : trade.quantity;
            let action = transactionQty > 0 ? '買' : '賣';

            const isAssigned =
                (trade.action_type === 'open' && trade.source?.toLowerCase() === 'assigned') ||
                (trade.action_type === 'close' && trade.close_source?.toLowerCase() === 'assigned');
            if (isAssigned) action += '-指派';

            const qtyStr = formatNumber(Math.abs(transactionQty));
            const priceNum = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(trade.price || 0);

            let profitStr = '';
            if (trade.action_type === 'close' && trade.open_price != null && trade.price != null) {
                const profit = (trade.price - trade.open_price) * Math.abs(transactionQty);
                const profitNum = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(profit));
                const sign = profit > 0 ? '+' : profit < 0 ? '-' : '';
                profitStr = `, 收益 ${sign}${profitNum}`;
            }

            stockLines.push(`${action} ${trade.symbol} ${qtyStr} 股 (均 ${priceNum}${profitStr})`);
        } else if (trade.asset_type === 'option') {
            if (trade.action_type === 'open' && matchedOpenIds.has(trade.id)) return;
            if (trade.action_type === 'close' && matchedCloseIds.has(trade.id)) return;
            unmatchedOptions.push(trade);
        }
    });

    const optionGroups: Record<string, DailyTradeRow[]> = {};
    unmatchedOptions.forEach(trade => {
        const isAssignedClose = trade.action_type === 'close' && trade.operation === 'Assigned';
        const key = isAssignedClose
            ? `close_${trade.symbol}_${trade.option_type}_assigned`
            : `${trade.action_type}_${trade.symbol}_${trade.option_type}_${trade.strike_price}_${trade.to_date}`;
        if (!optionGroups[key]) optionGroups[key] = [];
        optionGroups[key].push(trade);
    });

    // Apply the same ordering to unmatched option chunks (新開倉 / 平倉)
    // so the whole option section reads in one consistent sequence.
    const sortedOptionGroups = Object.values(optionGroups).sort((a, b) => {
        const aRef = a[0];
        const bRef = b[0];
        const symRankA = rollSymbolRank(aRef.symbol);
        const symRankB = rollSymbolRank(bRef.symbol);
        if (symRankA !== symRankB) return symRankA - symRankB;
        if (aRef.symbol !== bRef.symbol) return aRef.symbol.localeCompare(bRef.symbol);
        const typeRankA = rollTypeRank(aRef.option_type);
        const typeRankB = rollTypeRank(bRef.option_type);
        if (typeRankA !== typeRankB) return typeRankA - typeRankB;
        return (aRef.strike_price ?? 0) - (bRef.strike_price ?? 0);
    });

    sortedOptionGroups.forEach(group => {
        const firstTrade = group[0];
        let prefixLine = '';

        if (firstTrade.action_type === 'open') {
            let dteStr = '';
            if (firstTrade.to_date && date) {
                const tradeDate = new Date(date);
                tradeDate.setHours(0, 0, 0, 0);
                const expiryDate = new Date(firstTrade.to_date * 1000);
                expiryDate.setHours(0, 0, 0, 0);
                const days = Math.round((expiryDate.getTime() - tradeDate.getTime()) / 86400000);
                dteStr = `, 到期 ${days} 天`;
            }

            let totalPremium = 0;
            let hasPremium = false;
            group.forEach(t => {
                if (t.price != null) {
                    totalPremium += Math.abs(t.price);
                    hasPremium = true;
                }
            });
            const premiumStr = hasPremium ? `, 權利金 ${totalPremium.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` : '';

            prefixLine = `開新倉${dteStr}${premiumStr}\n`;
        } else {
            let totalProfit = 0;
            let hasProfit = false;
            group.forEach(t => {
                if (t.profit != null) {
                    totalProfit += t.profit;
                    hasProfit = true;
                }
            });

            let operationStr = '平倉';
            let hideProfit = false;
            if (firstTrade.operation === 'Assigned') {
                operationStr = '到期, 被行權';
                hideProfit = true;
            } else if (firstTrade.operation === 'Expired') {
                operationStr = '到期';
                hideProfit = true;
            } else if (firstTrade.operation === 'Closed') {
                operationStr = '平倉';
            } else if (firstTrade.operation) {
                operationStr = firstTrade.operation;
            }

            const profitStr = hasProfit && !hideProfit ? `, 收益 ${totalProfit > 0 ? '+' : ''}${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}` : '';
            prefixLine = `${operationStr}${profitStr}\n`;
        }

        const lines = [prefixLine.trimEnd()];
        group.forEach(t => lines.push(formatOptionTrade(t)));
        optionChunks.push(lines.join('\n'));
    });

    const sections: string[] = [];
    if (stockLines.length > 0) sections.push(stockLines.join('\n'));
    // Short dash marker (8 dashes) for chunk-level dividers. The email
    // renderer distinguishes this from 20+-dash section dividers and
    // gives it a lighter hr style. In the daily-trades page (and any
    // other plain-text consumer) it renders as `--------`.
    if (optionChunks.length > 0) sections.push(optionChunks.join('\n--------\n'));

    if (sections.length > 0) {
        text += sections.join('\n----------------------------------------\n');
    }
    return text;
}
