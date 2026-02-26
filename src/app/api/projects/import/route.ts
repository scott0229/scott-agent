import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

interface ImportTask {
    title: string;
    content?: string | null;
    status?: string;
    milestone_id?: number | null;
    assignee_id?: number | null;
    created_by?: number | null;
    updated_by?: number | null;
}

interface ImportMember {
    user_id?: number;
    email?: string;
    user_identifier?: string;
}

interface ImportProject {
    name: string;
    description?: string | null;
    avatar_url?: string | null;
    user_id?: number;
    tasks?: ImportTask[];
    members?: ImportMember[];
}

// POST: Import projects with tasks and members from JSON array
export async function POST(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        if (!token) {
            return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }

        const payload = await verifyToken(token);
        if (!payload || (payload.role !== 'admin' && payload.role !== 'manager')) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const body = await req.json();
        const { projects } = body;

        if (!Array.isArray(projects)) {
            return NextResponse.json({ error: '無效的資料格式' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        let importedProjects = 0;
        let skippedProjects = 0;
        let importedTasks = 0;
        let skippedTasks = 0;
        let importedMembers = 0;
        let skippedMembers = 0;
        const errors: string[] = [];

        for (const project of projects as ImportProject[]) {
            try {
                // Validate required fields
                if (!project.name) {
                    errors.push(`跳過：缺少專案名稱`);
                    skippedProjects++;
                    continue;
                }

                // Check if project already exists (by name and user_id)
                const userId = project.user_id || payload.id;
                const existing = await db.prepare(
                    `SELECT id FROM PROJECTS WHERE name = ? AND user_id = ?`
                ).bind(project.name, userId).first();

                if (existing) {
                    errors.push(`跳過：專案已存在 (${project.name})`);
                    skippedProjects++;
                    continue;
                }

                // Insert new project
                const projectResult = await db.prepare(
                    `INSERT INTO PROJECTS (user_id, name, description, avatar_url, created_at)
                     VALUES (?, ?, ?, ?, unixepoch())`
                ).bind(
                    userId,
                    project.name,
                    project.description || null,
                    project.avatar_url || null
                ).run();

                const projectId = projectResult.meta.last_row_id;
                importedProjects++;

                // Import project members if provided
                if (project.members && Array.isArray(project.members)) {
                    for (const member of project.members) {
                        try {
                            // Find user by user_id or email or user_identifier
                            let userRecord: any = null;

                            if (member.user_id) {
                                userRecord = await db.prepare(
                                    `SELECT id FROM USERS WHERE id = ?`
                                ).bind(member.user_id).first();
                            }

                            if (!userRecord && member.email) {
                                userRecord = await db.prepare(
                                    `SELECT id FROM USERS WHERE email = ?`
                                ).bind(member.email).first();
                            }

                            if (!userRecord && member.user_identifier) {
                                userRecord = await db.prepare(
                                    `SELECT id FROM USERS WHERE user_id = ?`
                                ).bind(member.user_identifier).first();
                            }

                            if (userRecord) {
                                // Check if already assigned
                                const existingMember = await db.prepare(
                                    `SELECT * FROM PROJECT_USERS WHERE project_id = ? AND user_id = ?`
                                ).bind(projectId, userRecord.id).first();

                                if (!existingMember) {
                                    await db.prepare(
                                        `INSERT INTO PROJECT_USERS (project_id, user_id) VALUES (?, ?)`
                                    ).bind(projectId, userRecord.id).run();
                                    importedMembers++;
                                } else {
                                    skippedMembers++;
                                }
                            } else {
                                // User not found (likely deleted), skip silently
                                skippedMembers++;
                            }
                        } catch (memberError: any) {
                            // Only log actual errors (not missing users)
                            errors.push(`成員匯入失敗: ${memberError.message}`);
                            skippedMembers++;
                        }
                    }
                }

                // Import tasks if provided
                if (project.tasks && Array.isArray(project.tasks)) {
                    for (const task of project.tasks) {
                        try {
                            if (!task.title) {
                                skippedTasks++;
                                continue;
                            }

                            await db.prepare(
                                `INSERT INTO ITEMS (project_id, title, content, status, milestone_id, assignee_id, created_by, updated_by, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                            ).bind(
                                projectId,
                                task.title,
                                task.content || '',
                                task.status || 'New',
                                task.milestone_id || null,
                                task.assignee_id || null,
                                task.created_by || payload.id,
                                task.updated_by || payload.id
                            ).run();

                            importedTasks++;
                        } catch (taskError: any) {
                            errors.push(`任務匯入失敗 (${task.title}): ${taskError.message}`);
                            skippedTasks++;
                        }
                    }
                }

            } catch (error: any) {
                errors.push(`匯入失敗 (${project.name}): ${error.message}`);
                skippedProjects++;
            }
        }

        return NextResponse.json({
            success: true,
            importedProjects,
            skippedProjects,
            importedTasks,
            skippedTasks,
            importedMembers,
            skippedMembers,
            total: projects.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import projects error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
