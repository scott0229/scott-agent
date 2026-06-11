/**
 * One-off scanner: walk every 2026 account day-by-day and flag dates
 * where short CALL contracts exceed coverage:
 *
 *   naked ⇔ shortCalls × 100 > shares + longCalls × 100   (per underlying)
 *
 * Holdings are reconstructed point-in-time from dated columns, same
 * rules as /api/daily-trades/holdings:
 *   option held on D ⇔ open<=D && (settle null || settle>D) && expiry>=D
 *   stock  held on D ⇔ open<=D && (close  null || close >D)
 *
 * Input: wrangler d1 JSON exports (see scan command in repo history):
 *   /tmp/scan-users.json   SELECT id, user_id FROM USERS WHERE year=2026
 *   /tmp/scan-calls.json   SELECT owner_id, underlying, quantity,
 *                          open_date, settlement_date, to_date
 *                          FROM OPTIONS WHERE type='CALL'
 *   /tmp/scan-stocks.json  SELECT owner_id, symbol, quantity,
 *                          open_date, close_date FROM STOCK_TRADES
 *
 * Output: per-account naked ranges with the worst uncovered gap.
 */

import { readFileSync } from 'fs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))[0].results;

const users = load('/tmp/scan-users.json');
const calls = load('/tmp/scan-calls.json');
const stocks = load('/tmp/scan-stocks.json');

const userById = new Map(users.map(u => [u.id, u.user_id]));

// Unix seconds → 'YYYY-MM-DD' in UTC, matching SQLite date(datetime(x,'unixepoch')).
const dayStr = (sec) => new Date(sec * 1000).toISOString().substring(0, 10);

const START = '2026-01-01';
const END = dayStr(Math.floor(Date.now() / 1000));

// Pre-bucket rows by (owner, underlying) for calls / (owner, symbol) for stocks.
const callKey = (r) => `${r.owner_id}|${r.underlying}`;
const callsByKey = new Map();
for (const r of calls) {
    if (!userById.has(r.owner_id)) continue; // 2025 accounts out of scope
    const k = callKey(r);
    if (!callsByKey.has(k)) callsByKey.set(k, []);
    callsByKey.get(k).push(r);
}
const stocksByKey = new Map();
for (const r of stocks) {
    if (!userById.has(r.owner_id)) continue;
    const k = `${r.owner_id}|${r.symbol}`;
    if (!stocksByKey.has(k)) stocksByKey.set(k, []);
    stocksByKey.get(k).push(r);
}

// Iterate calendar days.
function* days(from, to) {
    const d = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (d <= end) {
        yield d.toISOString().substring(0, 10);
        d.setUTCDate(d.getUTCDate() + 1);
    }
}

const findings = [];

for (const [k, rows] of callsByKey.entries()) {
    const [ownerIdStr, underlying] = k.split('|');
    const ownerId = Number(ownerIdStr);
    const stockRows = stocksByKey.get(k) || [];

    let openRange = null; // { from, worstGap, worstDay }
    for (const d of days(START, END)) {
        let short = 0, long = 0;
        for (const r of rows) {
            if (dayStr(r.open_date) > d) continue;
            if (r.settlement_date != null && dayStr(r.settlement_date) <= d) continue;
            if (r.to_date != null && dayStr(r.to_date) < d) continue;
            if (r.quantity < 0) short += -r.quantity; else long += r.quantity;
        }
        let shares = 0;
        for (const r of stockRows) {
            if (dayStr(r.open_date) > d) continue;
            if (r.close_date != null && dayStr(r.close_date) <= d) continue;
            shares += r.quantity;
        }
        const gap = short * 100 - (shares + long * 100);
        const naked = short > 0 && gap > 0;
        if (naked) {
            if (!openRange) openRange = { from: d, worstGap: gap, worstDay: d, short, shares, long };
            else if (gap > openRange.worstGap) Object.assign(openRange, { worstGap: gap, worstDay: d, short, shares, long });
            openRange.to = d;
        } else if (openRange) {
            findings.push({ ownerId, underlying, ...openRange });
            openRange = null;
        }
    }
    if (openRange) findings.push({ ownerId, underlying, ...openRange, ongoing: true });
}

findings.sort((a, b) => a.from.localeCompare(b.from));
if (findings.length === 0) {
    console.log('No naked CALL periods found in 2026.');
} else {
    for (const f of findings) {
        const user = userById.get(f.ownerId);
        const range = f.from === f.to ? f.from : `${f.from} → ${f.to}${f.ongoing ? ' (仍持續)' : ''}`;
        console.log(
            `${user}  ${f.underlying}  ${range}  ` +
            `worst ${f.worstDay}: short ${f.short}口 vs ${f.shares}股+${f.long}長倉口 → 缺 ${f.worstGap} 股`
        );
    }
    console.log(`\n${findings.length} naked period(s) total.`);
}
