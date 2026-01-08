import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// PUT: Update a comment
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; commentId: string }> }
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

    const { id, itemId, commentId } = await params;
    const { content } = await req.json() as { content: string };

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const db = await getDb();

    // Verify comment exists and user is owner
    const existing = await db.prepare(
      'SELECT * FROM COMMENTS WHERE id = ? AND item_id = ?'
    ).bind(commentId, itemId).first();

    if (!existing) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    if (existing.created_by !== payload.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await db.prepare(
      'UPDATE COMMENTS SET content = ?, updated_by = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(content, payload.id, commentId).run();

    const comment = await db.prepare(`
      SELECT 
        COMMENTS.*,
        Creator.email as creator_email,
        Creator.avatar_url as creator_avatar
      FROM COMMENTS
      LEFT JOIN USERS as Creator ON COMMENTS.created_by = Creator.id
      WHERE COMMENTS.id = ?
    `).bind(commentId).first();

    return NextResponse.json({ success: true, comment });
    
  } catch (error) {
    console.error('Update comment error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Delete a comment
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; commentId: string }> }
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

    const { id, itemId, commentId } = await params;
    const db = await getDb();

    // Verify comment exists and user is owner
    const existing = await db.prepare(
      'SELECT * FROM COMMENTS WHERE id = ? AND item_id = ?'
    ).bind(commentId, itemId).first();

    if (!existing) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    if (existing.created_by !== payload.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await db.prepare('DELETE FROM COMMENTS WHERE id = ?').bind(commentId).run();

    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error('Delete comment error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
