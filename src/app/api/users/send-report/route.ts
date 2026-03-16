import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        // Verify admin/manager access
        const token = req.cookies.get('token')?.value;
        if (!token) {
            return NextResponse.json({ error: '未授權' }, { status: 401 });
        }

        const decodedToken = await verifyToken(token);
        if (!decodedToken || (decodedToken.role !== 'admin' && decodedToken.role !== 'manager')) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const { userId, report, userName, dateStr } = await req.json();

        if (!userId || !report) {
            return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Look up the user's email
        const user = await db.prepare('SELECT email FROM USERS WHERE id = ?').bind(userId).first();
        if (!user || !user.email) {
            return NextResponse.json({ error: '找不到用戶或用戶沒有設定 Email' }, { status: 404 });
        }

        const recipientEmail = user.email as string;

        // Validate it looks like an email
        if (!recipientEmail.includes('@')) {
            return NextResponse.json({ error: '用戶 Email 格式不正確' }, { status: 400 });
        }

        // Build email subject with date
        const subject = dateStr
            ? `帳戶報告 - ${userName} (${dateStr})`
            : `帳戶報告 - ${userName}`;

        // Send via Resend API
        const resendApiKey = process.env.RESEND_API_KEY;
        if (!resendApiKey) {
            return NextResponse.json({ error: 'Email 服務未設定' }, { status: 500 });
        }

        const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'Scott Agent <onboarding@resend.dev>',
                to: [recipientEmail],
                subject,
                text: report,
            }),
        });

        const emailData = await emailRes.json();

        if (!emailRes.ok) {
            console.error('Resend API error:', emailData);
            return NextResponse.json({ error: emailData.message || '發送失敗' }, { status: 500 });
        }

        return NextResponse.json({ success: true, emailId: emailData.id });

    } catch (error) {
        console.error('Send report email error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
