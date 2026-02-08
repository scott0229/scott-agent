import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { clearCache } from '@/lib/response-cache';

export const dynamic = 'force-dynamic';

// Chinese month names used in IB statements
const MONTH_MAP: Record<string, number> = {
    '一月': 1, '二月': 2, '三月': 3, '四月': 4,
    '五月': 5, '六月': 6, '七月': 7, '八月': 8,
    '九月': 9, '十月': 10, '十一月': 11, '十二月': 12
};

function parseNumber(str: string): number {
    // Remove commas and parse, e.g. "-70,031.84" -> -70031.84
    const cleaned = str.replace(/,/g, '').trim();
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

function parseIBStatement(html: string) {
    // 1. Extract date from <title>
    // Format: "U18607756 活動賬單 二月 2, 2026 - Interactive Brokers"
    const titleMatch = html.match(/<title>.*?活動賬單\s+([\u4e00-\u9fff]+)\s+(\d+),\s+(\d{4})/);
    if (!titleMatch) {
        throw new Error('無法從報表標題解析日期');
    }
    const monthCn = titleMatch[1];
    const day = parseInt(titleMatch[2]);
    const year = parseInt(titleMatch[3]);
    const month = MONTH_MAP[monthCn];
    if (!month) {
        throw new Error(`無法識別月份: ${monthCn}`);
    }
    // Create date as UTC midnight
    const date = new Date(Date.UTC(year, month - 1, day));
    const dateUnix = Math.floor(date.getTime() / 1000);

    // 2. Extract account alias (賬戶化名)
    const aliasMatch = html.match(/賬戶化名<\/td>\s*<td>(.*?)<\/td>/);
    if (!aliasMatch) {
        throw new Error('無法從報表解析賬戶化名');
    }
    const userAlias = aliasMatch[1].trim();

    // 3. Extract NAV section values
    // Find the NAV section body
    const navSectionMatch = html.match(/id="tblNAV_[^"]*Body"[^>]*>([\s\S]*?)(?=<div class="sectionHeading|<div class="pa-promo)/);
    if (!navSectionMatch) {
        throw new Error('無法找到淨資産值區塊');
    }
    const navHtml = navSectionMatch[1];

    // Extract rows from the LEFT table (main NAV table)
    // Each data row: <tr><td>LABEL</td><td>prev_total</td><td>long</td><td>short</td><td class="...subtotal">CURRENT_TOTAL</td><td>change</td></tr>
    // The subtotal row (總數): <tr class="subtotal"><td>...總數</td>...same pattern...

    let cashBalance = 0;
    let interest = 0;
    let netEquity = 0;
    let managementFee = 0;

    // Match all non-header table rows in NAV section (left table, 6 columns)
    const rowRegex = /<tr(?:\s+class="subtotal")?>[\s]*<td[^>]*>(.*?)<\/td>[\s]*<td[^>]*>([\s\S]*?)<\/td>[\s]*<td[^>]*>([\s\S]*?)<\/td>[\s]*<td[^>]*>([\s\S]*?)<\/td>[\s]*<td[^>]*>([\s\S]*?)<\/td>[\s]*<td[^>]*>([\s\S]*?)<\/td>[\s]*<\/tr>/g;

    let match;
    while ((match = rowRegex.exec(navHtml)) !== null) {
        const label = match[1].replace(/&nbsp;/g, '').trim();
        const currentTotal = match[5].replace(/&nbsp;/g, '').trim(); // 5th td = current date total

        if (label === '現金') {
            cashBalance = parseNumber(currentTotal);
        } else if (label === '應計利息') {
            interest = parseNumber(currentTotal);
        } else if (label === '總數') {
            netEquity = parseNumber(currentTotal);
        }
    }

    // Extract 顧問費用 from the right-side NAV changes panel (2-column table)
    // Search in full HTML because the navHtml regex may stop early at a pa-promo div
    // Structure: <td class="indent">顧問費用</td><td align="right">-646.41</td>
    const feeMatch = html.match(/顧問費用<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
    if (feeMatch) {
        managementFee = parseNumber(feeMatch[1]);
    }

    // Extract 存款和取款 from the right-side NAV changes panel
    let deposit = 0;
    const depositMatch = html.match(/存款和取款<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
    if (depositMatch) {
        deposit = parseNumber(depositMatch[1]);
    }

    // Format date string for display: YY-MM-DD
    const dateStr = `${String(year).slice(2)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Check if this is January 1st (year start)
    const isYearStart = month === 1 && day === 1;

    // 4. Extract Open Stock Positions (未平倉持倉)
    const openPositions: Array<{ symbol: string; quantity: number; costPrice: number }> = [];
    const openPosSectionMatch = html.match(/id="tblOpenPositions_[^"]*Body"[^>]*>([\s\S]*?)<\/div>/);
    if (openPosSectionMatch) {
        const openPosHtml = openPosSectionMatch[1];
        // Find the stock section: starts with header-asset "股票", ends before next header-asset or end
        const stockSectionMatch = openPosHtml.match(/header-asset[^>]*>股票<\/td>[\s\S]*?<\/tbody>([\s\S]*?)(?=<thead>|<\/table>)/);
        if (stockSectionMatch) {
            const stockHtml = stockSectionMatch[1];
            // Match data rows: each tbody contains a single data row
            // Pattern: <tbody><tr><td>SYMBOL</td><td align="right">QTY</td><td align="right">MULT</td><td align="right">COST_PRICE</td>...
            const posRowRegex = /<tbody>\s*<tr>\s*<td>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/g;
            let posMatch;
            while ((posMatch = posRowRegex.exec(stockHtml)) !== null) {
                const symbol = posMatch[1].trim();
                const quantity = parseNumber(posMatch[2]);
                const costPrice = parseNumber(posMatch[3]);
                if (symbol && quantity > 0 && costPrice > 0) {
                    openPositions.push({ symbol, quantity, costPrice });
                }
            }
        }
    }

    return {
        date: dateUnix,
        dateStr,
        year,
        userAlias,
        cashBalance,
        interest,
        netEquity,
        managementFee,
        deposit,
        isYearStart,
        openPositions,
    };
}

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File;
        const confirm = formData.get('confirm') === 'true';

        if (!file) {
            return NextResponse.json({ error: '未提供檔案' }, { status: 400 });
        }

        const html = await file.text();
        const parsed = parseIBStatement(html);

        // Look up user by alias
        const db = await getDb();
        const userResult = await db.prepare(
            'SELECT id, user_id, name FROM USERS WHERE user_id = ? AND year = ?'
        ).bind(parsed.userAlias, parsed.year).first<{ id: number; user_id: string; name: string | null }>();

        if (!userResult) {
            return NextResponse.json({
                error: `找不到帳號 "${parsed.userAlias}" (${parsed.year} 年度)`,
            }, { status: 404 });
        }

        // Check for existing record
        const existing = await db.prepare(
            'SELECT id, net_equity, cash_balance, interest, management_fee, deposit FROM DAILY_NET_EQUITY WHERE user_id = ? AND date = ?'
        ).bind(userResult.id, parsed.date).first<{
            id: number; net_equity: number; cash_balance: number; interest: number; management_fee: number; deposit: number;
        }>();

        // Preview mode: check position changes and return parsed values
        if (!confirm) {
            // Check which positions will have changes
            const positionActions: Array<{ type: string; symbol: string; quantity: number; costPrice: number; existingQuantity?: number; existingPrice?: number }> = [];
            for (const pos of parsed.openPositions) {
                const existingTrade = await db.prepare(
                    `SELECT id, quantity, open_price FROM STOCK_TRADES WHERE owner_id = ? AND symbol = ? AND year = ? AND status = 'Open' LIMIT 1`
                ).bind(userResult.id, pos.symbol, parsed.year).first<{ id: number; quantity: number; open_price: number }>();

                if (!existingTrade) {
                    positionActions.push({ type: 'sync_add', symbol: pos.symbol, quantity: pos.quantity, costPrice: pos.costPrice });
                } else if (existingTrade.quantity !== pos.quantity || Math.abs(existingTrade.open_price - pos.costPrice) > 0.01) {
                    positionActions.push({ type: 'sync_update', symbol: pos.symbol, quantity: pos.quantity, costPrice: pos.costPrice, existingQuantity: existingTrade.quantity, existingPrice: existingTrade.open_price });
                }
                // unchanged positions are not included
            }

            return NextResponse.json({
                preview: true,
                parsed: {
                    date: parsed.date,
                    dateStr: parsed.dateStr,
                    year: parsed.year,
                    userId: userResult.id,
                    userName: userResult.name || userResult.user_id,
                    userAlias: parsed.userAlias,
                    netEquity: parsed.netEquity,
                    cashBalance: parsed.cashBalance,
                    interest: parsed.interest,
                    managementFee: parsed.managementFee,
                    deposit: parsed.deposit,
                    isYearStart: parsed.isYearStart,
                    positionActions,
                },
                existing: existing ? {
                    netEquity: existing.net_equity,
                    cashBalance: existing.cash_balance,
                    interest: existing.interest,
                    managementFee: existing.management_fee,
                    deposit: existing.deposit,
                } : null,
            });
        }

        // Confirm mode
        let yearStartUpdated = false;

        if (parsed.isYearStart) {
            // Jan 1st: only update year-start fields in USERS table, no daily record
            await db.prepare(`
                UPDATE USERS SET
                    initial_cost = ?,
                    initial_cash = ?,
                    initial_management_fee = ?,
                    initial_interest = ?,
                    updated_at = unixepoch()
                WHERE id = ?
            `).bind(
                parsed.netEquity,
                parsed.cashBalance,
                parsed.managementFee,
                parsed.interest,
                userResult.id
            ).run();
            yearStartUpdated = true;
        } else {
            // Normal day: upsert daily net equity record
            await db.prepare(`
                INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, interest, deposit, management_fee, year, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
                ON CONFLICT(user_id, date) DO UPDATE SET
                    net_equity = excluded.net_equity,
                    cash_balance = excluded.cash_balance,
                    interest = excluded.interest,
                    deposit = excluded.deposit,
                    management_fee = excluded.management_fee,
                    updated_at = unixepoch()
            `).bind(
                userResult.id,
                parsed.date,
                parsed.netEquity,
                parsed.cashBalance,
                parsed.interest,
                parsed.deposit,
                parsed.managementFee,
                parsed.year
            ).run();
        }

        // Sync open stock positions to STOCK_TRADES
        const positionsSync = { added: 0, updated: 0, unchanged: 0 };
        if (parsed.openPositions.length > 0) {
            for (const pos of parsed.openPositions) {
                // Check existing open position for this symbol
                const existingTrade = await db.prepare(
                    `SELECT id, quantity, open_price FROM STOCK_TRADES WHERE owner_id = ? AND symbol = ? AND year = ? AND status = 'Open' LIMIT 1`
                ).bind(userResult.id, pos.symbol, parsed.year).first<{ id: number; quantity: number; open_price: number }>();

                if (!existingTrade) {
                    // Insert new position
                    await db.prepare(`
                        INSERT INTO STOCK_TRADES (owner_id, user_id, year, symbol, status, open_date, open_price, quantity, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'Open', ?, ?, ?, unixepoch(), unixepoch())
                    `).bind(
                        userResult.id,
                        parsed.userAlias,
                        parsed.year,
                        pos.symbol,
                        parsed.date,
                        pos.costPrice,
                        pos.quantity
                    ).run();
                    positionsSync.added++;
                } else if (existingTrade.quantity !== pos.quantity || Math.abs(existingTrade.open_price - pos.costPrice) > 0.01) {
                    // Update quantity and/or cost price
                    await db.prepare(`
                        UPDATE STOCK_TRADES SET quantity = ?, open_price = ?, updated_at = unixepoch() WHERE id = ?
                    `).bind(pos.quantity, pos.costPrice, existingTrade.id).run();
                    positionsSync.updated++;
                } else {
                    positionsSync.unchanged++;
                }
            }
        }

        clearCache();

        return NextResponse.json({
            success: true,
            action: yearStartUpdated ? 'year_start' : (existing ? 'updated' : 'created'),
            dateStr: parsed.dateStr,
            userName: userResult.name || userResult.user_id,
            yearStartUpdated,
            positionsSync,
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
