import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { customAlphabet } from 'nanoid';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: '未提供檔案' }, { status: 400 });
        }

        const html = await file.text();

        // Very basic parsing just to find the statement date for archival sorting
        const titleMatch = html.match(/<title>.*?(?:活動賬單|活動總結)\s+([\u4e00-\u9fff]+)\s+(\d+),\s+(\d{4})/);
        let statementDateStr = new Date().toISOString().split('T')[0]; // fallback
        
        if (titleMatch) {
            const MONTH_MAP: Record<string, number> = {
                '一月': 1, '二月': 2, '三月': 3, '四月': 4,
                '五月': 5, '六月': 6, '七月': 7, '八月': 8,
                '九月': 9, '十月': 10, '十一月': 11, '十二月': 12
            };
            const monthCn = titleMatch[1];
            const day = parseInt(titleMatch[2]);
            const year = parseInt(titleMatch[3]);
            const month = MONTH_MAP[monthCn];
            if (month) {
                statementDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2) {
            return NextResponse.json({ error: 'R2 storage not configured properly on backend' }, { status: 500 });
        }

        const rawFilename = file.name || 'historical_report.html';
        const baseFilename = rawFilename.split('/').pop() || rawFilename;

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const existing = await db.prepare('SELECT id, bucket_key FROM report_archives WHERE filename = ?').bind(baseFilename).first();

        let r2Key;
        if (existing) {
            r2Key = existing.bucket_key as string;
            await env.R2.put(r2Key, html, {
                httpMetadata: { contentType: file.type || 'text/html' },
            });
            await db.prepare('UPDATE report_archives SET statement_date = ?, created_at = unixepoch() WHERE id = ?')
                .bind(statementDateStr, existing.id)
                .run();
        } else {
            const ext = baseFilename.split('.').pop() || 'html';
            r2Key = `reports/historical_${statementDateStr}_${customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)()}.${ext}`;
            await env.R2.put(r2Key, html, {
                httpMetadata: { contentType: file.type || 'text/html' },
            });
            await db.prepare(`
                INSERT INTO report_archives (filename, bucket_key, statement_date, created_at)
                VALUES (?, ?, ?, unixepoch())
            `).bind(baseFilename, r2Key, statementDateStr).run();
        }

        return NextResponse.json({ 
            success: true, 
            message: `檔案 ${baseFilename} (日期: ${statementDateStr}) 已成功歸檔`
        });

    } catch (error: any) {
        console.error('Archive-Only Upload failed:', error);
        return NextResponse.json({ error: error.message || '上傳失敗' }, { status: 500 });
    }
}
