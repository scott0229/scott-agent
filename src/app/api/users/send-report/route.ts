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

        // Escape HTML special characters for safe embedding
        const escapeHtml = (str: string) =>
            str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #1a1a1a; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">${escapeHtml(subject)}</h2>
  <pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit; line-height: 1.6; font-size: 14px;">${escapeHtml(report)}</pre>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 24px;" />
  <p style="font-size: 12px; color: #9ca3af;">此郵件由 Scott Agent 系統自動發送</p>
</body>
</html>`.trim();

        const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'Scott Agent <reports@scott-agent.com>',
                reply_to: 'reports@scott-agent.com',
                to: [recipientEmail],
                subject,
                text: report,
                html: htmlContent,
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
