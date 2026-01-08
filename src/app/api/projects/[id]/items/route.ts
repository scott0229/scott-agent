import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// GET: List items for project
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
    const db = await getDb();
    
    // Check project ownership
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const items = await db.prepare(
      'SELECT * FROM ITEMS WHERE project_id = ? ORDER BY created_at DESC'
    ).bind(id).all();

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
    const { title, content } = await req.json() as { title?: string; content?: string };

    if (!title) {
      return NextResponse.json({ error: 'Item title is required' }, { status: 400 });
    }

    const db = await getDb();
    
    // Check project ownership
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const result = await db.prepare(
      'INSERT INTO ITEMS (project_id, title, content) VALUES (?, ?, ?)'
    ).bind(id, title, content || '').run();

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
