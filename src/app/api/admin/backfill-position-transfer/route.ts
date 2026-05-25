import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * One-shot backfill: re-parse every archived IB report from R2, extract
 * 存款和取款 + 持倉轉帳, and patch DAILY_NET_EQUITY.deposit on rows where
 * the historical value missed the 持倉轉帳 line (the parser only started
 * counting it after this commit).
 *
 * Admin-only. Safe to re-run — idempotent (only updates rows where the
 * recomputed deposit differs from what's already stored).
 *
 * GET  → dry-run, returns what would change without writing
 * POST → applies the updates
 */

export const dynamic = 'force-dynamic';

const MONTH_MAP: Record<string, number> = {
    '一月': 1, '二月': 2, '三月': 3, '四月': 4,
    '五月': 5, '六月': 6, '七月': 7, '八月': 8,
    '九月': 9, '十月': 10, '十一月': 11, '十二月': 12,
};

function parseNumber(str: string): number {
    const cleaned = str.replace(/,/g, '').trim();
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

interface ParsedReport {
    userAlias: string;
    year: number;
    dateUnix: number;
    dateStr: string;
    depositField: number;          // 存款和取款
    positionTransfer: number;      // 持倉轉帳
    totalDeposit: number;          // sum — what should land in DAILY_NET_EQUITY.deposit
}

function parseReport(html: string): ParsedReport | null {
    const titleMatch = html.match(/<title>.*?(?:活動賬單|活動總結)\s+([一-鿿]+)\s+(\d+),\s+(\d{4})/);
    if (!titleMatch) return null;
    const month = MONTH_MAP[titleMatch[1]];
    if (!month) return null;
    const day = parseInt(titleMatch[2], 10);
    const year = parseInt(titleMatch[3], 10);

    const aliasMatch = html.match(/賬戶化名<\/td>\s*<td>(.*?)<\/td>/);
    if (!aliasMatch) return null;
    const userAlias = aliasMatch[1].trim();

    let depositField = 0;
    const depositMatch = html.match(/存款和取款<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
    if (depositMatch) depositField = parseNumber(depositMatch[1]);

    let positionTransfer = 0;
    const ptMatch = html.match(/持倉轉[帳賬]<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
    if (ptMatch) positionTransfer = parseNumber(ptMatch[1]);

    const dateUnix = Math.floor(Date.UTC(year, month - 1, day) / 1000);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    return {
        userAlias,
        year,
        dateUnix,
        dateStr,
        depositField,
        positionTransfer,
        totalDeposit: depositField + positionTransfer,
    };
}

interface DiffRow {
    filename: string;
    userAlias: string;
    date: string;
    oldDeposit: number;
    depositField: number;
    positionTransfer: number;
    newDeposit: number;
}

// R2 fetches dominate runtime; do them in parallel chunks so a single
// request can chew through hundreds of archives before the worker
// CPU limit kicks in.
const R2_CONCURRENCY = 25;

async function buildDiff(request: NextRequest) {
    const admin = await verifyToken(request.cookies.get('token')?.value || '');
    if (!admin || !['admin', 'manager'].includes(admin.role)) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    const { env } = await getCloudflareContext();
    if (!env || !env.R2) {
        return { error: NextResponse.json({ error: 'R2 not configured' }, { status: 500 }) };
    }

    const group = await getGroupFromRequest(request);
    const db = await getDb(group);

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '300', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const total = await db.prepare('SELECT COUNT(*) as n FROM report_archives').first<{ n: number }>();
    const archives = await db.prepare(
        'SELECT id, filename, bucket_key, statement_date FROM report_archives ORDER BY statement_date LIMIT ? OFFSET ?'
    ).bind(limit, offset).all();

    const diffs: DiffRow[] = [];
    const skipped: { filename: string; reason: string }[] = [];
    let parsed = 0;
    let noChange = 0;

    const rows = archives.results as any[];

    // Fetch + parse in parallel chunks
    type Parsed = { filename: string; result: ParsedReport | null; missingR2?: boolean };
    const parsedAll: Parsed[] = [];
    for (let i = 0; i < rows.length; i += R2_CONCURRENCY) {
        const chunk = rows.slice(i, i + R2_CONCURRENCY);
        const chunkParsed = await Promise.all(chunk.map(async (row): Promise<Parsed> => {
            const filename = row.filename as string;
            const obj = await env.R2.get(row.bucket_key as string);
            if (!obj) return { filename, result: null, missingR2: true };
            const html = await obj.text();
            return { filename, result: parseReport(html) };
        }));
        parsedAll.push(...chunkParsed);
    }

    // DB lookups stay sequential (D1 single-flight is cheap; the bottleneck was R2).
    for (const { filename, result, missingR2 } of parsedAll) {
        if (missingR2) {
            skipped.push({ filename, reason: 'R2 object missing' });
            continue;
        }
        if (!result) {
            skipped.push({ filename, reason: 'Title or alias not parseable' });
            continue;
        }
        parsed++;

        // 持倉轉帳 is the only thing that matters here — if a report doesn't
        // have one, its existing row is already correct.
        if (result.positionTransfer === 0) {
            noChange++;
            continue;
        }

        // Look up the user (year-scoped) and the daily_net_equity row.
        const user = await db.prepare(
            'SELECT id FROM USERS WHERE user_id = ? AND year = ?'
        ).bind(result.userAlias, result.year).first<{ id: number }>();
        if (!user) {
            skipped.push({ filename, reason: `User "${result.userAlias}" (${result.year}) not found` });
            continue;
        }
        const existing = await db.prepare(
            'SELECT id, deposit FROM DAILY_NET_EQUITY WHERE user_id = ? AND date = ?'
        ).bind(user.id, result.dateUnix).first<{ id: number; deposit: number }>();
        if (!existing) {
            skipped.push({ filename, reason: `No DAILY_NET_EQUITY row for ${result.dateStr}` });
            continue;
        }

        const oldDeposit = existing.deposit ?? 0;
        if (Math.abs(oldDeposit - result.totalDeposit) < 0.005) {
            noChange++;
            continue;
        }

        diffs.push({
            filename,
            userAlias: result.userAlias,
            date: result.dateStr,
            oldDeposit,
            depositField: result.depositField,
            positionTransfer: result.positionTransfer,
            newDeposit: result.totalDeposit,
        });
    }

    return {
        db,
        pagination: {
            totalArchives: total?.n ?? 0,
            offset,
            limit,
            returned: rows.length,
            nextOffset: offset + rows.length < (total?.n ?? 0) ? offset + rows.length : null,
        },
        summary: {
            inBatch: rows.length,
            parsed,
            noChange,
            toUpdate: diffs.length,
            skippedCount: skipped.length,
        },
        diffs,
        skipped,
    };
}

export async function GET(request: NextRequest) {
    const result = await buildDiff(request);
    if ('error' in result) return result.error;
    const { db: _db, ...rest } = result;
    return NextResponse.json({ dryRun: true, ...rest });
}

export async function POST(request: NextRequest) {
    const result = await buildDiff(request);
    if ('error' in result) return result.error;
    const { db, diffs, summary, skipped, pagination } = result;

    let updated = 0;
    for (const d of diffs) {
        await db.prepare(
            'UPDATE DAILY_NET_EQUITY SET deposit = ? WHERE user_id = (SELECT id FROM USERS WHERE user_id = ? AND year = ?) AND date = ?'
        ).bind(
            d.newDeposit,
            d.userAlias,
            parseInt(d.date.slice(0, 4), 10),
            Math.floor(Date.UTC(
                parseInt(d.date.slice(0, 4), 10),
                parseInt(d.date.slice(5, 7), 10) - 1,
                parseInt(d.date.slice(8, 10), 10),
            ) / 1000),
        ).run();
        updated++;
    }

    return NextResponse.json({
        applied: true,
        pagination,
        summary: { ...summary, updated },
        diffs,
        skipped,
    });
}
