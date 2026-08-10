import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';

// GET /api/questions?quizId=xxx - Get questions for a quiz (for quiz running)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const quizId = searchParams.get('quizId');
    if (!quizId) {
      return NextResponse.json({ error: 'معرف الاختبار مطلوب' }, { status: 400 });
    }
    const quiz = await db.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) {
      return NextResponse.json({ error: 'الاختبار غير موجود' }, { status: 404 });
    }
    const questions = await db.question.findMany({
      where: { quizId },
      orderBy: { order: 'asc' },
      include: {
        choices: { orderBy: { order: 'asc' } },
      },
    });
    return NextResponse.json({
      quiz: { id: quiz.id, title: quiz.title, description: quiz.description, durationMinutes: quiz.durationMinutes },
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        imageUrl: q.imageUrl,
        order: q.order,
        points: q.points,
        choices: q.choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect, order: c.order })),
      })),
    });
  } catch (error) {
    console.error('Questions GET error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}

// POST /api/questions - Create question manually (admin)
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || !requireAdmin(user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }
    const { quizId, text, imageUrl, order, points, choices } = await request.json();
    if (!quizId || !text || !choices?.length) {
      return NextResponse.json({ error: 'بيانات السؤال غير مكتملة' }, { status: 400 });
    }
    const question = await db.question.create({
      data: {
        quizId,
        text,
        imageUrl: imageUrl || null,
        order: order ?? 0,
        points: points || 1,
        choices: { create: choices.map((c: { text: string; isCorrect: boolean; order?: number }, i: number) => ({ text: c.text, isCorrect: c.isCorrect || false, order: c.order ?? i })) },
      },
      include: { choices: true },
    });
    return NextResponse.json({ question });
  } catch (error) {
    console.error('Questions POST error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}

// DELETE /api/questions?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || !requireAdmin(user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'معرف السؤال مطلوب' }, { status: 400 });
    await db.question.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Questions DELETE error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}
