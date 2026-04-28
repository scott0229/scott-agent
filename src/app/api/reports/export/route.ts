import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const accountId = request.nextUrl.searchParams.get('accountId');
        if (!accountId) {
            return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        let records;
        if (accountId === 'All') {
            records = await db.prepare(
                'SELECT bucket_key, filename FROM report_archives ORDER BY statement_date DESC LIMIT 5000'
            ).all<{ bucket_key: string, filename: string }>();
        } else {
            // Fetch up to 1000 latest reports for safety
            records = await db.prepare(
                'SELECT bucket_key, filename FROM report_archives WHERE filename LIKE ? ORDER BY statement_date DESC LIMIT 1000'
            ).bind(`%${accountId}%`).all<{ bucket_key: string, filename: string }>();
        }

        if (!records.results || records.results.length === 0) {
            return NextResponse.json({ error: 'No reports found for this account' }, { status: 404 });
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2) {
            return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
        }

        const zip = new JSZip();
        
        const chunkSize = 20;
        for (let i = 0; i < records.results.length; i += chunkSize) {
            const chunk = records.results.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (record: { bucket_key: string, filename: string }) => {
                try {
                    const object = await env.R2.get(record.bucket_key);
                    if (object) {
                        const arrayBuffer = await object.arrayBuffer();
                        zip.file(record.filename, arrayBuffer);
                    }
                } catch (err) {
                    console.warn(`Failed to fetch file ${record.filename} from R2 for export:`, err);
                }
            }));
        }

        const zipContent = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });

        const headers = new Headers();
        headers.set('Content-Type', 'application/zip');
        const downloadFilename = accountId === 'All' ? 'all_historical_reports.zip' : `${accountId}_historical_reports.zip`;
        headers.set('Content-Disposition', `attachment; filename="${downloadFilename}"`);

        return new NextResponse(zipContent as unknown as BodyInit, {
            headers,
        });

    } catch (error: any) {
        console.error('Export account reports failed:', error);
        return NextResponse.json({ error: 'Failed to generate zip export' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const admin = await verifyToken(request.cookies.get('token')?.value || '');
        if (!admin || !['admin', 'manager'].includes(admin.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const accountIds: string[] = body.accountIds;
        if (!Array.isArray(accountIds) || accountIds.length === 0) {
            return NextResponse.json({ error: 'Account IDs array is required' }, { status: 400 });
        }

        const group = await getGroupFromRequest(request);
        const db = await getDb(group);

        const allRecords = await db.prepare(
            'SELECT bucket_key, filename FROM report_archives ORDER BY statement_date DESC LIMIT 5000'
        ).all<{ bucket_key: string, filename: string }>();

        const targetIds = new Set(accountIds.map(id => id.toUpperCase()));
        const records = {
            results: (allRecords.results || []).filter((r: { bucket_key: string, filename: string }) => {
                let accId = null;
                const match = r.filename.match(/^([A-Z]+\d+)_/i);
                if (match) {
                    accId = match[1].toUpperCase();
                } else {
                    const m = r.filename.match(/(U\d+)/i);
                    if (m) accId = m[1].toUpperCase();
                }
                return accId && targetIds.has(accId);
            })
        };

        if (!records.results || records.results.length === 0) {
            return NextResponse.json({ error: 'No reports found for selected accounts' }, { status: 404 });
        }

        const { env } = await getCloudflareContext();
        if (!env || !env.R2) {
            return NextResponse.json({ error: 'R2 storage not configured' }, { status: 500 });
        }

        const zip = new JSZip();
        
        const chunkSize = 20;
        for (let i = 0; i < records.results.length; i += chunkSize) {
            const chunk = records.results.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (record: { bucket_key: string, filename: string }) => {
                try {
                    const object = await env.R2.get(record.bucket_key);
                    if (object) {
                        const arrayBuffer = await object.arrayBuffer();
                        zip.file(record.filename, arrayBuffer);
                    }
                } catch (err) {
                    console.warn(`Failed to fetch file ${record.filename} from R2 for export:`, err);
                }
            }));
        }

        const zipContent = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });

        const headers = new Headers();
        headers.set('Content-Type', 'application/zip');
        const dateStr = new Date().toISOString().split('T')[0];
        headers.set('Content-Disposition', `attachment; filename="selected_historical_reports_${dateStr}.zip"`);

        return new NextResponse(zipContent as unknown as BodyInit, {
            headers,
        });

    } catch (error: any) {
        console.error('Batch export account reports failed:', error);
        return NextResponse.json({ error: 'Failed to generate zip export' }, { status: 500 });
    }
}
