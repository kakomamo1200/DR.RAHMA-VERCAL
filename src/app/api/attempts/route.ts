import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const quizId = searchParams.get('quizId');
    const type = searchParams.get('type');

    if (type === 'dashboard') {
      const attempts = await db.attempt.findMany({ where: { userId: user.id, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, include: { quiz: { include: { subject: { select: { name: true } } } } } });
      return NextResponse.json({ attempts: attempts.map(a => ({ id: a.id, score: a.score, totalPoints: a.totalPoints, startedAt: a.startedAt, submittedAt: a.submittedAt, quiz: { id: a.quiz.id, title: a.quiz.title, subjectName: a.quiz.subject.name }, percent: a.totalPoints ? Math.round((a.score! / a.totalPoints) * 100) : 0 })) });
    }

    if (type === 'review') {
      const attemptId = searchParams.get('attemptId'); if (!attemptId) return NextResponse.json({ error: 'Attempt ID is required' }, { status: 400 });
      const attempt = await db.attempt.findUnique({ where: { id: attemptId }, include: { answers: { include: { question: { include: { choices: true } }, choice: true } }, quiz: true } });
      if (!attempt || attempt.userId !== user.id) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
      const questions = await db.question.findMany({ where: { quizId: attempt.quizId }, orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } });
      const answersMap: Record<string, string | null> = {}; attempt.answers.forEach(a => { answersMap[a.questionId] = a.choiceId; });
      let score = 0; let totalPoints = 0;
      const reviewQuestions = questions.map(q => { totalPoints += q.points; const pickedId = answersMap[q.id] || null; const correctChoice = q.choices.find(c => c.isCorrect); const isCorrect = pickedId === correctChoice?.id; if (isCorrect) score += q.points; return { id: q.id, text: q.text, imageUrl: q.imageUrl, points: q.points, choices: q.choices.map(c => ({ id: c.id, text: c.text, isCorrect: c.isCorrect })), correct: q.choices.findIndex(c => c.isCorrect), picked: pickedId ? q.choices.findIndex(c => c.id === pickedId) : null }; });
      return NextResponse.json({ score, totalPoints, percent: totalPoints ? Math.round((score / totalPoints) * 100) : 0, questions: reviewQuestions });
    }

    if (!quizId) return NextResponse.json({ error: 'Quiz ID is required' }, { status: 400 });
    const existing = await db.attempt.findFirst({ where: { quizId, userId: user.id }, orderBy: { createdAt: 'desc' } });
    if (!existing) return NextResponse.json({ status: 'not_started' });
    if (existing.submittedAt) return NextResponse.json({ status: 'submitted', attemptId: existing.id });
    return NextResponse.json({ status: 'in_progress', attemptId: existing.id });
  } catch (error) { console.error('Attempts GET error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Please log in first' }, { status: 401 });
    const { action, quizId, attemptId, answers } = await request.json();

    if (action === 'start') {
      const existing = await db.attempt.findFirst({ where: { quizId, userId: user.id, submittedAt: { not: null } } });
      if (existing) return NextResponse.json({ status: 'already_submitted', attemptId: existing.id });
      const inProgress = await db.attempt.findFirst({ where: { quizId, userId: user.id, submittedAt: null }, include: { quiz: { select: { durationMinutes: true } } } });
      if (inProgress) {
        const questions = await db.question.findMany({ where: { quizId }, orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } });
        const savedAnswers = await db.answer.findMany({ where: { attemptId: inProgress.id } });
        const answersArr = questions.map(q => { const a = savedAnswers.find(sa => sa.questionId === q.id); return a?.choiceId ? q.choices.findIndex(c => c.id === a.choiceId) : null; });
        return NextResponse.json({ status: 'resumed', attemptId: inProgress.id, startedAt: inProgress.startedAt.getTime(), serverNow: Date.now(), durationMin: inProgress.quiz.durationMinutes, questions: questions.map(q => ({ id: q.id, text: q.text, imageUrl: q.imageUrl, points: q.points, choices: q.choices.map(c => c.text) })), answers: answersArr });
      }
      const quiz = await db.quiz.findUnique({ where: { id: quizId } });
      if (!quiz) return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
      const attempt = await db.attempt.create({ data: { quizId, userId: user.id, startedAt: new Date() } });
      const questions = await db.question.findMany({ where: { quizId }, orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } });
      return NextResponse.json({ status: 'started', attemptId: attempt.id, startedAt: attempt.startedAt.getTime(), serverNow: Date.now(), durationMin: quiz.durationMinutes, questions: questions.map(q => ({ id: q.id, text: q.text, imageUrl: q.imageUrl, points: q.points, choices: q.choices.map(c => c.text) })), answers: questions.map(() => null) });
    }

    if (action === 'save') {
      if (!attemptId) return NextResponse.json({ error: 'Attempt ID is required' }, { status: 400 });
      const attempt = await db.attempt.findUnique({ where: { id: attemptId } });
      if (!attempt || attempt.userId !== user.id || attempt.submittedAt) return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 });
      const questions = await db.question.findMany({ where: { quizId: attempt.quizId }, orderBy: { order: 'asc' } });
      for (let i = 0; i < questions.length; i++) {
        const choiceIdx = answers?.[i]; const choiceId = choiceIdx !== null && choiceIdx !== undefined ? (await db.choice.findFirst({ where: { questionId: questions[i].id }, skip: choiceIdx, take: 1 }))?.id || null : null;
        await db.answer.upsert({ where: { id: `a-${attemptId}-${questions[i].id}`.slice(0, 25) }, create: { attemptId, questionId: questions[i].id, choiceId }, update: { choiceId } });
      }
      return NextResponse.json({ status: 'saved' });
    }

    if (action === 'submit') {
      if (!attemptId) return NextResponse.json({ error: 'Attempt ID is required' }, { status: 400 });
      const attempt = await db.attempt.findUnique({ where: { id: attemptId } });
      if (!attempt || attempt.userId !== user.id) return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 });
      if (attempt.submittedAt) return NextResponse.json({ status: 'already_submitted', attemptId: attempt.id });
      const questions = await db.question.findMany({ where: { quizId: attempt.quizId }, orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } });
      let score = 0; let totalPoints = 0;
      for (let i = 0; i < questions.length; i++) {
        totalPoints += questions[i].points; const choiceIdx = answers?.[i]; const choice = choiceIdx !== null && choiceIdx !== undefined ? questions[i].choices[choiceIdx] : null; if (choice?.isCorrect) score += questions[i].points;
        await db.answer.upsert({ where: { id: `a-${attemptId}-${questions[i].id}`.slice(0, 25) }, create: { attemptId, questionId: questions[i].id, choiceId: choice?.id || null }, update: { choiceId: choice?.id || null } });
      }
      await db.attempt.update({ where: { id: attemptId }, data: { submittedAt: new Date(), score, totalPoints } });
      return NextResponse.json({ status: 'submitted', attemptId, score, totalPoints });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) { console.error('Attempts POST error:', error); return NextResponse.json({ error: 'Something went wrong' }, { status: 500 }); }
}
