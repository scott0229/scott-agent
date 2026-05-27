import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Same Bearer api_key auth as the other trader-* routes.
async function checkApiKey(req: NextRequest): Promise<boolean> {
    const { searchParams } = new URL(req.url);
    const qKey = searchParams.get('apiKey');
    const headerKey = req.headers.get('Authorization')?.replace('Bearer ', '');
    const key = qKey || headerKey;
    if (!key) return false;

    const db = await getDb('advisor');
    const row = await db.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    if (row) return true;

    const dbScott = await getDb('scott');
    const row2 = await dbScott.prepare("SELECT id FROM USERS WHERE api_key = ? LIMIT 1").bind(key).first();
    return !!row2;
}

interface OptRow {
    id: number;
    status: string;
    operation: string | null;
    open_date: number;
    to_date: number | null;
    settlement_date: number | null;
    quantity: number;
    underlying: string;
    type: string; // CALL / PUT
    strike_price: number;
    premium: number | null;
    final_profit: number | null;
    underlying_price: number | null;
    code: string | null;
    has_separator: number | null;
    group_id: string | number | null;
}

interface StkRow {
    id: number;
    symbol: string;
    status: string;
    open_date: number;
    close_date: number | null;
    open_price: number;
    close_price: number | null;
    quantity: number;
    code: string | null;
    has_separator: number | null;
    close_has_separator: number | null;
    group_id: string | number | null;
    close_group_id: string | number | null;
    include_in_options: number | null;
}

