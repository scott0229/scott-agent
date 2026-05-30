import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { calculateMarginRate } from '@/lib/margin-rate';

export const dynamic = 'force-dynamic';

// Server-side aggregation of TRADE_GROUPS for one account, mirroring what the
// /trade-groups web page computes client-side. The Electron trader app calls
// this when the user filters down to a single account card, so it doesn't have
// to re-implement the join/aggregation logic.
//
// GET /api/trader-account-groups?alias=adair.600&year=2026&group=advisor

async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;
    const group = await getGroupFromRequest(req);
    const db = await getDb(group);
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row;
}

interface OptionRow {
    id: number;
    owner_id: number;
    group_id: string | number | null;
    open_date: number;
    settlement_date: number | null;
    final_profit: number | null;
    premium: number | null;
    operation: string | null;
    underlying: string | null;
    type: string;            // 'CALL' | 'PUT'
    strike_price: number | null;
    to_date: number | null;
    quantity: number;
}

interface StockRow {
    id: number;
    owner_id: number;
    group_id: string | number | null;
    close_group_id: string | number | null;
    open_date: number;
    close_date: number | null;
    open_price: number;
    close_price: number | null;
    current_market_price: number | null;
    quantity: number;
    symbol: string;
    status: string;          // 'Open' | 'Closed'
}

interface TradeGroupRow {
    id: number;
    owner_id: number;
    name: string;
    status: string;          // 'Active' | 'Terminated'
}

type TradeLike = {
    id: number;
    type: 'CALL' | 'PUT' | 'STK';
    group_id: string;
    open_date: number;
    settlement_date: number | null;
    final_profit: number;
    premium: number;
    operation: string;
    underlying: string;
    strike_price: number | null;
    to_date: number | null;
    quantity: number;
    underlying_price: number | null;
    is_assigned: boolean;
    status: string;
};

