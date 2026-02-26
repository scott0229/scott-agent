import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: List comments for an item
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const group = await getGroupFromRequest(req);
  const db = await getDb(group);

  try {
    const comments = await db.prepare(`
      SELECT 
        COMMENTS.*,
        Creator.email as creator_email,
        Creator.avatar_url as creator_avatar
      FROM COMMENTS
      LEFT JOIN USERS as Creator ON COMMENTS.created_by = Creator.id
      WHERE COMMENTS.item_id = ?
      ORDER BY COMMENTS.created_at ASC
    `).bind(itemId).all();

    return NextResponse.json({ success: true, comments: comments.results });
  } catch (error) {
    console.error('Fetch comments error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create a new comment
export async function POST(
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
    const { content } = await req.json() as { content: string };

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);
    
    // Verify item exists and belongs to project
    const item = await db.prepare(
      'SELECT id FROM ITEMS WHERE id = ? AND project_id = ?'
    ).bind(itemId, id).first();

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const result = await db.prepare(
      'INSERT INTO COMMENTS (item_id, content, created_by, updated_by) VALUES (?, ?, ?, ?) RETURNING *'
    ).bind(itemId, content, payload.id, payload.id).first();

    // Fetch full comment with creator info
    const comment = await db.prepare(`
      SELECT 
        COMMENTS.*,
        Creator.email as creator_email,
        Creator.avatar_url as creator_avatar
      FROM COMMENTS
      LEFT JOIN USERS as Creator ON COMMENTS.created_by = Creator.id
      WHERE COMMENTS.id = ?
    `).bind(result.id).first();

    return NextResponse.json({ success: true, comment });
    
  } catch (error) {
    console.error('Create comment error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
