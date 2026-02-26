import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: Get item details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // Check project ownership (optional but good for security)
    // const project = ... 

    const item = await db.prepare(`
      SELECT 
        ITEMS.*, 
        Creator.email as creator_email, 
        Creator.avatar_url as creator_avatar,
        Updater.email as updater_email, 
        Updater.avatar_url as updater_avatar,
        Assignee.email as assignee_email,
        Assignee.user_id as assignee_user_id,
        Assignee.avatar_url as assignee_avatar
      FROM ITEMS
      LEFT JOIN USERS as Creator ON ITEMS.created_by = Creator.id
      LEFT JOIN USERS as Updater ON ITEMS.updated_by = Updater.id
      LEFT JOIN USERS as Assignee ON ITEMS.assignee_id = Assignee.id
      WHERE ITEMS.id = ? AND ITEMS.project_id = ?
    `).bind(itemId, id).first();

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('Get item error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT: Update item
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
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

    const { id, itemId } = await params;
    const { title, content, status, milestoneId, assigneeId } = await req.json() as {
      title?: string;
      content?: string;
      status?: string;
      milestoneId?: number;
      assigneeId?: number;
    };

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // Check project ownership
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const existing = await db.prepare(
      'SELECT * FROM ITEMS WHERE id = ? AND project_id = ?'
    ).bind(itemId, id).first();

    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    await db.prepare(
      'UPDATE ITEMS SET title = ?, content = ?, status = ?, assignee_id = ?, updated_by = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(
      title || existing.title,
      content !== undefined ? content : existing.content,
      status || existing.status,
      assigneeId === null ? null : (assigneeId !== undefined ? assigneeId : existing.assignee_id),
      payload.id,
      itemId
    ).run();

    const item = await db.prepare('SELECT * FROM ITEMS WHERE id = ?').bind(itemId).first();

    return NextResponse.json({ success: true, item });

  } catch (error) {
    console.error('Update item error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Delete item
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
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

    const { id, itemId } = await params;
    const group = await getGroupFromRequest(req);
    const db = await getDb(group);

    // Check project ownership
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const existing = await db.prepare(
      'SELECT * FROM ITEMS WHERE id = ? AND project_id = ?'
    ).bind(itemId, id).first();

    if (!existing) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    await db.prepare('DELETE FROM ITEMS WHERE id = ?').bind(itemId).run();

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Delete item error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
