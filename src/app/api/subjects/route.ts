import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';

// GET /api/subjects
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    const subjects = await db.subject.findMany({
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { quizzes: true } },
        quizzes: { include: { _count: { select: { questions: true } } } },
      },
    });
    let pendingCounts: Record<string, number> = {};
    if (user) {
      const attempts = await db.attempt.findMany({ where: { userId: user.id, submittedAt: { not: null } }, select: { quizId: true } });
      const completedQuizIds = new Set(attempts.map(a => a.quizId));
      subjects.forEach(s => { const total = s.quizzes.length; const completed = s.quizzes.filter(q => completedQuizIds.has(q.id)).length; pendingCounts[s.id] = total - completed; });
    }
    return NextResponse.json({ subjects: subjects.map(s => ({ id: s.id, name: s.name, description: s.description, order: s.order, quizCount: s._count.quizzes, quizzes: s.quizzes.map(q => ({ id: q.id, title: q.title, description: q.description, durationMinutes: q.durationMinutes, questionCount: q._count.questions, order: q.order })), pendingQuizzes: pendingCounts[s.id] || 0 })) });
  } catch (error) {
    console.error('Subjects GET error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { name, description, order } = await request.json();
    if (!name) return NextResponse.json({ error: 'Subject name is required' }, { status: 400 });
    const subject = await db.subject.create({ data: { name, description: description || null, order: order ?? 0, userId: user.id } });
    return NextResponse.json({ subject });
  } catch (error) { console.error('Subjects POST error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { id, name, description, order } = await request.json(); if (!id) return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    const subject = await db.subject.update({ where: { id }, data: { name, description, order } });
    return NextResponse.json({ subject });
  } catch (error) { console.error('Subjects PUT error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { searchParams } = new URL(request.url); const id = searchParams.get('id'); if (!id) return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    await db.subject.delete({ where: { id } }); return NextResponse.json({ success: true });
  } catch (error) { console.error('Subjects DELETE error:', error); return NextResponse.json({ error: 'Failed to delete — make sure it has no linked quizzes' }, { status: 500 }); }
}
