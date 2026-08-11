import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

async function saveImageToDisk(data: Buffer, ext: string): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), data);
  return `/uploads/${filename}`;
}

async function parseWordFile(buffer: Buffer): Promise<{ questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] }> {
  const result = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const imgBuffer = await image.read();
      const ext = image.contentType?.split('/')[1] || 'png';
      return { src: await saveImageToDisk(Buffer.from(imgBuffer), ext) };
    }),
  });
  const html = result.value;
  const questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] = [];
  const blocks = html.split(/<\/p>/i).filter(b => b.trim());
  let pendingImage: string | null = null;
  for (const block of blocks) {
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const textContent = block.replace(/<[^>]+>/g, '').trim();
    if (imgMatch && !textContent) { pendingImage = imgMatch[1]; continue; }
    if (textContent && (textContent.includes('?') || /^\d+[.\-)\:]/.test(textContent) || textContent.length > 10)) {
      const choiceMatches: { letter: string; text: string }[] = [];
      const engRegex = /\(?([A-Da-d])\)?\s*([^\n(]{2,})/g;
      let match; while ((match = engRegex.exec(textContent)) !== null) choiceMatches.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
      if (choiceMatches.length < 2) {
        const numRegex = /(?:^|\n)\s*\d+[.\-)\s]+([^\n]{2,})/g;
        while ((match = numRegex.exec(textContent)) !== null) choiceMatches.push({ letter: String.fromCharCode(65 + choiceMatches.length), text: match[1].trim() });
      }
      if (choiceMatches.length >= 2) {
        let questionText = textContent.split(/\(?[A-Da-d]\)?\s*[^\n]{2,}/).join('').trim();
        questionText = questionText.replace(/^\s*[\n\r]+/, '').trim();
        if (questionText) {
          questions.push({ text: questionText, imageUrl: pendingImage, choices: choiceMatches.map((c) => ({ text: c.text, isCorrect: c.letter === 'A' })) });
          pendingImage = null;
        }
      }
    }
  }
  return { questions };
}

async function parseExcelFile(buffer: Buffer): Promise<{ questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] }> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] = [];
  for (const row of rows) {
    const text = String(row['question'] || row['text'] || '').trim();
    if (!text) continue;
    let imageUrl: string | null = null;
    const urlCol = row['image'] || row['imageUrl'] || '';
    if (typeof urlCol === 'string' && urlCol.startsWith('http')) imageUrl = urlCol;
    const imgCol = row['imageEmbedded'] || '';
    if (typeof imgCol === 'string' && imgCol.startsWith('data:image')) {
      const base64Data = imgCol.split(',')[1];
      if (base64Data) { const ext = imgCol.includes('png') ? 'png' : 'jpg'; imageUrl = await saveImageToDisk(Buffer.from(base64Data, 'base64'), ext); }
    }
    const choices: { text: string; isCorrect: boolean }[] = [];
    for (let i = 1; i <= 6; i++) {
      let choiceText = String(row[`choice${i}`] || row[String.fromCharCode(64 + i)] || row[`choice_${i}`] || '');
      if (!choiceText && i <= 4) choiceText = String(row[`${i}`] || '');
      if (choiceText.trim()) choices.push({ text: choiceText.trim(), isCorrect: i === 1 });
    }
    const correctCol = row['correct'] || row['answer'] || '';
    if (typeof correctCol === 'string') {
      const correctIdx = correctCol.toUpperCase().charCodeAt(0) - 65;
      if (correctIdx >= 0 && correctIdx < choices.length) choices.forEach((c, idx) => { c.isCorrect = idx === correctIdx; });
      else if (!isNaN(Number(correctCol)) && Number(correctCol) >= 1 && Number(correctCol) <= choices.length) choices.forEach((c, idx) => { c.isCorrect = idx === Number(correctCol) - 1; });
    }
    if (choices.length >= 2) questions.push({ text, imageUrl, choices });
  }
  return { questions };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const quizId = formData.get('quizId') as string | null;
    const action = formData.get('action') as string || 'preview';
    if (!file || !quizId) return NextResponse.json({ error: 'File and quiz ID are required' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop()?.toLowerCase();
    let parsed: { questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] };
    if (ext === 'docx' || ext === 'doc') parsed = await parseWordFile(buffer);
    else if (ext === 'xlsx' || ext === 'xls') parsed = await parseExcelFile(buffer);
    else return NextResponse.json({ error: 'Unsupported file type — use .docx or .xlsx' }, { status: 400 });
    if (action === 'preview') return NextResponse.json({ status: 'preview', questions: parsed.questions, count: parsed.questions.length });
    const questionsData = formData.get('questions') as string | null;
    if (!questionsData) return NextResponse.json({ error: 'Question data is required' }, { status: 400 });
    const questions = JSON.parse(questionsData);
    let order = await db.question.count({ where: { quizId } });
    for (const q of questions) {
      await db.question.create({ data: { quizId, text: q.text, imageUrl: q.imageUrl || null, order: order++, points: q.points || 1, choices: { create: q.choices.map((c: { text: string; isCorrect: boolean }, i: number) => ({ text: c.text, isCorrect: c.isCorrect, order: i })) } } });
    }
    return NextResponse.json({ status: 'imported', count: questions.length });
  } catch (error) { console.error('Import error:', error); return NextResponse.json({ error: 'Import failed' }, { status: 500 }); }
}
