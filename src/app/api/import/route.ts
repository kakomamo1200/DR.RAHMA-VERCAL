import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

function extractImagesFromBuffer(buffer: Buffer): { name: string; data: Buffer }[] {
  const images: { name: string; data: Buffer }[] = [];
  const str = buffer.toString('binary');
  let pos = 0;
  while ((pos = str.indexOf('PK\x03\x04', pos)) !== -1) {
    const end = str.indexOf('PK\x05\x06', pos);
    if (end === -1) break;
    const zipData = Buffer.from(str.slice(pos, end + 22), 'binary');
    // Try to find images within the zip (simplified - mammoth handles this better)
    pos++;
  }
  return images;
}

async function saveImageToDisk(data: Buffer, ext: string): Promise<string> {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const filepath = path.join(uploadDir, filename);
  await writeFile(filepath, data);
  return `/uploads/${filename}`;
}

async function parseWordFile(buffer: Buffer): Promise<{ questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] }> {
  const images: { name: string; data: Buffer }[] = [];
  let imageCounter = 0;

  const result = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async(image) => {
      const imgBuffer = await image.read();
      const ext = image.contentType?.split('/')[1] || 'png';
      const url = await saveImageToDisk(Buffer.from(imgBuffer), ext);
      images.push({ name: `img-${imageCounter}`, data: Buffer.from(imgBuffer) });
      imageCounter++;
      return { src: url };
    }),
  });

  const html = result.value;
  const questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] = [];

  // Split by <img> tags and paragraphs
  const blocks = html.split(/<\/?p[^>]*>/i).filter(b => b.trim());
  let pendingImage: string | null = null;

  for (const block of blocks) {
    // Check for image
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const textContent = block.replace(/<[^>]+>/g, '').trim();

    if (imgMatch && !textContent) {
      // Image block with no text - this is a case/image for the next question
      pendingImage = imgMatch[1];
      continue;
    }

    if (textContent && (textContent.includes('?') || textContent.includes('؟') || /^\d+([\.\-)\:])/.test(textContent) || textContent.length > 10)) {
      // Looks like a question
      // Extract choices from the text (A) B) C) D) patterns or numbered 1) 2) 3) 4)
      const choicePattern = /[\(\[（]?([A-Da-dأبج د])[\)\]）]\s*([^\n(]+)/g;
      const choices: { text: string; isCorrect: boolean }[] = [];
      let questionText = textContent;
      let match;

      // Also try Arabic choice patterns
      const arabicChoicePattern = /[أابج]\)\s*([^\n(]+)/g;
      const numberedChoicePattern = /\d+\)\s*([^\n(]+)/g;

      let choiceMatches: { letter: string; text: string }[] = [];

      // Try English A-D pattern
      const engRegex = /\(?([A-Da-d])\)?\s*([^\n(]{2,})/g;
      while ((match = engRegex.exec(textContent)) !== null) {
        choiceMatches.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
      }

      if (choiceMatches.length < 2) {
        // Try Arabic
        const arRegex = /([أابج])\)\s*([^\n(]{2,})/g;
        while ((match = arRegex.exec(textContent)) !== null) {
          const letterMap: Record<string, string> = { 'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D' };
          choiceMatches.push({ letter: letterMap[match[1]] || 'A', text: match[2].trim() });
        }
      }

      if (choiceMatches.length < 2) {
        // Try numbered
        const numRegex = /(?:^|\n)\s*\d+[.\-)\s]+([^\n]{2,})/g;
        while ((match = numRegex.exec(textContent)) !== null) {
          choiceMatches.push({ letter: String.fromCharCode(65 + choiceMatches.length), text: match[1].trim() });
        }
      }

      if (choiceMatches.length >= 2) {
        // Remove choices from question text
        questionText = textContent
          .split(/\(?[A-Da-d]\)?\s*[^\n]{2,}/)
          .join('')
          .trim();
        // Also clean Arabic
        questionText = questionText
          .split(/[أابج]\)\s*[^\n]{2,}/)
          .join('')
          .trim();
        questionText = questionText.replace(/\d+[.\-)\s]+[^\n]{2,}/g, '').trim();
        // Clean up
        questionText = questionText.replace(/^\s*[\n\r]+/, '').trim();
      }

      if (questionText) {
        questions.push({
          text: questionText,
          imageUrl: pendingImage,
          choices: choiceMatches.map((c, i) => ({
            text: c.text,
            isCorrect: c.letter === 'A', // Default: first choice is correct
          })),
        });
        pendingImage = null;
      }
    }
  }

  return { questions };
}

