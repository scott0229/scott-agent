import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: Get project members (owner + assigned users)
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
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

        const { id } = await params;
        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Get project owner
        const project = await db.prepare(
            'SELECT user_id FROM PROJECTS WHERE id = ?'
        ).bind(id).first();

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        // Get all users assigned to this project (including owner)
        const members = await db.prepare(`
      SELECT DISTINCT u.id, u.email, u.user_id, u.role
      FROM USERS u
      WHERE u.id = ?
      UNION
      SELECT DISTINCT u.id, u.email, u.user_id, u.role
      FROM USERS u
      INNER JOIN PROJECT_USERS pu ON u.id = pu.user_id
      WHERE pu.project_id = ?
      ORDER BY u.email
    `).bind(project.user_id, id).all();

        return NextResponse.json({
            success: true,
            members: members.results || []
        });

    } catch (error) {
        console.error('Get project members error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