export async function GET(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const alias = searchParams.get('alias');
        const yearStr = searchParams.get('year');
        if (!alias) {
            return NextResponse.json({ error: 'Missing alias' }, { status: 400 });
        }
        const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Resolve user by alias. Pull a few real columns plus three computed
        // subqueries that match the page summary (page.tsx lines 469-494):
        //   - current_cash_balance: latest DAILY_NET_EQUITY.cash_balance
        //   - current_net_equity:  latest DAILY_NET_EQUITY.net_equity
        //   - open_put_covered_capital: sum over open PUTs for this year
        const USER_QUERY_FIELDS = `id, user_id, name, initial_cost,
            (SELECT cash_balance FROM DAILY_NET_EQUITY
                WHERE user_id = USERS.id ORDER BY date DESC LIMIT 1) AS current_cash_balance,
            (SELECT net_equity FROM DAILY_NET_EQUITY
                WHERE user_id = USERS.id ORDER BY date DESC LIMIT 1) AS current_net_equity,
            (SELECT COALESCE(SUM(ABS(quantity) * strike_price * 100), 0) FROM OPTIONS
                WHERE OPTIONS.owner_id = USERS.id AND OPTIONS.year = ?
                  AND OPTIONS.operation = 'Open' AND OPTIONS.type = 'PUT')
                AS open_put_covered_capital`;
        type UserRow = {
            id: number; user_id: string; name: string;
            initial_cost: number | null;
            current_cash_balance: number | null;
            current_net_equity: number | null;
            open_put_covered_capital: number | null;
        };
        const user = (await db.prepare(
            `SELECT ${USER_QUERY_FIELDS} FROM USERS WHERE user_id = ? AND year = ? LIMIT 1`
        ).bind(year, alias, year).first() as UserRow | null)
            ?? (await db.prepare(
                `SELECT ${USER_QUERY_FIELDS} FROM USERS WHERE user_id = ? ORDER BY year DESC LIMIT 1`
            ).bind(year, alias).first() as UserRow | null);

        if (!user) {
            return NextResponse.json({ error: `User not found: ${alias}` }, { status: 404 });
        }
        const ownerId = user.id;

        // Pull options + stocks + trade-group rows for this owner/year in parallel.
        const [optRes, stkRes, tgRes] = await Promise.all([
            db.prepare(
                `SELECT id, owner_id, group_id, open_date, settlement_date, final_profit,
                        premium, operation, underlying, type, strike_price, to_date, quantity
                 FROM OPTIONS WHERE owner_id = ? AND year = ?`
            ).bind(ownerId, year).all() as unknown as { results: OptionRow[] },
            db.prepare(
                `SELECT ST.id, ST.owner_id, ST.group_id, ST.close_group_id, ST.open_date,
                        ST.close_date, ST.open_price, ST.close_price, ST.quantity, ST.symbol,
                        ST.status, MP.close_price as current_market_price
                 FROM STOCK_TRADES ST
                 LEFT JOIN (
                     SELECT symbol, close_price FROM market_prices
                     WHERE (symbol, date) IN (
                         SELECT symbol, MAX(date) FROM market_prices
                         WHERE date <= unixepoch() GROUP BY symbol
                     )
                 ) MP ON ST.symbol = MP.symbol
                 WHERE ST.owner_id = ? AND ST.year = ?`
            ).bind(ownerId, year).all() as unknown as { results: StockRow[] },
            db.prepare(
                `SELECT id, owner_id, name, status FROM TRADE_GROUPS WHERE owner_id = ? AND year = ?`
            ).bind(ownerId, year).all() as unknown as { results: TradeGroupRow[] }
        ]);

        // Normalise options + stocks into a unified TradeLike stream (matches the
        // shape the /trade-groups page builds client-side).
        const trades: TradeLike[] = [];
        for (const o of optRes.results || []) {
            const gid = o.group_id == null ? '' : String(o.group_id).trim();
            if (!gid) continue;
            const t = (o.type || '').toUpperCase();
            const tradeType: 'CALL' | 'PUT' = t === 'PUT' ? 'PUT' : 'CALL';
            trades.push({
                id: o.id,
                type: tradeType,
                group_id: gid,
                open_date: o.open_date,
                settlement_date: o.settlement_date,
                final_profit: o.final_profit ?? 0,
                premium: o.premium ?? 0,
                operation: o.operation || 'Open',
                underlying: o.underlying || '',
                strike_price: o.strike_price,
                to_date: o.to_date,
                quantity: o.quantity,
                underlying_price: null,
                // No dedicated is_assigned column — derive from operation.
                is_assigned: (o.operation || '').toLowerCase() === 'assigned',
                status: o.settlement_date ? 'Closed' : 'Open',
            });
        }
        for (const s of stkRes.results || []) {
            const gid = s.group_id != null && String(s.group_id).trim()
                ? String(s.group_id).trim()
                : (s.close_group_id != null ? String(s.close_group_id).trim() : '');
            if (!gid) continue;
            const finalProfit = s.status === 'Closed' && s.close_price != null
                ? (s.close_price - s.open_price) * s.quantity
                : (s.current_market_price != null
                    ? (s.current_market_price - s.open_price) * s.quantity
                    : 0);
            trades.push({
                id: s.id,
                type: 'STK',
                group_id: gid,
                open_date: s.open_date,
                settlement_date: s.close_date,
                final_profit: finalProfit,
                premium: 0,
                operation: s.status,
                underlying: s.symbol,
                strike_price: null,
                to_date: null,
                quantity: s.quantity,
                underlying_price: s.open_price,
                is_assigned: false,
                status: s.status,
            });
        }

        // Aggregate per group_id — same algorithm as src/app/trade-groups/page.tsx.
        type Stat = {
            count: number;
            profit: number;
            netCashInflow: number;
            openCostToClose: number;
            stockProfit: number;
            minDate: number;
            maxDate: number;
            latestTrade: TradeLike;
            holdingShares: number;
            holdingCost: number;
        };
        const statsMap = new Map<string, Stat>();
        for (const t of trades) {
            const key = t.group_id;
            let s = statsMap.get(key);
            if (!s) {
                s = {
                    count: 0, profit: 0, netCashInflow: 0, openCostToClose: 0,
                    stockProfit: 0, minDate: t.open_date, maxDate: t.open_date,
                    latestTrade: t, holdingShares: 0, holdingCost: 0,
                };
                statsMap.set(key, s);
            }
            s.count += 1;
            s.profit += t.final_profit;
            if (t.type !== 'STK') {
                if (t.operation === 'Open' || !t.settlement_date) {
                    s.netCashInflow += t.premium;
                    s.openCostToClose += t.premium - t.final_profit;
                } else {
                    s.netCashInflow += t.final_profit;
                }
            } else {
                s.stockProfit += t.final_profit;
                if (t.status === 'Open') {
                    s.holdingShares += t.quantity;
                    s.holdingCost += t.quantity * (t.underlying_price ?? 0);
                }
            }
            if (t.open_date < s.minDate) s.minDate = t.open_date;
            if (t.open_date > s.maxDate || (t.open_date === s.maxDate && t.id > s.latestTrade.id)) {
                s.maxDate = t.open_date;
                s.latestTrade = t;
            }
        }

        // Join with TRADE_GROUPS to pick up status + the canonical name when
        // group_id is a numeric reference instead of a string name.
        const tgById = new Map<string, TradeGroupRow>();
        const tgByName = new Map<string, TradeGroupRow>();
        for (const tg of tgRes.results || []) {
            tgById.set(String(tg.id), tg);
            tgByName.set(tg.name, tg);
        }

        const groups = Array.from(statsMap.entries()).map(([gid, s]) => {
            const dbg = tgById.get(gid) || tgByName.get(gid);
            const name = dbg?.name || gid;
            const status = (dbg?.status as 'Active' | 'Terminated' | undefined) || 'Active';
            return {
                id: dbg?.id ?? null,
                name,
                count: s.count,
                startDate: s.minDate,
                endDate: s.maxDate,
                latestTrade: {
                    type: s.latestTrade.type,
                    underlying: s.latestTrade.underlying,
                    quantity: s.latestTrade.quantity,
                    strike_price: s.latestTrade.strike_price,
                    to_date: s.latestTrade.to_date,
                    underlying_price: s.latestTrade.underlying_price,
                    operation: s.latestTrade.operation,
                    is_assigned: s.latestTrade.is_assigned,
                },
                holdingShares: s.holdingShares,
                holdingAvgPrice: s.holdingShares !== 0
                    ? Math.abs(s.holdingCost / s.holdingShares)
                    : 0,
                netCashInflow: s.netCashInflow,
                openCostToClose: s.openCostToClose,
                stockProfit: s.stockProfit,
                profit: s.profit,
                status,
            };
        });

        // Active first, then Terminated. Within each, alphabetical-ish by name
        // with QQQ < TQQQ < GROUP < everything else, matching the web page.
        const prefixWeight = (n: string) =>
            n.startsWith('QQQ') ? 1 : n.startsWith('TQQQ') ? 2 : n.startsWith('GROUP') ? 3 : 4;
        groups.sort((a, b) => {
            if (a.status !== b.status) return a.status === 'Active' ? -1 : 1;
            const wa = prefixWeight(a.name);
            const wb = prefixWeight(b.name);
            if (wa !== wb) return wa - wb;
            return a.name.localeCompare(b.name);
        });

        // Summary card values shown at the top of the /trade-groups page.
        // 潛在融資 canonical formula in src/lib/margin-rate.ts.
        const totalProfit = groups.reduce((sum, g) => sum + (g.profit || 0), 0);
        const totalCash = user.current_cash_balance ?? 0;
        const totalNetEquity = user.current_net_equity ?? 0;
        const marginRate = calculateMarginRate(
            user.open_put_covered_capital,
            totalCash,
            totalNetEquity,
        ) * 100;

        return NextResponse.json({
            user: { id: user.id, alias: user.user_id, name: user.name },
            year,
            summary: {
                totalCash,
                marginRate,
                totalProfit,
            },
            groups,
        });
    } catch (error) {
        console.error('GET trader-account-groups error:', error);
        const msg = error instanceof Error ? error.message : 'Server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
