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

        const { userId, report, userName, dateStr, ccEmails, bccExtraReport } = await req.json();

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

        // Render dash separator lines as a proper <hr> so they don't wrap
        // awkwardly on narrow viewports (the 40-dash string has no break
        // points, so word-wrap: break-word splits it mid-sequence). Also
        // consume blank lines surrounding the separator so sections sit
        // flush against the rule (the BCC body joins report + extras
        // with `\n\n---\n`, and the report itself ends with `\n`).
        //
        // Dash count distinguishes section vs. chunk dividers:
        //   20+ dashes  →  full-width dashed rule (heavier)
        //    4–19 dashes →  tighter lighter rule (chunk-level grouping)
        // 20+ MUST be matched first so a long dash run doesn't get
        // greedy-matched by the shorter pattern.
        const renderBodyHtml = (body: string) =>
            escapeHtml(body)
                .replace(
                    /\n*^-{20,}$\n*/gm,
                    '<hr style="border: none; border-top: 1px dashed #cbd5e1; margin: 8px 0;" />'
                )
                .replace(
                    /\n*^-{4,19}$\n*/gm,
                    '<hr style="border: none; border-top: 1px dashed #e5e7eb; margin: 3px 0;" />'
                );

        const buildHtml = (body: string) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #1a1a1a; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">${escapeHtml(subject)}</h2>
  <pre style="white-space: pre-wrap; word-wrap: break-word; font-family: inherit; line-height: 1.6; font-size: 14px;">${renderBodyHtml(body)}</pre>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 24px;" />
  <p style="font-size: 12px; color: #9ca3af;">此郵件由 Scott Agent 系統自動發送</p>
</body>
</html>`.trim();

        const hasBccList = Array.isArray(ccEmails) && ccEmails.length > 0;
        const hasExtras = typeof bccExtraReport === 'string' && bccExtraReport.trim().length > 0;
        const sendEmail = async (payload: any) => {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            return { ok: res.ok, data };
        };

        // The customer-facing report omits the internal 潛在融資 / 持倉 /
        // 未平倉選擇權 block (advisor-only). It's always the LAST section, so
        // cut from the divider just above 潛在融資 to the end. The BCC/同步報表
        // copy (advisor) keeps the full report.
        const stripInternalSection = (body: string): string => {
            const lines = body.split('\n');
            const idx = lines.findIndex((l) => l.startsWith('潛在融資 :'));
            if (idx === -1) return body;
            let cut = idx;
            // Drop the section divider(s) directly above so the mail doesn't end
            // on a dangling rule.
            while (cut > 0 && /^-{4,}$/.test(lines[cut - 1].trim())) cut--;
            return lines.slice(0, cut).join('\n').replace(/\n+$/, '') + '\n';
        };
        const customerReport = stripInternalSection(report);

        const customerPayload = {
            from: 'Scott Agent <reports@scott-agent.com>',
            reply_to: 'reports@scott-agent.com',
            to: [recipientEmail],
            subject,
            text: customerReport,
            html: buildHtml(customerReport),
        };

        // With any BCC recipient the customer and the advisor copy now get
        // DIFFERENT bodies (customer omits the internal section; the BCC/同步報表
        // copy keeps the full report plus optional 交易建議/當日操作 extras), so
        // send two separate envelopes.
        if (hasBccList) {
            const customerRes = await sendEmail(customerPayload);
            if (!customerRes.ok) {
                console.error('Resend API error (customer email):', customerRes.data);
                return NextResponse.json({ error: customerRes.data.message || '客戶寄送失敗' }, { status: 500 });
            }

            const bccBody = hasExtras
                ? `${report}\n\n----------------------------------------\n${bccExtraReport.trim()}`
                : report;
            const bccPayload = {
                from: 'Scott Agent <reports@scott-agent.com>',
                reply_to: 'reports@scott-agent.com',
                to: ['reports@scott-agent.com'],
                bcc: ccEmails,
                subject,
                text: bccBody,
                html: buildHtml(bccBody),
            };
            const bccRes = await sendEmail(bccPayload);
            if (!bccRes.ok) {
                console.error('Resend API error (bcc email):', bccRes.data);
                // Customer succeeded; surface the BCC failure but don't treat as full failure
                return NextResponse.json({
                    success: true,
                    emailId: customerRes.data.id,
                    bccError: bccRes.data.message || 'BCC 寄送失敗',
                });
            }

            return NextResponse.json({ success: true, emailId: customerRes.data.id, bccEmailId: bccRes.data.id });
        }

        // No BCC: single email to the customer only (internal section stripped).
        const { ok, data } = await sendEmail(customerPayload);
        if (!ok) {
            console.error('Resend API error:', data);
            return NextResponse.json({ error: data.message || '發送失敗' }, { status: 500 });
        }
        return NextResponse.json({ success: true, emailId: data.id });

    } catch (error) {
        console.error('Send report email error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
