import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const runtime = 'edge';

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
    const db = await getDb();
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

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
    const { name, description, avatarUrl } = await req.json() as { 
      name?: string; 
      description?: string; 
      avatarUrl?: string;
    };

    const db = await getDb();
    
    // Check ownership
    const existing = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

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
    const db = await getDb();
    
    // Check ownership
    const existing = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

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
