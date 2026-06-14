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
    /** Unix-second timestamp of when this OPTIONS row was opened. Carries
     *  a real HH:MM:SS for opens; for closes the column still references
     *  the position's original open. We borrow this time for close rows
     *  by pairing them with a same-day open in the same roll. */
    open_date?: number | null;
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

/** HH:MM in UTC, matching the SQLite datetime() representation used when
 *  the import path stores wall-clock times. Empty string when no timestamp. */
function formatTime(unixSec: number | null | undefined): string {
    if (!unixSec) return '';
    const d = new Date(unixSec * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

export function generateDailyTradesText(
    userGroup: UserDailyTradesGroup,
    date: string,
    marketDataMap: Record<string, number>,
    /** QQQ open/close for `date`. When both are populated, prepend a
     *  "QQQ open → close (±delta)" line right after 交易日期 so readers
     *  see the underlying's daily move next to their P&L. */
    qqqDay?: { open: number | null; close: number | null },
    /** Per-symbol intraday minute map (key = "HH:MM" in ET, value =
     *  spot close at that bar). When populated, each option leg's line
     *  appends " @<price>" using its execution time. */
    intradayPrices?: Record<string, Record<string, number>>,
): string {
    let text = '';
    if (date) {
        const d = new Date(date);
        const dateStr = `${d.getFullYear().toString().slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        // Parse parts explicitly for the weekday so it isn't timezone-shifted.
        const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];
        const [wy, wm, wd] = date.split('-').map(Number);
        const weekday = WEEKDAY_ZH[new Date(Date.UTC(wy, wm - 1, wd)).getUTCDay()];
        text += `日期 : ${dateStr} (${weekday})\n`;
        if (qqqDay && qqqDay.open != null && qqqDay.close != null) {
            const delta = qqqDay.close - qqqDay.open;
            const sign = delta >= 0 ? '+' : '';
            text += `QQQ 開盤 ${qqqDay.open.toFixed(2)} → 收盤 ${qqqDay.close.toFixed(2)} (${sign}${delta.toFixed(2)})\n`;
        }
        text += `----------------------------------------\n`;
    }

    const stockLines: string[] = [];
    const optionChunks: string[] = [];

    // Per-trade display time. Populated below during roll matching:
    //   - Open rows get their own open_date.
    //   - Close rows borrow the paired open's open_date (settlement_date
    //     only stores the close DAY, no HH:MM).
    // Unmatched closes fall through without a time; unmatched opens use
    // their own open_date directly.
    const timeMap = new Map<number, number>();

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
        const tStamp = timeMap.get(trade.id) ?? (trade.action_type === 'open' ? (trade.open_date ?? null) : null);
        const hhmm = tStamp ? formatTime(tStamp) : '';
        // Lead with the HH:MM so the executed time anchors the eye on the
        // left edge — easier to scan a vertical stack of trades by time
        // than to chase the timestamp at the end of variable-width symbols.
        const timeLead = hhmm ? `${hhmm} ` : '';
        // Append the underlying spot at that exact minute when the
        // intraday map carries it. Trade timestamps are stored "ET
        // wall-clock as UTC", so the HH:MM string we compute via
        // getUTCHours/Minutes already matches the ET-keyed price map.
        const minuteMap = intradayPrices?.[trade.symbol];
        const spot = hhmm && minuteMap ? minuteMap[hhmm] : undefined;
        const spotStr = spot != null ? ` @${spot.toFixed(2)}` : '';
        return `${timeLead}${qtyStr}口 ${symbolStr}${spotStr}`;
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

    const rollGroups: { closed: DailyTradeRow[]; opened: DailyTradeRow[]; chained?: boolean }[] = [];

    const legKey = (t: DailyTradeRow) => `${t.symbol}|${t.option_type}|${t.strike_price}|${t.to_date}`;

    Object.keys(closeGroups).forEach(key => {
        if (openGroups[key]) {
            const matchedC = closeGroups[key].filter(t => !matchedCloseIds.has(t.id));
            const matchedO = openGroups[key].filter(t => !matchedOpenIds.has(t.id));
            if (matchedC.length === 0 || matchedO.length === 0) return;

            // Chained-roll detection. When the user rolls a position in
            // multiple steps on the same day (A → B then B → C), the
            // intermediate instrument B appears BOTH as a close (step 2)
            // AND as an open (step 1) with the same qty. We want to bundle
            // the whole chain as one chunk so the user sees the full
            // A → ... → C movement instead of two split rollGroups whose
            // intermediate legs cancel out.
            const openedKeyToQty = new Map<string, number>();
            matchedO.forEach(o => openedKeyToQty.set(legKey(o), (openedKeyToQty.get(legKey(o)) || 0) + o.quantity));
            const closedKeyToQty = new Map<string, number>();
            matchedC.forEach(c => closedKeyToQty.set(legKey(c), (closedKeyToQty.get(legKey(c)) || 0) + c.quantity));
            const isChained = matchedC.some(c => openedKeyToQty.get(legKey(c)) === c.quantity);
            const sumC = matchedC.reduce((s, t) => s + t.quantity, 0);
            const sumO = matchedO.reduce((s, t) => s + t.quantity, 0);

            if (isChained && sumC === sumO && sumC !== 0) {
                // Arrange the chunk so each chronological step reads as a
                // (open, close) pair when zipped by the display loop:
                //   step i open  = sortedOpens[i] (by open_date ASC)
                //   step i close = (i === 0) the TRUE START X (a close whose
                //                  legKey doesn't appear in any open), else
                //                  the close whose legKey matches the
                //                  PREVIOUS step's open (the intermediate
                //                  being rolled off).
                // Times are heuristically borrowed: every leg of step i
                // shares the timestamp of sortedOpens[i].open_date — close
                // and open of a roll happen at the same execution moment.
                const sortedOpens = [...matchedO].sort((a, b) => (a.open_date ?? 0) - (b.open_date ?? 0));
                const remaining = [...matchedC];
                const orderedClosed: DailyTradeRow[] = [];
                const openLegKeys = new Set(sortedOpens.map(legKey));
                for (let i = 0; i < sortedOpens.length; i++) {
                    let targetCloseIdx: number;
                    if (i === 0) {
                        // True start: a close whose legKey doesn't appear in any open.
                        targetCloseIdx = remaining.findIndex(c => !openLegKeys.has(legKey(c)));
                    } else {
                        // Pair with the close that matches the previous step's open
                        // (the intermediate being rolled off this step).
                        const prevKey = legKey(sortedOpens[i - 1]);
                        targetCloseIdx = remaining.findIndex(c => legKey(c) === prevKey);
                    }
                    if (targetCloseIdx === -1) {
                        // Fallback: any remaining close. Shouldn't fire for clean
                        // chains but keeps us safe under weird data shapes.
                        targetCloseIdx = 0;
                    }
                    const c = remaining.splice(targetCloseIdx, 1)[0];
                    if (!c) break;
                    orderedClosed.push(c);
                    // Both legs of this step share the open's timestamp.
                    const stepTime = sortedOpens[i].open_date;
                    if (stepTime != null) {
                        timeMap.set(sortedOpens[i].id, stepTime);
                        timeMap.set(c.id, stepTime);
                    }
                }

                matchedC.forEach(t => matchedCloseIds.add(t.id));
                matchedO.forEach(t => matchedOpenIds.add(t.id));
                rollGroups.push({ closed: orderedClosed, opened: sortedOpens, chained: true });
                return;
            }

            // Non-chained: greedy 1-to-1 pairing by quantity. Catches the
            // common case of two independent rolls of different positions
            // sharing the same underlying/type/group_id on the same day
            // (e.g. -5 Jun17 737C → +5 Jun15 734C *and* -4 Jun15 695C →
            // +4 Jun08 693C). Each real roll surfaces separately rather
            // than getting mashed into one nonsense 調價/展期 line.
            const opensCopy = [...matchedO];
            matchedC.forEach(c => {
                if (matchedCloseIds.has(c.id)) return;
                const idx = opensCopy.findIndex(o => !matchedOpenIds.has(o.id) && o.quantity === c.quantity);
                if (idx === -1) return;
                const o = opensCopy[idx];
                matchedCloseIds.add(c.id);
                matchedOpenIds.add(o.id);
                opensCopy.splice(idx, 1);
                // Both legs of this roll share the open's execution time.
                if (o.open_date != null) {
                    timeMap.set(o.id, o.open_date);
                    timeMap.set(c.id, o.open_date);
                }
                rollGroups.push({ closed: [c], opened: [o] });
            });

            // Whatever's left after 1-to-1 pairing — bundle it as a single
            // roll when the residual closes and opens share sign and balance
            // in aggregate. Covers the N-to-M splits that don't reduce to
            // clean 1-to-1 pairs (e.g. -3 close → +1 + +2 open same day).
            const remainingC = matchedC.filter(c => !matchedCloseIds.has(c.id));
            const remainingO = matchedO.filter(o => !matchedOpenIds.has(o.id));
            if (remainingC.length > 0 && remainingO.length > 0) {
                const remSumC = remainingC.reduce((s, t) => s + t.quantity, 0);
                const remSumO = remainingO.reduce((s, t) => s + t.quantity, 0);
                if (Math.sign(remSumC) === Math.sign(remSumO) && remSumC !== 0) {
                    remainingC.forEach(c => matchedCloseIds.add(c.id));
                    remainingO.forEach(o => matchedOpenIds.add(o.id));
                    // Share the earliest open's time across every leg in the
                    // residual bundle — these are N-to-M splits where each
                    // leg is part of one umbrella roll executed in one block.
                    const earliestOpen = remainingO.reduce(
                        (acc, o) => ((o.open_date ?? Infinity) < (acc.open_date ?? Infinity) ? o : acc),
                        remainingO[0],
                    );
                    if (earliestOpen.open_date != null) {
                        remainingO.forEach(o => timeMap.set(o.id, earliestOpen.open_date!));
                        remainingC.forEach(c => timeMap.set(c.id, earliestOpen.open_date!));
                    }
                    rollGroups.push({ closed: remainingC, opened: remainingO });
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

        // Pick the headline "from" and "to" legs for the summary. For
        // chained chunks we want the TRUE start (close not appearing in
        // opens) and TRUE end (open not appearing in closes) so 調價 /
        // 展期 reflect the full chain X → Z, not an arbitrary middle hop.
        // For non-chained chunks index 0 of each side is fine.
        let summaryOld: DailyTradeRow = rg.closed[0];
        let summaryNew: DailyTradeRow = rg.opened[0];
        if (rg.chained && rg.closed.length > 0 && rg.opened.length > 0) {
            const openKeys = new Set(rg.opened.map(legKey));
            const closeKeys = new Set(rg.closed.map(legKey));
            summaryOld = rg.closed.find(c => !openKeys.has(legKey(c))) ?? rg.closed[0];
            summaryNew = rg.opened.find(o => !closeKeys.has(legKey(o))) ?? rg.opened[0];
        }

        let daysDiffStr = '';
        if (rg.opened.length > 0 && rg.closed.length > 0) {
            const openToDate = summaryNew.to_date;
            const closeToDate = summaryOld.to_date;
            if (openToDate && closeToDate) {
                const daysDiff = Math.abs(getTradingDaysDiff(closeToDate, openToDate));
                daysDiffStr = ` ${daysDiff}`;
            }

            const strikeDiff = (summaryNew.strike_price ?? 0) - (summaryOld.strike_price ?? 0);
            if (strikeDiff !== 0) {
                rollSegments.push(`調價 ${strikeDiff > 0 ? '+' : ''}${strikeDiff.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`);
            }
        }

        let itmString = '';
        if (rg.opened.length > 0 && rg.closed.length > 0) {
            const newOpt = summaryNew;
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

        // Merge legs that share (symbol, type, strike, to_date) into a single
        // row so two same-strike opens like "+1口 QQQ Jun03'26 726P" and
        // "+2口 QQQ Jun03'26 726P" read as one "+3口 QQQ Jun03'26 726P".
        // Clone the trade before mutating to keep the upstream array intact
        // (other consumers reuse userGroup.trades).
        const mergeLegs = (rows: DailyTradeRow[]): DailyTradeRow[] => {
            const map = new Map<string, DailyTradeRow>();
            for (const t of rows) {
                const k = `${t.symbol}|${t.option_type}|${t.strike_price}|${t.to_date}`;
                const prior = map.get(k);
                if (prior) prior.quantity += t.quantity;
                else map.set(k, { ...t });
            }
            return Array.from(map.values());
        };

        // Chained chunks: arrays are already in chronological (step) order
        // — opened[i] is step i's NEW open, closed[i] is the matching close
        // that gets rolled off in step i. Zip without re-sorting so the
        // user sees each step as an adjacent (open, close) pair.
        //
        // Non-chained: same-day double rolls are independent positions
        // that happen to share underlying+type; sort each side by strike
        // DESC and zip so the highest-strike open lines up with the
        // highest-strike close it replaced.
        const mergedOpened = rg.chained
            ? rg.opened
            : mergeLegs(rg.opened).sort((a, b) => (b.strike_price ?? 0) - (a.strike_price ?? 0));
        const mergedClosed = rg.chained
            ? rg.closed
            : mergeLegs(rg.closed).sort((a, b) => (b.strike_price ?? 0) - (a.strike_price ?? 0));
        const legPairs = Math.max(mergedOpened.length, mergedClosed.length);
        for (let i = 0; i < legPairs; i++) {
            if (i < mergedOpened.length) lines.push(formatOptionTrade(mergedOpened[i]));
            if (i < mergedClosed.length) lines.push(formatOptionTrade(mergedClosed[i]));
        }

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
