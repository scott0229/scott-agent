import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// GET: List items for project with search and filters
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
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const assigneeId = searchParams.get('assigneeId');

    const sort = searchParams.get('sort');
    const order = searchParams.get('order');

    const db = await getDb();

    // Check if user can view items (admin, manager, project owner, or assigned user)
    let project;

    if (payload.role === 'admin' || payload.role === 'manager') {
      // Admin and manager can view any project
      project = await db.prepare('SELECT * FROM PROJECTS WHERE id = ?').bind(id).first();
    } else {
      // Check if user is project owner OR assigned to project
      project = await db.prepare(
        'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
      ).bind(id, payload.id).first();

      // If not owner, check if user is assigned to project
      if (!project) {
        const assignedProject = await db.prepare(`
          SELECT p.* FROM PROJECTS p
          INNER JOIN PROJECT_USERS pu ON p.id = pu.project_id
          WHERE p.id = ? AND pu.user_id = ?
        `).bind(id, payload.id).first();

        if (assignedProject) {
          project = assignedProject;
        }
      }
    }

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    let query = `
      SELECT 
        ITEMS.*, 
        Creator.email as creator_email, 
        Creator.user_id as creator_user_id,
        Creator.avatar_url as creator_avatar,
        Assignee.email as assignee_email,
        Assignee.user_id as assignee_user_id,
        Assignee.avatar_url as assignee_avatar
      FROM ITEMS 
      LEFT JOIN USERS as Creator ON ITEMS.created_by = Creator.id
      LEFT JOIN USERS as Assignee ON ITEMS.assignee_id = Assignee.id
      WHERE ITEMS.project_id = ?
    `;
    const queryParams: any[] = [id];

    if (search) {
      query += ' AND (ITEMS.title LIKE ? OR ITEMS.content LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      query += ' AND ITEMS.status = ?';
      queryParams.push(status);
    }

    if (assigneeId) {
      if (assigneeId === 'unassigned') {
        query += ' AND ITEMS.assignee_id IS NULL';
      } else if (assigneeId === 'me') {
        query += ' AND ITEMS.assignee_id = ?';
        queryParams.push(payload.id);
      } else {
        query += ' AND ITEMS.assignee_id = ?';
        queryParams.push(Number(assigneeId));
      }
    }

    // Validate sort column
    const allowedSortColumns = ['created_at', 'updated_at'];
    const sortColumn = allowedSortColumns.includes(sort || '') ? sort : 'created_at';
    const sortOrder = (order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY ITEMS.${sortColumn} ${sortOrder}`;

    const items = await db.prepare(query).bind(...queryParams).all();

    return NextResponse.json({ success: true, items: items.results });

  } catch (error) {
    console.error('Get items error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create new item
export async function POST(
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
    const { title, content, status, milestoneId, assigneeId } = await req.json() as {
      title?: string;
      content?: string;
      status?: string;
      milestoneId?: number;
      assigneeId?: number;
    };

    if (!title) {
      return NextResponse.json({ error: 'Item title is required' }, { status: 400 });
    }

    const db = await getDb();

    // Check if user can create items (admin, manager, project owner, or assigned user)
    let project;

    if (payload.role === 'admin' || payload.role === 'manager') {
      // Admin and manager can create items in any project
      project = await db.prepare('SELECT * FROM PROJECTS WHERE id = ?').bind(id).first();
    } else {
      // Check if user is project owner OR assigned to project
      project = await db.prepare(
        'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
      ).bind(id, payload.id).first();

      // If not owner, check if user is assigned to project
      if (!project) {
        const assignedProject = await db.prepare(`
          SELECT p.* FROM PROJECTS p
          INNER JOIN PROJECT_USERS pu ON p.id = pu.project_id
          WHERE p.id = ? AND pu.user_id = ?
        `).bind(id, payload.id).first();

        if (assignedProject) {
          project = assignedProject;
        }
      }
    }

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const result = await db.prepare(
      'INSERT INTO ITEMS (project_id, title, content, status, milestone_id, assignee_id, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      title,
      content || '',
      status || 'New',
      milestoneId || null,
      assigneeId || null,
      payload.id,
      payload.id
    ).run();

    if (!result.success) {
      throw new Error('Failed to create item');
    }

    const item = await db.prepare('SELECT * FROM ITEMS WHERE id = ?').bind(result.meta.last_row_id).first();

    return NextResponse.json({ success: true, item });

  } catch (error) {
    console.error('Create item error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
