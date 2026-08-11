import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url); const subjectId = searchParams.get('subjectId');
    const user = await getUserFromRequest(request);
    const where = subjectId ? { subjectId } : {};
    const quizzes = await db.quiz.findMany({ where, orderBy: { order: 'asc' }, include: { subject: { select: { name: true } }, _count: { select: { questions: true, attempts: true } } } });
    let attemptStatuses: Record<string, string> = {};
    if (user) {
      const attempts = await db.attempt.findMany({ where: { userId: user.id }, select: { quizId: true, submittedAt: true } });
      attempts.forEach(a => {
        if (a.submittedAt) {
          attemptStatuses[a.quizId] = 'submitted';
        } else if (attemptStatuses[a.quizId] !== 'submitted') {
          attemptStatuses[a.quizId] = 'in_progress';
        }
      });
    }
    return NextResponse.json({ quizzes: quizzes.map(q => ({ id: q.id, title: q.title, description: q.description, durationMinutes: q.durationMinutes, questionCount: q._count.questions, attemptCount: q._count.attempts, subjectName: q.subject.name, order: q.order, status: attemptStatuses[q.id] || null })) });
  } catch (error) { console.error('Quizzes GET error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { title, description, durationMinutes, subjectId, order } = await request.json();
    if (!title || !subjectId) return NextResponse.json({ error: 'Title and subject are required' }, { status: 400 });
    const quiz = await db.quiz.create({ data: { title, description: description || null, durationMinutes: durationMinutes || 40, subjectId, order: order ?? 0 } });
    return NextResponse.json({ quiz });
  } catch (error) { console.error('Quizzes POST error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { id, title, description, durationMinutes, order } = await request.json(); if (!id) return NextResponse.json({ error: 'Quiz ID is required' }, { status: 400 });
    const quiz = await db.quiz.update({ where: { id }, data: { title, description, durationMinutes, order } });
    return NextResponse.json({ quiz });
  } catch (error) { console.error('Quizzes PUT error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const { searchParams } = new URL(request.url); const id = searchParams.get('id'); if (!id) return NextResponse.json({ error: 'Quiz ID is required' }, { status: 400 });
    await db.quiz.delete({ where: { id } }); return NextResponse.json({ success: true });
  } catch (error) { console.error('Quizzes DELETE error:', error); return NextResponse.json({ error: 'Failed to delete' }, { status: 500 }); }
}