async function parseExcelFile(buffer: Buffer): Promise<{ questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] }> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] = [];

  for (const row of rows) {
    const text = String(row['question'] || row['السؤال'] || row['text'] || '').trim();
    if (!text) continue;

    let imageUrl: string | null = null;
    const urlCol = row['image'] || row['صورة'] || row['imageUrl'] || row['رابط الصورة'] || '';
    if (typeof urlCol === 'string' && urlCol.startsWith('http')) {
      imageUrl = urlCol;
    }

    // Check for embedded image (xlsx stores as base64 or reference)
    const imgCol = row['imageEmbedded'] || row['صورة_مضمنة'] || '';
    if (typeof imgCol === 'string' && imgCol.startsWith('data:image')) {
      const base64Data = imgCol.split(',')[1];
      if (base64Data) {
        const ext = imgCol.includes('png') ? 'png' : 'jpg';
        const imgBuffer = Buffer.from(base64Data, 'base64');
        imageUrl = await saveImageToDisk(imgBuffer, ext);
      }
    }

    const choices: { text: string; isCorrect: boolean }[] = [];
    for (let i = 1; i <= 6; i++) {
      const key = `choice${i}` || `اختيار${i}` || `A`;
      let choiceText = '';
      // Try various column naming conventions
      choiceText = String(row[`choice${i}`] || row[`الاختيار${i}`] || row[String.fromCharCode(64 + i)] || row[`choice_${i}`] || '');
      if (!choiceText && i <= 4) {
        choiceText = String(row[`${i}`] || row[`إجابة${i}`] || '');
      }
      if (choiceText.trim()) {
        choices.push({ text: choiceText.trim(), isCorrect: i === 1 });
      }
    }

    // Check for correct answer indicator
    const correctCol = row['correct'] || row['الإجابة_الصحيحة'] || row['answer'] || '';
    if (typeof correctCol === 'string') {
      const correctIdx = correctCol.toUpperCase().charCodeAt(0) - 65;
      if (correctIdx >= 0 && correctIdx < choices.length) {
        choices.forEach((c, idx) => { c.isCorrect = idx === correctIdx; });
      } else if (!isNaN(Number(correctCol)) && Number(correctCol) >= 1 && Number(correctCol) <= choices.length) {
        choices.forEach((c, idx) => { c.isCorrect = idx === Number(correctCol) - 1; });
      }
    }

    if (choices.length >= 2) {
      questions.push({ text, imageUrl, choices });
    }
  }

  return { questions };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || !requireAdmin(user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const quizId = formData.get('quizId') as string | null;
    const action = formData.get('action') as string || 'preview'; // 'preview' or 'confirm'

    if (!file || !quizId) {
      return NextResponse.json({ error: 'الملف ومعرف الاختبار مطلوبان' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop()?.toLowerCase();
    let parsed: { questions: { text: string; imageUrl: string | null; choices: { text: string; isCorrect: boolean }[] }[] };

    if (ext === 'docx' || ext === 'doc') {
      parsed = await parseWordFile(buffer);
    } else if (ext === 'xlsx' || ext === 'xls') {
      parsed = await parseExcelFile(buffer);
    } else {
      return NextResponse.json({ error: 'نوع الملف غير مدعوم - استخدم docx أو xlsx' }, { status: 400 });
    }

    if (action === 'preview') {
      return NextResponse.json({ status: 'preview', questions: parsed.questions, count: parsed.questions.length });
    }

    // Confirm import
    const questionsData = formData.get('questions') as string | null;
    if (!questionsData) {
      return NextResponse.json({ error: 'بيانات الأسئلة مطلوبة' }, { status: 400 });
    }

    const questions = JSON.parse(questionsData);
    let order = await db.question.count({ where: { quizId } });

    for (const q of questions) {
      await db.question.create({
        data: {
          quizId,
          text: q.text,
          imageUrl: q.imageUrl || null,
          order: order++,
          points: q.points || 1,
          choices: {
            create: q.choices.map((c: { text: string; isCorrect: boolean }, i: number) => ({
              text: c.text,
              isCorrect: c.isCorrect,
              order: i,
            })),
          },
        },
      });
    }

    return NextResponse.json({ status: 'imported', count: questions.length });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء الاستيراد' }, { status: 500 });
  }
}
