import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: Get project details
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

    // Check if user has access (owner, admin, manager, or assigned user)
    let project;
    if (payload.role === 'admin' || payload.role === 'manager') {
      // Admin and manager can access all projects
      project = await db.prepare('SELECT * FROM PROJECTS WHERE id = ?').bind(id).first();
    } else {
      // Customer/Trader can only access assigned projects
      project = await db.prepare(`
        SELECT p.* FROM PROJECTS p
        INNER JOIN PROJECT_USERS pu ON p.id = pu.project_id
        WHERE p.id = ? AND pu.user_id = ?
      `).bind(id, payload.id).first();
    }

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, project });

  } catch (error) {
    console.error('Get project error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT: Update project
export async function PUT(
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
    const { name, description, avatarUrl, userIds } = await req.json() as {
      name?: string;
      description?: string;
      avatarUrl?: string;
      userIds?: number[];
    };

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // Check if user can edit (admin, manager, or project owner)
    let existing;
    if (payload.role === 'admin' || payload.role === 'manager') {
      // Admin and manager can edit any project
      existing = await db.prepare('SELECT * FROM PROJECTS WHERE id = ?').bind(id).first();
    } else {
      // Others can only edit their own projects
      existing = await db.prepare(
        'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
      ).bind(id, payload.id).first();
    }

    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    await db.prepare(
      'UPDATE PROJECTS SET name = ?, description = ?, avatar_url = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(
      name || existing.name,
      description !== undefined ? description : existing.description,
      avatarUrl !== undefined ? avatarUrl : existing.avatar_url,
      id
    ).run();

    // Update user assignments if provided
    if (userIds !== undefined) {
      // Delete existing assignments
      await db.prepare('DELETE FROM PROJECT_USERS WHERE project_id = ?').bind(id).run();

      // Insert new assignments
      if (userIds.length > 0) {
        for (const userId of userIds) {
          await db.prepare(
            'INSERT INTO PROJECT_USERS (project_id, user_id) VALUES (?, ?)'
          ).bind(id, userId).run();
        }
      }
    }

    const project = await db.prepare('SELECT * FROM PROJECTS WHERE id = ?').bind(id).first();

    return NextResponse.json({ success: true, project });

  } catch (error) {
    console.error('Update project error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Delete project
export async function DELETE(
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

    // Check if user can delete (admin, manager, or project owner)
    let existing;
    if (payload.role === 'admin' || payload.role === 'manager') {
      // Admin and manager can delete any project
      existing = await db.prepare('SELECT * FROM PROJECTS WHERE id = ?').bind(id).first();
    } else {
      // Others can only delete their own projects
      existing = await db.prepare(
        'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
      ).bind(id, payload.id).first();
    }

    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Delete project (items will cascade)
    await db.prepare('DELETE FROM PROJECTS WHERE id = ?').bind(id).run();

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Delete project error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
