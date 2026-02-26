import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

// GET: List milestones for project
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
    
    // Check project ownership
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const milestones = await db.prepare(
      'SELECT * FROM MILESTONES WHERE project_id = ? ORDER BY due_date ASC'
    ).bind(id).all();

    return NextResponse.json({ success: true, milestones: milestones.results });
    
  } catch (error) {
    console.error('Get milestones error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create new milestone
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
    const { title, description, dueDate } = await req.json() as { 
      title?: string;
      description?: string;
      dueDate?: number;
    };

    if (!title) {
      return NextResponse.json({ error: 'Milestone title is required' }, { status: 400 });
    }

    const group = await getGroupFromRequest(req);
    const db = await getDb(group);
    
    // Check project ownership
    const project = await db.prepare(
      'SELECT * FROM PROJECTS WHERE id = ? AND user_id = ?'
    ).bind(id, payload.id).first();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const result = await db.prepare(
      'INSERT INTO MILESTONES (project_id, title, description, due_date) VALUES (?, ?, ?, ?)'
    ).bind(id, title, description || '', dueDate || null).run();

    if (!result.success) {
      throw new Error('Failed to create milestone');
    }

    const milestone = await db.prepare('SELECT * FROM MILESTONES WHERE id = ?').bind(result.meta.last_row_id).first();

    return NextResponse.json({ success: true, milestone });
    
  } catch (error) {
    console.error('Create milestone error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
