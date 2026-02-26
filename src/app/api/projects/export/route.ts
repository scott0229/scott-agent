import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET: Export all projects with their tasks and members
export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        if (!token) {
            return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }

        const payload = await verifyToken(token);
        if (!payload || (payload.role !== 'admin' && payload.role !== 'manager')) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Export all projects
        const projectsResult = await db.prepare(`
            SELECT id, name, description, avatar_url, user_id
            FROM PROJECTS
            ORDER BY created_at DESC
        `).all();

        const projects = projectsResult.results || [];

        // For each project, get its tasks and members
        const projectsWithData = await Promise.all(
            projects.map(async (project: any) => {
                // Get project tasks
                const tasksResult = await db.prepare(`
                    SELECT title, content, status, milestone_id, assignee_id, created_by, updated_by
                    FROM ITEMS
                    WHERE project_id = ?
                    ORDER BY created_at DESC
                `).bind(project.id).all();

                // Get project members (assigned users)
                const membersResult = await db.prepare(`
                    SELECT pu.user_id, u.email, u.user_id as user_identifier
                    FROM PROJECT_USERS pu
                    LEFT JOIN USERS u ON pu.user_id = u.id
                    WHERE pu.project_id = ?
                `).bind(project.id).all();

                return {
                    name: project.name,
                    description: project.description,
                    avatar_url: project.avatar_url,
                    user_id: project.user_id,
                    tasks: tasksResult.results || [],
                    members: (membersResult.results || []).map((m: any) => ({
                        user_id: m.user_id,
                        email: m.email,
                        user_identifier: m.user_identifier
                    }))
                };
            })
        );

        return NextResponse.json({
            projects: projectsWithData,
            exportDate: new Date().toISOString(),
            count: projectsWithData.length
        });
    } catch (error) {
        console.error('Export projects error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
