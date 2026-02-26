import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: List user's projects
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);
    let projects;

    // Admin and manager see all projects
    if (payload.role === 'admin' || payload.role === 'manager') {
      projects = await db.prepare(`
        SELECT p.*, u.user_id as owner_user_id, u.email as owner_email,
        (SELECT COUNT(*) FROM ITEMS WHERE project_id = p.id) as task_count
        FROM PROJECTS p
        LEFT JOIN USERS u ON p.user_id = u.id
        ORDER BY p.created_at DESC
      `).all();
    } else {
      // Customer and trader see only assigned projects
      projects = await db.prepare(`
        SELECT p.*, u.user_id as owner_user_id, u.email as owner_email,
        (SELECT COUNT(*) FROM ITEMS WHERE project_id = p.id) as task_count
        FROM PROJECTS p
        LEFT JOIN USERS u ON p.user_id = u.id
        INNER JOIN PROJECT_USERS pu ON p.id = pu.project_id
        WHERE pu.user_id = ?
        ORDER BY p.created_at DESC
      `).bind(payload.id).all();
    }

    return NextResponse.json({ success: true, projects: projects.results });

  } catch (error) {
    console.error('Get projects error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create new project
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { name, description, avatarUrl, userIds } = await req.json() as {
      name?: string;
      description?: string;
      avatarUrl?: string;
      userIds?: number[];
    };

    if (!name) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // Create project
    const result = await db.prepare(
      'INSERT INTO PROJECTS (user_id, name, description, avatar_url) VALUES (?, ?, ?, ?)'
    ).bind(payload.id, name, description || null, avatarUrl || null).run();

    if (!result.success) {
      throw new Error('Failed to create project');
    }

    const projectId = result.meta.last_row_id;

    // Assign users to project if provided
    if (userIds && userIds.length > 0) {
      for (const userId of userIds) {
        await db.prepare(
          'INSERT INTO PROJECT_USERS (project_id, user_id) VALUES (?, ?)'
        ).bind(projectId, userId).run();
      }
    }

    // Get the newly created project
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ?'
    ).bind(projectId).first();

    return NextResponse.json({ success: true, project });

  } catch (error) {
    console.error('Create project error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
