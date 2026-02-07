import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { customAlphabet } from 'nanoid';

export const dynamic = 'force-dynamic';

const generateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

// Chinese month names used in IB statements
const MONTH_MAP: Record<string, number> = {
    '一月': 1, '二月': 2, '三月': 3, '四月': 4,
    '五月': 5, '六月': 6, '七月': 7, '八月': 8,
    '九月': 9, '十月': 10, '十一月': 11, '十二月': 12
};

function parseNumber(str: string): number {
    const cleaned = str.replace(/,/g, '').trim();
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

interface ParsedStockTrade {
    symbol: string;
    dateTime: string;       // e.g. "2026-02-06, 16:14:47"
    quantity: number;       // positive=buy, negative=sell
    tradePrice: number;
    closePrice: number;
    realizedPnL: number;
    tradeCode: string;      // "O", "C", "O;P", "C;P", etc.
    isOpen: boolean;        // code contains "O"
    isClose: boolean;       // code contains "C"
}

interface TradeAction {
    type: 'open' | 'close_full' | 'close_split';
    symbol: string;
    quantity: number;
    price: number;
    date: number;           // unix timestamp
    // For close actions:
    existingTradeId?: number;
    existingCode?: string;
    existingQuantity?: number;
    existingOpenPrice?: number;
    existingOpenDate?: number;
    remainingQuantity?: number; // for splits: how many remain open
}

function parseIBStockTrades(html: string): {
    trades: ParsedStockTrade[];
    date: number;
    dateStr: string;
    year: number;
    userAlias: string;
} {
    // 1. Extract date from <title>
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
    const date = new Date(Date.UTC(year, month - 1, day));
    const dateUnix = Math.floor(date.getTime() / 1000);
    const dateStr = `${String(year).slice(2)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // 2. Extract account alias
    const aliasMatch = html.match(/賬戶化名<\/td>\s*<td>(.*?)<\/td>/);
    if (!aliasMatch) {
        throw new Error('無法從報表解析賬戶化名');
    }
    const userAlias = aliasMatch[1].trim();

    // 3. Find the Transactions section
    const txnSectionMatch = html.match(/id="tblTransactions_[^"]*Body"[^>]*>([\s\S]*?)<\/table>/);
    if (!txnSectionMatch) {
        return { trades: [], date: dateUnix, dateStr, year, userAlias };
    }

    // 4. Find the FIRST stock section (before 股票和指數期權)
    // The section starts with <td class="header-asset"...>股票</td>
    // and ends at the next header-asset or the end of the table
    const txnHtml = txnSectionMatch[1];

    // Find stock trades: between "股票" header and next header (股票和指數期權 or end)
    const stockSectionMatch = txnHtml.match(
        /header-asset[^>]*>股票<\/td>[\s\S]*?<\/tbody>([\s\S]*?)(?=<thead>|<\/table>|header-asset[^>]*>股票和指數期權)/
    );

    if (!stockSectionMatch) {
        return { trades: [], date: dateUnix, dateStr, year, userAlias };
    }
    const stockHtml = stockSectionMatch[1];

    // 5. Parse individual trade rows (skip subtotal/total rows and currency headers)
    const trades: ParsedStockTrade[] = [];
    const tradeRowRegex = /<tbody>\s*<tr>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>\s*<\/tbody>/g;

    let tradeMatch;
    while ((tradeMatch = tradeRowRegex.exec(stockHtml)) !== null) {
        const symbol = tradeMatch[1].trim();
        const dateTime = tradeMatch[2].trim();
        const quantity = parseNumber(tradeMatch[3]);
        const tradePrice = parseNumber(tradeMatch[4]);
        const closePrice = parseNumber(tradeMatch[5]);
        const realizedPnL = parseNumber(tradeMatch[9]);
        const tradeCode = tradeMatch[11].replace(/&nbsp;/g, '').trim();

        // Skip header/currency rows
        if (!symbol || !dateTime || symbol === 'USD') continue;

        trades.push({
            symbol,
            dateTime,
            quantity,
            tradePrice,
            closePrice,
            realizedPnL,
            tradeCode,
            isOpen: tradeCode.includes('O'),
            isClose: tradeCode.includes('C'),
        });
    }

    return { trades, date: dateUnix, dateStr, year, userAlias };
}

async function generateUniqueCode(db: any): Promise<string> {
    let code = generateCode();
    let attempts = 0;
    while (attempts < 10) {
        const existing = await db.prepare('SELECT id FROM STOCK_TRADES WHERE code = ?').bind(code).first();
        if (!existing) return code;
        code = generateCode();
        attempts++;
    }
    throw new Error('Failed to generate unique code');
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
        const { trades: rawTrades, date, dateStr, year, userAlias } = parseIBStockTrades(html);

        // Merge same-day same-symbol open trades (weighted average price)
        const mergedMap = new Map<string, typeof rawTrades[0]>();
        const trades: typeof rawTrades = [];
        for (const t of rawTrades) {
            if (t.isOpen && !t.isClose) {
                const key = `${t.symbol}`;
                const existing = mergedMap.get(key);
                if (existing) {
                    // Weighted average price
                    const totalQty = existing.quantity + t.quantity;
                    existing.tradePrice = (existing.tradePrice * existing.quantity + t.tradePrice * t.quantity) / totalQty;
                    existing.quantity = totalQty;
                } else {
                    const clone = { ...t };
                    mergedMap.set(key, clone);
                    trades.push(clone);
                }
            } else {
                trades.push(t);
            }
        }

        if (trades.length === 0) {
            return NextResponse.json({
                success: true,
                message: '報表中無股票交易記錄',
                trades: [],
                actions: [],
            });
        }

        // Look up user
        const db = await getDb();
        const userResult = await db.prepare(
            'SELECT id, user_id FROM USERS WHERE user_id = ? AND year = ?'
        ).bind(userAlias, year).first<{ id: number; user_id: string }>();

        if (!userResult) {
            return NextResponse.json({
                error: `找不到帳號 "${userAlias}" (${year} 年度)`,
            }, { status: 404 });
        }

        // Get existing open positions for this user
        const { results: existingPositions } = await db.prepare(
            `SELECT id, symbol, quantity, open_date, open_price, code
             FROM STOCK_TRADES 
             WHERE owner_id = ? AND status = 'Open' AND year = ?
             ORDER BY open_date ASC`
        ).bind(userResult.id, year).all<{
            id: number; symbol: string; quantity: number;
            open_date: number; open_price: number; code: string;
        }>();

        // Build action plan
        const actions: TradeAction[] = [];
        const warnings: string[] = [];

        // Clone positions for simulation
        const positionPool = (existingPositions || []).map((p: { id: number; symbol: string; quantity: number; open_date: number; open_price: number; code: string }) => ({
            ...p,
            remainingQty: p.quantity,
        }));

        for (const trade of trades) {
            if (trade.isOpen && !trade.isClose) {
                // Pure open trade
                actions.push({
                    type: 'open',
                    symbol: trade.symbol,
                    quantity: Math.abs(trade.quantity),
                    price: trade.tradePrice,
                    date,
                });
            } else if (trade.isClose) {
                // Close trade - FIFO match
                let remainingToClose = Math.abs(trade.quantity);
                const symbolPositions = positionPool.filter(
                    (p: { symbol: string; remainingQty: number }) => p.symbol === trade.symbol && p.remainingQty > 0
                );

                if (symbolPositions.length === 0) {
                    warnings.push(`⚠️ ${trade.symbol}: 系統無 Open 持倉，無法平倉 ${remainingToClose} 股`);
                    continue;
                }

                const totalAvailable = symbolPositions.reduce((sum: number, p: { remainingQty: number }) => sum + p.remainingQty, 0);
                if (totalAvailable < remainingToClose) {
                    warnings.push(`⚠️ ${trade.symbol}: 系統持倉 ${totalAvailable} 股不足以平倉 ${remainingToClose} 股`);
                }

                for (const pos of symbolPositions) {
                    if (remainingToClose <= 0) break;

                    if (pos.remainingQty <= remainingToClose) {
                        // Full close
                        actions.push({
                            type: 'close_full',
                            symbol: trade.symbol,
                            quantity: pos.remainingQty,
                            price: trade.tradePrice,
                            date,
                            existingTradeId: pos.id,
                            existingCode: pos.code,
                            existingQuantity: pos.quantity,
                            existingOpenPrice: pos.open_price,
                            existingOpenDate: pos.open_date,
                        });
                        remainingToClose -= pos.remainingQty;
                        pos.remainingQty = 0;
                    } else {
                        // Partial close (split)
                        const closeQty = remainingToClose;
                        const remainQty = pos.remainingQty - closeQty;
                        actions.push({
                            type: 'close_split',
                            symbol: trade.symbol,
                            quantity: closeQty,
                            price: trade.tradePrice,
                            date,
                            existingTradeId: pos.id,
                            existingCode: pos.code,
                            existingQuantity: pos.quantity,
                            existingOpenPrice: pos.open_price,
                            existingOpenDate: pos.open_date,
                            remainingQuantity: remainQty,
                        });
                        pos.remainingQty = remainQty;
                        remainingToClose = 0;
                    }
                }
            }
        }

        // Preview mode
        if (!confirm) {
            return NextResponse.json({
                success: true,
                userName: userResult.user_id,
                dateStr,
                trades,
                actions,
                warnings,
            });
        }

        // === Execute mode ===
        let created = 0;
        let closed = 0;
        let split = 0;

        for (const action of actions) {
            if (action.type === 'open') {
                const code = await generateUniqueCode(db);
                await db.prepare(`
                    INSERT INTO STOCK_TRADES (
                        symbol, status, open_date, open_price, quantity,
                        user_id, owner_id, year, code, updated_at
                    ) VALUES (?, 'Open', ?, ?, ?, ?, ?, ?, ?, unixepoch())
                `).bind(
                    action.symbol,
                    action.date,
                    action.price,
                    action.quantity,
                    userResult.user_id,
                    userResult.id,
                    year,
                    code,
                ).run();
                created++;

            } else if (action.type === 'close_full') {
                await db.prepare(`
                    UPDATE STOCK_TRADES SET
                        status = 'Closed', close_date = ?, close_price = ?, updated_at = unixepoch()
                    WHERE id = ?
                `).bind(action.date, action.price, action.existingTradeId).run();
                closed++;

            } else if (action.type === 'close_split') {
                // 1. Update original record: reduce quantity and close it
                await db.prepare(`
                    UPDATE STOCK_TRADES SET
                        quantity = ?, status = 'Closed', close_date = ?, close_price = ?, updated_at = unixepoch()
                    WHERE id = ?
                `).bind(action.quantity, action.date, action.price, action.existingTradeId).run();

                // 2. Create new record for remaining open quantity
                const code = await generateUniqueCode(db);
                await db.prepare(`
                    INSERT INTO STOCK_TRADES (
                        symbol, status, open_date, open_price, quantity,
                        user_id, owner_id, year, code, updated_at
                    ) VALUES (?, 'Open', ?, ?, ?, ?, ?, ?, ?, unixepoch())
                `).bind(
                    action.symbol,
                    action.existingOpenDate, // Keep original open_date for the remaining open portion
                    action.existingOpenPrice, // Keep original open price
                    action.remainingQuantity,
                    userResult.user_id,
                    userResult.id,
                    year,
                    code,
                ).run();
                split++;
            }
        }

        return NextResponse.json({
            success: true,
            userName: userResult.user_id,
            dateStr,
            created,
            closed,
            split,
            totalActions: actions.length,
        });

    } catch (error: any) {
        console.error('Import IB stock trades error:', error);
        return NextResponse.json({
            error: error.message || '匯入失敗',
        }, { status: 500 });
    }
}
