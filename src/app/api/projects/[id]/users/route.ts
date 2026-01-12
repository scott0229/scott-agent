import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// GET: List users assigned to a project
export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const token = req.cookies.get('token')?.value;
        if (!token) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const payload = await verifyToken(token);
        if (!payload) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        const db = await getDb();
        const projectId = parseInt(params.id);

        // Get assigned users
        const users = await db.prepare(`
      SELECT u.* FROM USERS u
      INNER JOIN PROJECT_USERS pu ON u.id = pu.user_id
      WHERE pu.project_id = ?
    `).bind(projectId).all();

        return NextResponse.json({ success: true, users: users.results });

    } catch (error) {
        console.error('Get project users error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT: Update users assigned to a project
export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const token = req.cookies.get('token')?.value;
        if (!token) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const payload = await verifyToken(token);
        if (!payload) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        // Check admin/manager permission
        if (payload.role !== 'admin' && payload.role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { userIds } = await req.json() as { userIds: number[] };
        const db = await getDb();
        const projectId = parseInt(params.id);

        // Delete all existing assignments
        await db.prepare('DELETE FROM PROJECT_USERS WHERE project_id = ?').bind(projectId).run();

        // Insert new assignments
        if (userIds && userIds.length > 0) {
            for (const userId of userIds) {
                await db.prepare(
                    'INSERT INTO PROJECT_USERS (project_id, user_id) VALUES (?, ?)'
                ).bind(projectId, userId).run();
            }
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Update project users error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
