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

        // Preview mode: return parsed values for confirmation
        if (!confirm) {
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

        // Confirm mode: upsert
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

        clearCache();

        return NextResponse.json({
            success: true,
            action: existing ? 'updated' : 'created',
            dateStr: parsed.dateStr,
            userName: userResult.name || userResult.user_id,
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
