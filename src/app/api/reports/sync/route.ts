import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2 || !env.R2_OTHER || !env.DB_OTHER) {
            return NextResponse.json({ error: 'Sync bindings not configured' }, { status: 500 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);
        const dbOther = group === 'scott' && env.DB_SCOTT_OTHER ? env.DB_SCOTT_OTHER : env.DB_OTHER;

        if (!dbOther) {
            return NextResponse.json({ error: 'DB_OTHER binding not configured for this group' }, { status: 500 });
        }

        // Fetch all report filenames from current DB
        const localReports = await db.prepare('SELECT filename FROM report_archives').all();
        const localFilenames = new Set(localReports.results.map((r: any) => r.filename as string));

        // Fetch reports from other DB
        const remoteReports = await dbOther.prepare('SELECT id, filename, bucket_key, statement_date FROM report_archives ORDER BY statement_date DESC').all();
        
        const missingReports = remoteReports.results.filter((r: any) => !localFilenames.has(r.filename as string));

        if (missingReports.length === 0) {
            return NextResponse.json({ success: true, synced: 0, remaining: 0, message: 'All reports are synced.' });
        }

        const BATCH_SIZE = 2;
        const toSync = missingReports.slice(0, BATCH_SIZE);

        let syncedCount = 0;

        for (const report of toSync) {
            try {
                const remoteObj = await env.R2_OTHER.get(report.bucket_key as string);
                if (!remoteObj) {
                    console.warn(`File not found in R2_OTHER: ${report.bucket_key}`);
                    continue;
                }

                const content = await remoteObj.arrayBuffer();

                // Put to local R2
                await env.R2.put(report.bucket_key as string, content, {
                    httpMetadata: remoteObj.httpMetadata
                });

                // Insert into local DB
                await db.prepare(`
                    INSERT INTO report_archives (filename, bucket_key, statement_date, created_at)
                    VALUES (?, ?, ?, unixepoch())
                `).bind(report.filename, report.bucket_key, report.statement_date).run();

                syncedCount++;
            } catch (err) {
                console.error(`Failed to sync report ${report.filename}:`, err);
            }
        }

        const remaining = missingReports.length - syncedCount;

        return NextResponse.json({ 
            success: true, 
            synced: syncedCount, 
            remaining: Math.max(0, remaining),
            message: `Synced ${syncedCount} reports. ${remaining > 0 ? remaining + ' remaining.' : ''}`
        });

    } catch (error: any) {
        console.error('Report Sync failed:', error);
        return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
    }
}