// GET /api/trader-group-detail?account=U123&group=QQQ-0[&year=2026]
// Returns the rows + summary needed by the trader desktop's group-detail
// dialog. Cumulative holdings and roll_profit are computed server-side so the
// client just renders.
export async function GET(req: NextRequest) {
    try {
        const authorized = await checkApiKey(req);
        if (!authorized) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const account = (searchParams.get('account') || '').trim();
        const groupName = (searchParams.get('group') || '').trim();
        const yearParam = searchParams.get('year');
        const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

        if (!account || !groupName) {
            return NextResponse.json({ error: 'Missing account or group parameter' }, { status: 400 });
        }

        // Find the owner in whichever DB has it. Trader app accounts live in
        // either advisor or scott — we try both.
        const dbNames = ['advisor', 'scott'];
        let ownerId: number | null = null;
        let foundDb: string | null = null;
        let dbHandle: Awaited<ReturnType<typeof getDb>> | null = null;
        for (const dbName of dbNames) {
            const db = await getDb(dbName);
            const owner = await db.prepare(
                "SELECT id FROM USERS WHERE ib_account = ? AND year = ? LIMIT 1"
            ).bind(account, year).first() as { id: number } | null;
            if (owner) {
                ownerId = owner.id;
                foundDb = dbName;
                dbHandle = db;
                break;
            }
        }

        if (ownerId === null || !dbHandle) {
            return NextResponse.json({ error: `No user for account=${account} year=${year}` }, { status: 404 });
        }

        // Group metadata (status / note). Optional — not all callers store one.
        const groupMeta = await dbHandle.prepare(
            "SELECT status FROM TRADE_GROUPS WHERE owner_id = ? AND year = ? AND name = ? LIMIT 1"
        ).bind(ownerId, year, groupName).first() as { status: string } | null;

        // OPTIONS rows for this group. Filter by string match on group_id
        // since SQLite stores the label there despite the INTEGER declaration.
        const optRes = await dbHandle.prepare(
            `SELECT id, status, operation, open_date, to_date, settlement_date,
                    quantity, underlying, type, strike_price, premium,
                    final_profit, underlying_price, code, has_separator, group_id
               FROM OPTIONS
              WHERE owner_id = ? AND year = ? AND CAST(group_id AS TEXT) = ?`
        ).bind(ownerId, year, groupName).all() as { results: OptRow[] };
        const optRows = optRes.results || [];

        // ALL stock trades for the owner+year — we need them for cumulative
        // holdings even when the stock trade itself isn't in this group, and
        // we also want any stock trade tagged with this group (open or close).
        const stkRes = await dbHandle.prepare(
            `SELECT id, symbol, status, open_date, close_date, open_price,
                    close_price, quantity, code, has_separator,
                    close_has_separator, group_id, close_group_id,
                    include_in_options
               FROM STOCK_TRADES
              WHERE owner_id = ? AND year = ?`
        ).bind(ownerId, year).all() as { results: StkRow[] };
        const allStocks = stkRes.results || [];

        // Build the "trades" array the dialog expects: options for this group
        // plus stock trades whose open OR close is tagged with this group.
        type Row = {
            id: number;
            type: 'CALL' | 'PUT' | 'STK';
            operation: 'Open' | 'Closed' | 'Assigned' | 'Expired' | 'Transferred';
            open_date: number;
            settlement_date: number | null;
            quantity: number;
            underlying: string;
            strike_price?: number;
            to_date?: number | null;
            premium?: number | null;
            final_profit?: number | null;
            underlying_price?: number | null;
            is_assigned?: boolean;
            code?: string | null;
            cumulative_holdings?: number;
            cumulative_avg_price?: number | null;
            roll_profit?: number | null;
        };
        const rows: Row[] = [];

        for (const o of optRows) {
            const op = mapOptOperation(o);
            rows.push({
                id: o.id,
                type: (o.type === 'PUT' ? 'PUT' : 'CALL'),
                operation: op,
                open_date: o.open_date,
                settlement_date: o.settlement_date,
                quantity: o.quantity,
                underlying: o.underlying,
                strike_price: o.strike_price,
                to_date: o.to_date,
                premium: o.premium,
                final_profit: o.final_profit,
                underlying_price: o.underlying_price,
                code: o.code,
            });
        }

        // Stock trades: an OPEN tagged with this group → row at open_date;
        // a CLOSE tagged with this group → row at close_date with final_profit.
        for (const s of allStocks) {
            const openGid = s.group_id != null ? String(s.group_id) : '';
            const closeGid = s.close_group_id != null ? String(s.close_group_id) : '';
            if (openGid === groupName) {
                rows.push({
                    id: s.id,
                    type: 'STK',
                    operation: 'Open',
                    open_date: s.open_date,
                    settlement_date: null,
                    quantity: s.quantity,
                    underlying: s.symbol,
                    underlying_price: s.open_price,
                    code: s.code,
                });
            }
            if (closeGid === groupName && s.close_date && s.close_price != null) {
                const profit = (s.close_price - s.open_price) * s.quantity;
                rows.push({
                    id: s.id,
                    type: 'STK',
                    operation: 'Closed',
                    open_date: s.close_date,
                    settlement_date: s.close_date,
                    quantity: s.quantity,
                    underlying: s.symbol,
                    underlying_price: s.close_price,
                    final_profit: profit,
                    is_assigned: false,
                    code: s.code,
                });
            }
        }

        // Sort rows by open_date desc (latest first), matching the website.
        rows.sort((a, b) => b.open_date - a.open_date);

        // Cumulative holdings: across ALL the owner's stock trades for the
        // underlying. For each row, count shares held strictly before/at
        // row.open_date that haven't been closed yet by that time.
        const stocksByUnderlying = new Map<string, StkRow[]>();
        for (const s of allStocks) {
            const k = s.symbol;
            if (!stocksByUnderlying.has(k)) stocksByUnderlying.set(k, []);
            stocksByUnderlying.get(k)!.push(s);
        }
        for (const r of rows) {
            let total = 0;
            let totalCost = 0;
            const list = stocksByUnderlying.get(r.underlying) || [];
            for (const s of list) {
                if (s.open_date <= r.open_date) {
                    if (!s.close_date || s.close_date > r.open_date) {
                        total += s.quantity;
                        totalCost += s.quantity * s.open_price;
                    }
                }
            }
            r.cumulative_holdings = total;
            r.cumulative_avg_price = total > 0 ? totalCost / total : null;
        }

        // Roll-profit pairing — ported from GroupTradesDialog. Each open
        // consumes the most recent unconsumed close with the same
        // underlying+type and quantity (within a 7-day window for N-to-1).
        const rollProfits = computeRollProfits(rows);
        for (const r of rows) {
            if (rollProfits.has(r.id)) {
                r.roll_profit = rollProfits.get(r.id)!;
            }
        }

        // Summary (same formulas as the website's dialog).
        let totalPnL = 0;
        let totalNetCashInflow = 0;
        let totalOpenCostToClose = 0;
        for (const r of rows) {
            totalPnL += r.final_profit ?? 0;
            if (r.type !== 'STK') {
                if (r.operation === 'Open' || !r.settlement_date) {
                    totalNetCashInflow += r.premium ?? 0;
                    totalOpenCostToClose += (r.premium ?? 0) - (r.final_profit ?? 0);
                } else {
                    totalNetCashInflow += r.final_profit ?? 0;
                }
            }
        }

        return NextResponse.json({
            groupName,
            groupStatus: groupMeta?.status || 'Active',
            dbName: foundDb,
            rows,
            summary: {
                totalNetCashInflow,
                totalOpenCostToClose,
                totalPnL,
            },
        });
    } catch (error) {
        console.error('GET trader-group-detail error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

function mapOptOperation(o: OptRow): 'Open' | 'Closed' | 'Assigned' | 'Expired' | 'Transferred' {
    const raw = (o.operation || '').trim();
    if (raw === 'Assigned' || raw === '被行權') return 'Assigned';
    if (raw === 'Expired' || raw === '到期') return 'Expired';
    if (raw === 'Transferred' || raw === '轉倉') return 'Transferred';
    if (o.status === 'Open' || !o.settlement_date) return 'Open';
    return 'Closed';
}

// Sequential roll-pair matching ported from GroupTradesDialog. Each open
// consumes the most recent unconsumed close of the same
// underlying+type+quantity that settled on/before the open date; falls back to
// N-to-1 subset match within a 7-day window.
function computeRollProfits(rows: { id: number; type: string; underlying: string; open_date: number; settlement_date: number | null; quantity: number; premium?: number | null; final_profit?: number | null }[]): Map<number, number> {
    const result = new Map<number, number>();

    type CloseEvt = {
        id: number;
        settlement_date: number;
        open_date: number;
        key: string;
        cost: number;
        qty: number;
        consumed: boolean;
    };

    const closes: CloseEvt[] = [];
    for (const t of rows) {
        if (t.type === 'STK') continue;
        if (t.settlement_date && t.premium != null && t.final_profit != null) {
            closes.push({
                id: t.id,
                settlement_date: t.settlement_date,
                open_date: t.open_date,
                key: `${t.underlying}_${t.type}`,
                cost: t.premium - t.final_profit,
                qty: t.quantity,
                consumed: false,
            });
        }
    }
    closes.sort((a, b) => a.settlement_date - b.settlement_date || a.open_date - b.open_date);

    const opens = rows
        .filter((t) => t.type !== 'STK' && t.premium != null)
        .slice()
        .sort((a, b) => a.open_date - b.open_date || (a.settlement_date ?? Infinity) - (b.settlement_date ?? Infinity));

    for (const ot of opens) {
        const key = `${ot.underlying}_${ot.type}`;

        // Pass 1: 1-to-1 exact qty, most recent close first.
        let matched = false;
        for (let i = closes.length - 1; i >= 0; i--) {
            const ce = closes[i];
            if (ce.consumed) continue;
            if (ce.id === ot.id) continue;
            if (ce.key !== key) continue;
            if (ce.settlement_date > ot.open_date) continue;
            if (ce.qty !== ot.quantity) continue;
            result.set(ot.id, (ot.premium as number) - ce.cost);
            ce.consumed = true;
            matched = true;
            break;
        }
        if (matched) continue;

        // Pass 2: N-to-1 subset match within 7 days.
        const WINDOW = 7 * 86400;
        const earliest = ot.open_date - WINDOW;
        const cands = closes.filter(
            (ce) =>
                !ce.consumed &&
                ce.id !== ot.id &&
                ce.key === key &&
                ce.settlement_date <= ot.open_date &&
                ce.settlement_date >= earliest
        );
        if (cands.length === 0 || cands.length > 12) continue;

        const target = ot.quantity;
        let best: CloseEvt[] | null = null;
        for (let mask = 1; mask < 1 << cands.length; mask++) {
            let sum = 0;
            const subset: CloseEvt[] = [];
            for (let j = 0; j < cands.length; j++) {
                if (mask & (1 << j)) {
                    subset.push(cands[j]);
                    sum += cands[j].qty;
                }
            }
            if (sum === target) {
                if (!best || subset.length < best.length) best = subset;
            }
        }
        if (best) {
            const totalCost = best.reduce((s, ce) => s + ce.cost, 0);
            result.set(ot.id, (ot.premium as number) - totalCost);
            best.forEach((ce) => {
                ce.consumed = true;
            });
        }
    }

    return result;
}
