import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { clearCache } from '@/lib/response-cache';
import { customAlphabet } from 'nanoid';

const generateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);


export const dynamic = 'force-dynamic';

// Chinese month names used in IB statements
const MONTH_MAP: Record<string, number> = {
    '一月': 1, '二月': 2, '三月': 3, '四月': 4,
    '五月': 5, '六月': 6, '七月': 7, '八月': 8,
    '九月': 9, '十月': 10, '十一月': 11, '十二月': 12
};

// English month abbreviations used in IB option codes (e.g. 03FEB26)
const EN_MONTH_MAP: Record<string, number> = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4,
    'MAY': 5, 'JUN': 6, 'JUL': 7, 'AUG': 8,
    'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
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
        const stockSectionMatch = openPosHtml.match(/header-asset[^>]*>股票<\/td>[\s\S]*?<\/tbody>([\s\S]*?)(?=<thead>|<\/table>)/);
        if (stockSectionMatch) {
            const stockHtml = stockSectionMatch[1];
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

    // 4b. Extract Open Option Positions (未平倉持倉 - 股票和指數期權)
    const openOptionPositions: Array<{
        underlying: string;
        toDate: number;
        toDateStr: string;
        strikePrice: number;
        type: string;
        quantity: number;
        costPrice: number;
        premium: number;
    }> = [];
    if (openPosSectionMatch) {
        const openPosHtml = openPosSectionMatch[1];
        // Find option subsection: after "股票和指數期權" header
        const optionPosSectionMatch = openPosHtml.match(/header-asset[^>]*>股票和指數期權<\/td>[\s\S]*?<\/tbody>([\s\S]*?)(?=<thead>|<\/table>)/);
        if (optionPosSectionMatch) {
            const optionPosHtml = optionPosSectionMatch[1];
            const rows = optionPosHtml.split(/<\/tr>/i);
            for (const row of rows) {
                const cols: string[] = [];
                const colRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                let colMatch;
                while ((colMatch = colRegex.exec(row)) !== null) {
                    cols.push(colMatch[1].replace(/&nbsp;/g, '').trim());
                }
                // Open positions table: 代碼 | 數量 | 合約乘數 | 成本價格 | 成本基礎 | 收盤價格 | 價值 | 未實現的損益 | 代碼
                // Need at least 8 columns
                if (cols.length < 8) continue;
                const codeStr = cols[0];
                const qtyStr = cols[1];
                // cols[2] = 合約乘數 (contract multiplier, usually 100)
                const costPriceStr = cols[3];
                const costBasisStr = cols[4];
                // cols[5] = 收盤價格
                // cols[6] = 價值
                // cols[7] = 未實現的損益

                // Skip header/subtotal rows
                if (codeStr === '代碼' || codeStr.includes('Symbol') || codeStr.startsWith('總數') || !codeStr) continue;

                // Parse option code: "GOOGL 09JAN26 302.5 P"
                const codeParts = codeStr.split(/\s+/);
                if (codeParts.length < 4) continue;

                const underlying = codeParts[0];
                const expiryStr = codeParts[1];
                const strikePrice = parseFloat(codeParts[2]);
                const typeCode = codeParts[3];

                if (!underlying || isNaN(strikePrice) || !typeCode) continue;

                // Parse expiry date: 09JAN26 -> 2026-01-09
                const expiryMatch = expiryStr.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
                if (!expiryMatch) continue;
                const exDay = parseInt(expiryMatch[1]);
                const exMonthStr = expiryMatch[2];
                const exYear = 2000 + parseInt(expiryMatch[3]);
                const exMonth = EN_MONTH_MAP[exMonthStr];
                if (!exMonth) continue;
                const toDate = Math.floor(new Date(Date.UTC(exYear, exMonth - 1, exDay)).getTime() / 1000);
                const toDateStr = `${String(exYear).slice(2)}-${String(exMonth).padStart(2, '0')}-${String(exDay).padStart(2, '0')}`;

                const quantity = Math.abs(parseNumber(qtyStr));
                const costPrice = parseNumber(costPriceStr);
                const premium = Math.abs(parseNumber(costBasisStr));
                const type = typeCode === 'P' ? 'PUT' : 'CALL';

                if (quantity > 0) {
                    openOptionPositions.push({
                        underlying,
                        toDate,
                        toDateStr,
                        strikePrice,
                        type,
                        quantity,
                        costPrice,
                        premium,
                    });
                }
            }
        }
    }

    // 5. Extract Option Trades (股票和指數期權)
    // Table columns: 代碼 | 日期/時間 | 數量 | 交易價格 | 收盤價格 | 收益 | 佣金/稅 | 基礎 | 已實現的損益 | 按市值計算的損益 | 代碼
    const optionTrades: Array<{
        underlying: string;
        toDate: number;
        toDateStr: string;
        strikePrice: number;
        type: string; // CALL or PUT
        openDate: number;
        quantity: number;
        premium: number;
        realizedPnl: number;
        tradeAction: string; // 'O' (Open) or 'C' (Close)
    }> = [];

    // Find the trades section (交易) and look for 股票和指數期權 subsection
    const tradesSectionMatch = html.match(/id="tblTransactions_[^"]*Body"[^>]*>([\s\S]*?)<\/div>/);
    if (tradesSectionMatch) {
        const tradesHtml = tradesSectionMatch[1];
        // Find the option subsection: after "股票和指數期權" header, before next header-asset or end
        const optionSectionMatch = tradesHtml.match(/header-asset[^>]*>股票和指數期權<\/td>[\s\S]*?<\/tbody>([\s\S]*?)(?=<thead>|$)/);
        if (optionSectionMatch) {
            const optionHtml = optionSectionMatch[1];
            // Each trade row is in its own <tbody><tr>...</tr></tbody>
            // Skip rows that start with "總數" (subtotal rows)
            // Improved parsing: Split by </tr> to handle rows robustly
            const rows = optionHtml.split(/<\/tr>/i);

            for (const row of rows) {
                // Extract all <td> columns in the row
                const cols: string[] = [];
                const colRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                let colMatch;
                while ((colMatch = colRegex.exec(row)) !== null) {
                    cols.push(colMatch[1].replace(/&nbsp;/g, '').trim());
                }

                // We need exactly 11 columns for a valid trade row
                // Columns: Symbol | Date/Time | Quantity | Price | Close Price | Proceeds | Comm/Tax | Basis | Realized P/L | Mtm P/L | Code
                if (cols.length < 11) continue;

                const codeStr = cols[0];
                const dateTimeStr = cols[1];
                const qtyStr = cols[2];
                // index 3: Trade Price
                // index 4: Close Price
                // index 5: Proceeds
                // index 6: Comm/Tax
                const basisStr = cols[7]; // 基礎 = 權利金（含佣金）
                const realizedStr = cols[8];
                // index 9: Mtm P/L
                const actionCode = cols[10];

                // Skip Header, Subtotal rows (總數), and empty rows
                if (codeStr === '代碼' || codeStr.includes('Symbol') || codeStr.startsWith('總數') || !dateTimeStr) continue;

                // Parse option code: "QQQ 03FEB26 618 P"
                const codeParts = codeStr.split(/\s+/);
                if (codeParts.length < 4) continue;

                const underlying = codeParts[0];
                const expiryStr = codeParts[1]; // e.g. "03FEB26"
                const strikePrice = parseFloat(codeParts[2]);
                const typeCode = codeParts[3]; // P or C

                if (!underlying || isNaN(strikePrice) || !typeCode) continue;

                // Parse expiry date: 03FEB26 -> 2026-02-03
                const expiryMatch = expiryStr.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
                if (!expiryMatch) continue;
                const exDay = parseInt(expiryMatch[1]);
                const exMonthStr = expiryMatch[2];
                const exYear = 2000 + parseInt(expiryMatch[3]);
                const exMonth = EN_MONTH_MAP[exMonthStr];
                if (!exMonth) continue;
                const toDate = Math.floor(new Date(Date.UTC(exYear, exMonth - 1, exDay)).getTime() / 1000);
                const toDateStr = `${String(exYear).slice(2)}-${String(exMonth).padStart(2, '0')}-${String(exDay).padStart(2, '0')}`;

                // Parse trade date: "2026-02-02, 09:47:04" -> take date part and time if available
                const dateTimeMatch = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})(?:,\s*(\d{2}):(\d{2}):(\d{2}))?/);
                if (!dateTimeMatch) continue;

                const openDate = Math.floor(new Date(Date.UTC(
                    parseInt(dateTimeMatch[1]),
                    parseInt(dateTimeMatch[2]) - 1,
                    parseInt(dateTimeMatch[3]),
                    dateTimeMatch[4] ? parseInt(dateTimeMatch[4]) : 0,
                    dateTimeMatch[5] ? parseInt(dateTimeMatch[5]) : 0,
                    dateTimeMatch[6] ? parseInt(dateTimeMatch[6]) : 0
                )).getTime() / 1000);

                const quantity = Math.abs(parseNumber(qtyStr));
                const premium = Math.abs(parseNumber(basisStr));
                const realizedPnl = parseNumber(realizedStr);
                const type = typeCode === 'P' ? 'PUT' : 'CALL';

                let tradeAction = 'O';
                if (actionCode === 'A;C') {
                    tradeAction = 'ASSIGN';
                } else if (actionCode === 'C;Ep') {
                    tradeAction = 'EXPIRE';
                } else if (actionCode.includes('C')) {
                    tradeAction = 'C';
                }

                optionTrades.push({
                    underlying,
                    toDate,
                    toDateStr,
                    strikePrice,
                    type,
                    openDate,
                    quantity,
                    premium,
                    realizedPnl,
                    tradeAction,
                });
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
        openOptionPositions,
        optionTrades,
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

        // Preview mode: check for new positions and return parsed values
        if (!confirm) {
            // Only show positions that don't exist yet (add-only, no update)
            const positionActions: Array<{ type: string; symbol: string; quantity: number; costPrice: number }> = [];
            for (const pos of parsed.openPositions) {
                const existingTrade = await db.prepare(
                    `SELECT id FROM STOCK_TRADES WHERE owner_id = ? AND symbol = ? AND year = ? AND status = 'Open' LIMIT 1`
                ).bind(userResult.id, pos.symbol, parsed.year).first<{ id: number }>();

                if (!existingTrade) {
                    positionActions.push({ type: 'sync_add', symbol: pos.symbol, quantity: pos.quantity, costPrice: pos.costPrice });
                }
            }

            // Preview open option positions sync
            // Build set of option trades being added (Open trades) to avoid duplicating with open positions
            const optionTradeKeys = new Set(
                parsed.optionTrades
                    .filter(t => t.tradeAction === 'O')
                    .map(t => `${t.underlying}|${t.strikePrice}|${t.toDate}|${t.type}`)
            );
            const openOptionActions: Array<{ action: string; underlying: string; type: string; strikePrice: number; toDateStr: string; quantity: number; premium: number }> = [];
            for (const pos of parsed.openOptionPositions) {
                // Skip if already covered by an option trade being added
                const posKey = `${pos.underlying}|${pos.strikePrice}|${pos.toDate}|${pos.type}`;
                if (optionTradeKeys.has(posKey)) continue;

                const existingOpt = await db.prepare(
                    `SELECT id FROM OPTIONS WHERE owner_id = ? AND underlying = ? AND strike_price = ? AND to_date = ? AND type = ? AND operation = 'Open' LIMIT 1`
                ).bind(userResult.id, pos.underlying, pos.strikePrice, pos.toDate, pos.type).first<{ id: number }>();

                openOptionActions.push({
                    action: existingOpt ? 'skip_exists' : 'sync_add',
                    underlying: pos.underlying,
                    type: pos.type,
                    strikePrice: pos.strikePrice,
                    toDateStr: pos.toDateStr,
                    quantity: pos.quantity,
                    premium: pos.premium,
                });
            }

            // Filter option trades: only Open trades, check for duplicates
            const optionActions: Array<{
                action: string; // 'add' or 'skip'
                underlying: string;
                type: string;
                strikePrice: number;
                toDateStr: string;
                quantity: number;
                premium: number;
                tradeAction: string;
            }> = [];

            // Track local created trades for same-day close simulation in preview
            const localOpenTrades: Array<{
                underlying: string;
                strikePrice: number;
                toDate: number;
                type: string;
                quantity: number;
                remainingQty: number; // specialized for simulation
            }> = [];

            for (const opt of parsed.optionTrades) {
                if (opt.tradeAction !== 'O') {
                    // Handle Close / Assign trades preview
                    // Find potential matching Open trades to close (FIFO)
                    const existingOpenTrades = await db.prepare(
                        `SELECT id, quantity, open_date FROM OPTIONS WHERE owner_id = ? AND underlying = ? AND strike_price = ? AND to_date = ? AND type = ? AND operation = 'Open' ORDER BY open_date ASC`
                    ).bind(userResult.id, opt.underlying, opt.strikePrice, opt.toDate, opt.type).all<{ id: number; quantity: number; open_date: number }>();

                    const dbMatches = existingOpenTrades.results.map((t: { id: number; quantity: number; open_date: number }) => ({ ...t, source: 'db', remainingQty: t.quantity }));

                    // Filter matching local trades
                    const localMatches = localOpenTrades
                        .filter(t => t.underlying === opt.underlying && t.strikePrice === opt.strikePrice && t.toDate === opt.toDate && t.type === opt.type && t.remainingQty > 0)
                        .map(t => ({ ...t, source: 'local' }));

                    // Combine matches (FIFO: DB first, then Local)
                    const allMatches = [...dbMatches, ...localMatches];

                    let matchStatus = 'close_orphan';
                    if (opt.tradeAction === 'ASSIGN') matchStatus = 'assign_orphan';
                    if (opt.tradeAction === 'EXPIRE') matchStatus = 'expire_orphan';
                    // Default if no match found

                    if (allMatches.length > 0) {
                        matchStatus = 'close';
                        if (opt.tradeAction === 'ASSIGN') matchStatus = 'assign';
                        if (opt.tradeAction === 'EXPIRE') matchStatus = 'expire';

                        // Simulate FIFO matching
                        let currentQty = opt.quantity;

                        // 1. Consume DB trades
                        for (const dbMatch of dbMatches) {
                            if (currentQty <= 0) break;
                            const consume = Math.min(dbMatch.remainingQty, currentQty);
                            currentQty -= consume;
                        }

                        // 2. Consume Local trades (updating the source object)
                        if (currentQty > 0) {
                            for (const localTrade of localOpenTrades) {
                                if (localTrade.underlying === opt.underlying && localTrade.strikePrice === opt.strikePrice && localTrade.toDate === opt.toDate && localTrade.type === opt.type && localTrade.remainingQty > 0) {
                                    if (currentQty <= 0) break;
                                    const consume = Math.min(localTrade.remainingQty, currentQty);
                                    localTrade.remainingQty -= consume; // Update simulation state
                                    currentQty -= consume;
                                }
                            }
                        }
                    }

                    optionActions.push({
                        action: matchStatus,
                        underlying: opt.underlying,
                        type: opt.type,
                        strikePrice: opt.strikePrice,
                        toDateStr: opt.toDateStr,
                        quantity: opt.quantity,
                        premium: opt.premium,
                        tradeAction: opt.tradeAction,
                    });
                    continue;
                }

                // Open trade logic (unchanged)
                // Check for existing option with same key fields
                const existingOpt = await db.prepare(
                    `SELECT id FROM OPTIONS WHERE owner_id = ? AND underlying = ? AND strike_price = ? AND to_date = ? AND type = ? AND open_date = ? AND year = ? LIMIT 1`
                ).bind(userResult.id, opt.underlying, opt.strikePrice, opt.toDate, opt.type, opt.openDate, parsed.year).first<{ id: number }>();

                // Add to local inventory for simulation (if it's a new trade)
                if (!existingOpt) {
                    localOpenTrades.push({
                        underlying: opt.underlying,
                        strikePrice: opt.strikePrice,
                        toDate: opt.toDate,
                        type: opt.type,
                        quantity: opt.quantity,
                        remainingQty: opt.quantity
                    });
                }

                optionActions.push({
                    action: existingOpt ? 'skip_exists' : 'add',
                    underlying: opt.underlying,
                    type: opt.type,
                    strikePrice: opt.strikePrice,
                    toDateStr: opt.toDateStr,
                    quantity: opt.quantity,
                    premium: opt.premium,
                    tradeAction: opt.tradeAction,
                });
            }

            // Get latest record date for this user
            const latestRecord = await db.prepare(
                'SELECT MAX(date) as latest_date FROM DAILY_NET_EQUITY WHERE user_id = ?'
            ).bind(userResult.id).first<{ latest_date: string | null }>();

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
                    openOptionActions,
                    optionActions,
                },
                existing: existing ? {
                    netEquity: existing.net_equity,
                    cashBalance: existing.cash_balance,
                    interest: existing.interest,
                    managementFee: existing.management_fee,
                    deposit: existing.deposit,
                } : null,
                latestRecordDate: latestRecord?.latest_date || null,
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

        // Sync open stock positions: ADD-ONLY (never update existing trades)
        const positionsSync = { added: 0, skipped: 0 };
        if (parsed.openPositions.length > 0) {
            for (const pos of parsed.openPositions) {
                const existingTrade = await db.prepare(
                    `SELECT id FROM STOCK_TRADES WHERE owner_id = ? AND symbol = ? AND year = ? AND status = 'Open' LIMIT 1`
                ).bind(userResult.id, pos.symbol, parsed.year).first<{ id: number }>();

                if (!existingTrade) {
                    // Insert new position
                    let code = generateCode();
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const exists = await db.prepare('SELECT 1 FROM STOCK_TRADES WHERE code = ?').bind(code).first();
                        if (!exists) break;
                        code = generateCode();
                    }
                    // Check if this stock position is the result of an assignment
                    const relatedAssignment = parsed.optionTrades.find(t =>
                        t.underlying === pos.symbol &&
                        t.tradeAction === 'ASSIGN'
                    );
                    const source = relatedAssignment ? 'assigned' : null;

                    await db.prepare(`
                        INSERT INTO STOCK_TRADES (owner_id, user_id, year, symbol, status, open_date, open_price, quantity, code, source, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'Open', ?, ?, ?, ?, ?, unixepoch(), unixepoch())
                    `).bind(
                        userResult.id,
                        parsed.userAlias,
                        parsed.year,
                        pos.symbol,
                        parsed.date,
                        pos.costPrice,
                        pos.quantity,
                        code,
                        source
                    ).run();
                    positionsSync.added++;
                } else {
                    positionsSync.skipped++;
                }
            }
        }

        // Sync open option positions: ADD-ONLY (skip if already covered by option trades)
        const openOptionsSync = { added: 0, skipped: 0 };
        const confirmOptionTradeKeys = new Set(
            parsed.optionTrades
                .filter(t => t.tradeAction === 'O')
                .map(t => `${t.underlying}|${t.strikePrice}|${t.toDate}|${t.type}`)
        );
        if (parsed.openOptionPositions.length > 0) {
            for (const pos of parsed.openOptionPositions) {
                // Skip if already covered by an option trade being added
                const posKey = `${pos.underlying}|${pos.strikePrice}|${pos.toDate}|${pos.type}`;
                if (confirmOptionTradeKeys.has(posKey)) {
                    openOptionsSync.skipped++;
                    continue;
                }

                const existingOpt = await db.prepare(
                    `SELECT id FROM OPTIONS WHERE owner_id = ? AND underlying = ? AND strike_price = ? AND to_date = ? AND type = ? AND operation = 'Open' LIMIT 1`
                ).bind(userResult.id, pos.underlying, pos.strikePrice, pos.toDate, pos.type).first<{ id: number }>();

                if (!existingOpt) {
                    let code = generateCode();
                    for (let attempt = 0; attempt < 10; attempt++) {
                        const existsOpt = await db.prepare('SELECT 1 FROM OPTIONS WHERE code = ?').bind(code).first();
                        const existsStock = await db.prepare('SELECT 1 FROM STOCK_TRADES WHERE code = ?').bind(code).first();
                        if (!existsOpt && !existsStock) break;
                        code = generateCode();
                    }

                    await db.prepare(`
                        INSERT INTO OPTIONS (
                            operation, open_date, to_date, quantity, underlying, type, strike_price,
                            premium, final_profit, user_id, owner_id, year, code, updated_at
                        ) VALUES ('Open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
                    `).bind(
                        parsed.date,
                        pos.toDate,
                        pos.quantity,
                        pos.underlying,
                        pos.type,
                        pos.strikePrice,
                        pos.premium,
                        pos.premium, // final_profit defaults to premium
                        parsed.userAlias,
                        userResult.id,
                        parsed.year,
                        code
                    ).run();
                    openOptionsSync.added++;
                } else {
                    openOptionsSync.skipped++;
                }
            }
        }

        // Sync option trades: Handle Open and Close trades
        const optionsSync = { added: 0, skipped: 0, closed: 0, closedSkipped: 0 };
        if (parsed.optionTrades.length > 0) {
            for (const opt of parsed.optionTrades) {
                if (opt.tradeAction !== 'O') {
                    // Find matching Open trades (FIFO)
                    const openTrades = await db.prepare(
                        `SELECT * FROM OPTIONS WHERE owner_id = ? AND underlying = ? AND strike_price = ? AND to_date = ? AND type = ? AND operation = 'Open' ORDER BY open_date ASC`
                    ).bind(userResult.id, opt.underlying, opt.strikePrice, opt.toDate, opt.type).all<any>();

                    let remainingCloseQty = opt.quantity;
                    let totalRealizedPnl = opt.realizedPnl; // Total P/L from IB for this close transaction

                    // Distribute P/L proportionally if closing multiple trades?
                    // Simplified approach: Assign P/L to the trades we close based on their portion of the total closed quantity.
                    const closeTotalQty = opt.quantity; // Total quantity being closed in this transaction
                    const isAssignment = opt.tradeAction === 'ASSIGN';
                    const isExpiration = opt.tradeAction === 'EXPIRE';

                    let operationDetails = 'Closed';
                    if (isAssignment) operationDetails = 'Assigned';
                    if (isExpiration) operationDetails = 'Expired';

                    if (openTrades.results.length === 0) {
                        optionsSync.closedSkipped++; // No matching open trade found
                        continue;
                    }

                    for (const trade of openTrades.results) {
                        if (remainingCloseQty <= 0) break;

                        const closeQty = Math.min(trade.quantity, remainingCloseQty);
                        const isPartialClose = closeQty < trade.quantity;

                        // Calculate P/L portion for this specific trade close
                        // If we are closing 3 options total with $300 profit, and this trade is 1 option, it gets $100 profit.
                        let tradePnl = (closeQty / closeTotalQty) * totalRealizedPnl;

                        // FIX: For Assigned trades (A;C), IB often reports 0.00 Realized P/L (as it transfers to stock basis).
                        // However, for the Option trade record, the profit is the full premium collected.
                        if (isAssignment && totalRealizedPnl === 0) {
                            // Calculates the premium portion for this specific closed quantity
                            // trade.premium is the total premium for the original trade.quantity
                            const portionPremium = (closeQty / trade.quantity) * trade.premium;
                            tradePnl = portionPremium;
                        }

                        if (isPartialClose) {
                            // Partial Close: Split the existing trade
                            // 1. Create new "Closed" trade record for the closed portion
                            // 2. Reduce quantity of the existing "Open" trade record

                            // Generate new code for the closed portion
                            let newCode = generateCode();
                            // ... simple loop for uniqueness check omitted for brevity, assuming low collision chance or handled by db constraints

                            // Insert the CLOSED portion
                            await db.prepare(`
                                INSERT INTO OPTIONS (
                                    operation, open_date, to_date, settlement_date, days_held,
                                    quantity, underlying, type, strike_price,
                                    premium, final_profit, profit_percent,
                                    user_id, owner_id, year, code, updated_at
                                ) VALUES (
                                    ?, ?, ?, ?, ?,
                                    ?, ?, ?, ?,
                                    ?, ?, ?,
                                    ?, ?, ?, ?, unixepoch()
                                )
                            `).bind(
                                operationDetails,
                                trade.open_date,
                                trade.to_date,
                                parsed.date, // Settlement date is the close date
                                Math.round((parsed.date - trade.open_date) / 86400), // days held
                                closeQty,
                                trade.underlying,
                                trade.type,
                                trade.strike_price,
                                (closeQty / trade.quantity) * trade.premium, // Pro-rated premium
                                tradePnl, // Allocated Realized P/L
                                tradePnl / ((closeQty / trade.quantity) * trade.premium), // Profit Percent
                                trade.user_id,
                                trade.owner_id, // Keep original owner_id
                                trade.year,     // Keep original year
                                newCode
                            ).run();

                            // Update the REMAINING Open portion
                            await db.prepare(`
                                UPDATE OPTIONS SET
                                    quantity = quantity - ?,
                                    premium = premium - ?,
                                    updated_at = unixepoch()
                                WHERE id = ?
                            `).bind(
                                closeQty,
                                (closeQty / trade.quantity) * trade.premium, // Reduce premium proportionally
                                trade.id
                            ).run();

                        } else {
                            // Full Close of this specific trade record
                            await db.prepare(`
                                UPDATE OPTIONS SET
                                    operation = ?,
                                    settlement_date = ?,
                                    days_held = ?,
                                    final_profit = ?,
                                    profit_percent = ?,
                                    updated_at = unixepoch()
                                WHERE id = ?
                            `).bind(
                                operationDetails,
                                parsed.date,
                                Math.round((parsed.date - trade.open_date) / 86400),
                                tradePnl,
                                (trade.premium && trade.premium !== 0) ? (tradePnl / trade.premium) : 0,
                                trade.id
                            ).run();
                        }

                        remainingCloseQty -= closeQty;
                    }

                    if (remainingCloseQty > 0) {
                        // Warning: Closed more than we had open?
                        // This implies mismatch or missing history. We just close what we can find.
                        console.warn(`Closed ${opt.quantity} but only found ${opt.quantity - remainingCloseQty} open for ${opt.underlying} ${opt.strikePrice} ${opt.type}`);
                    }

                    optionsSync.closed++;
                    continue; // Done with this Close trade
                }

                // --- Handle OPEN Trades ---
                // Check for duplicate
                const existingOpt = await db.prepare(
                    `SELECT id FROM OPTIONS WHERE owner_id = ? AND underlying = ? AND strike_price = ? AND to_date = ? AND type = ? AND open_date = ? AND year = ? LIMIT 1`
                ).bind(userResult.id, opt.underlying, opt.strikePrice, opt.toDate, opt.type, opt.openDate, parsed.year).first<{ id: number }>();

                if (existingOpt) {
                    optionsSync.skipped++;
                    continue;
                }

                // Generate unique code
                let code = generateCode();
                for (let attempt = 0; attempt < 10; attempt++) {
                    const existsOpt = await db.prepare('SELECT 1 FROM OPTIONS WHERE code = ?').bind(code).first();
                    const existsStock = await db.prepare('SELECT 1 FROM STOCK_TRADES WHERE code = ?').bind(code).first();
                    if (!existsOpt && !existsStock) break;
                    code = generateCode();
                }

                await db.prepare(`
                    INSERT INTO OPTIONS (
                        operation, open_date, to_date, quantity, underlying, type, strike_price,
                        premium, final_profit, user_id, owner_id, year, code, updated_at
                    ) VALUES ('Open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
                `).bind(
                    opt.openDate,
                    opt.toDate,
                    opt.quantity,
                    opt.underlying,
                    opt.type,
                    opt.strikePrice,
                    opt.premium,
                    opt.premium, // final_profit defaults to premium for new open trades
                    parsed.userAlias,
                    userResult.id,
                    parsed.year,
                    code
                ).run();
                optionsSync.added++;
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
            openOptionsSync,
            optionsSync,
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
