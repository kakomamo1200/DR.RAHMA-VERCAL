import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import JSZip from 'jszip';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

type ParsedQuestion = {
  text: string;
  passage: string | null;
  type: 'mcq' | 'true_false';
  imageUrl: string | null;
  choices: { text: string; isCorrect: boolean }[];
};

async function saveImageToDisk(data: Buffer, ext: string): Promise<string> {
  let compressed: Buffer;
  let finalExt = 'webp';

  try {
    compressed = await sharp(data)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    compressed = data;
    finalExt = ext || 'jpg';
  }

  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${finalExt}`;

  try {
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), compressed);
    return `/uploads/${filename}`;
  } catch {
    // EROFS Read-only filesystem fallback (e.g. Vercel Serverless)
    const mime = finalExt === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${compressed.toString('base64')}`;
  }
}

// Generate example Excel file buffer
async function generateExampleBuffer(): Promise<Buffer> {
  const wsData = [
    ['passage', 'type', 'question', 'choice1', 'choice2', 'choice3', 'choice4', 'correct', 'image'],
    ['', 'mcq', 'What is the largest organ in the human body?', 'Liver', 'Skin', 'Brain', 'Heart', 'B', ''],
    ['Read the case: A 45-year-old male presents with acute chest pain.', 'mcq', 'Which initial diagnostic test is most indicated?', 'Chest X-Ray', 'ECG', 'CT Scan', 'Blood Culture', 'B', ''],
    ['Read the case: A 45-year-old male presents with acute chest pain.', 'true_false', 'Is Troponin I elevated in myocardial infarction?', 'True', 'False', '', '', 'A', ''],
    ['', 'true_false', 'The human heart has 4 chambers.', 'صح', 'خطأ', '', '', 'A', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 45 }, { wch: 12 }, { wch: 50 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 25 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function parseSingleQuestionBuffer(
  rawBuffer: string,
  passage: string | null,
  image: string | null,
  questionsList: ParsedQuestion[]
) {
  const lines = rawBuffer.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return;

  const isTF = /\b(T\/F|True\/False|صح\/خطأ|صح_خطأ|TRUE_FALSE)\b/i.test(rawBuffer) || /\[(?:TRUE_FALSE|صح_خطأ)\]/i.test(rawBuffer);

  const choices: { text: string; isCorrect: boolean }[] = [];
  const questionTextLines: string[] = [];

  for (const line of lines) {
    if (/\[(?:TRUE_FALSE|صح_خطأ)\]/i.test(line)) continue;

    const choiceMatch = line.match(/^(?:\*|\[CORRECT\])?\s*(?:\(?([A-Da-d1-6])\)?[\.\-:\s]+|\*|\[CHOICE\]\s*)(.+)/i);
    const hasAsterisk = line.startsWith('*') || line.includes('[CORRECT]');

    if (choiceMatch && choiceMatch[2]) {
      const choiceContent = choiceMatch[2].replace(/\[\/?CORRECT\]/gi, '').replace(/\[\/?CHOICE\]/gi, '').trim();
      if (choiceContent) {
        choices.push({
          text: choiceContent,
          isCorrect: hasAsterisk || choices.length === 0
        });
      }
    } else {
      questionTextLines.push(line);
    }
  }

  const hasExplicitAsterisk = lines.some(l => l.startsWith('*') || l.includes('[CORRECT]'));
  let finalQText = questionTextLines.join(' ').replace(/\[\/?(?:QUESTION|سؤال|Q|TRUE_FALSE|صح_خطأ)\]/gi, '').trim();
  if (!finalQText && lines[0]) finalQText = lines[0];

  if (!finalQText) return;

  if (isTF || choices.length < 2) {
    questionsList.push({
      text: finalQText.replace(/\b(T\/F|True\/False|صح\/خطأ|صح_خطأ)\b/gi, '').trim(),
      passage,
      type: 'true_false',
      imageUrl: image,
      choices: [
        { text: 'صح', isCorrect: !hasExplicitAsterisk || choices.find(c => c.text.includes('صح'))?.isCorrect || true },
        { text: 'خطأ', isCorrect: hasExplicitAsterisk && choices.find(c => c.text.includes('خطأ'))?.isCorrect || false }
      ]
    });
  } else {
    questionsList.push({
      text: finalQText,
      passage,
      type: 'mcq',
      imageUrl: image,
      choices: choices.slice(0, 6)
    });
  }
}

async function parseWordFile(buffer: Buffer): Promise<{ questions: ParsedQuestion[] }> {
  const result = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const imgBuffer = await image.read();
      const ext = image.contentType?.split('/')[1] || 'png';
      return { src: await saveImageToDisk(Buffer.from(imgBuffer), ext) };
    }),
  });
  const html = result.value;
  const questions: ParsedQuestion[] = [];

  const blocks = html.split(/(?=<(?:p|div|tr|h\d|img)[^>]*>)/i).filter(b => b.trim());

  let pendingImage: string | null = null;
  let currentPassage: string | null = null;
  let inPassageBlock = false;
  let passageBuffer = '';

  let inQuestionBlock = false;
  let questionBuffer = '';

  for (const block of blocks) {
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (imgMatch) {
      pendingImage = imgMatch[1];
    }

    const textContent = block.replace(/<[^>]+>/g, '').trim();
    if (!textContent) continue;

    // Check for Passage Tags: [PASSAGE] or [قطعة]
    if (/\[(?:PASSAGE|قطعة|النص)\]/i.test(textContent)) {
      inPassageBlock = true;
      const contentAfterTag = textContent.replace(/\[(?:PASSAGE|قطعة|النص)\]/i, '').replace(/\[\/(?:PASSAGE|قطعة|النص)\]/i, '').trim();
      if (contentAfterTag) passageBuffer += (passageBuffer ? '\n' : '') + contentAfterTag;
      if (/\[\/(?:PASSAGE|قطعة|النص)\]/i.test(textContent)) {
        currentPassage = passageBuffer.trim();
        inPassageBlock = false;
        passageBuffer = '';
      }
      continue;
    }

    if (inPassageBlock) {
      if (/\[\/(?:PASSAGE|قطعة|النص)\]/i.test(textContent)) {
        passageBuffer += (passageBuffer ? '\n' : '') + textContent.replace(/\[\/(?:PASSAGE|قطعة|النص)\]/i, '').trim();
        currentPassage = passageBuffer.trim();
        inPassageBlock = false;
        passageBuffer = '';
      } else {
        passageBuffer += (passageBuffer ? '\n' : '') + textContent;
      }
      continue;
    }

    // Check for Passage Clear: [/PASSAGE] or [/قطعة]
    if (/\[\/(?:PASSAGE|قطعة|النص)\]/i.test(textContent)) {
      currentPassage = passageBuffer.trim() || currentPassage;
      inPassageBlock = false;
      passageBuffer = '';
      continue;
    }

    // Check for Question Block Tags: [QUESTION] or [سؤال] or [Q]
    if (/\[(?:QUESTION|سؤال|Q)\]/i.test(textContent) || inQuestionBlock) {
      if (/\[(?:QUESTION|سؤال|Q)\]/i.test(textContent)) {
        inQuestionBlock = true;
        questionBuffer = textContent.replace(/\[(?:QUESTION|سؤال|Q)\]/i, '');
      } else {
        questionBuffer += '\n' + textContent;
      }

      if (/\[\/(?:QUESTION|سؤال|Q)\]/i.test(textContent)) {
        questionBuffer = questionBuffer.replace(/\[\/(?:QUESTION|سؤال|Q)\]/i, '').trim();
        if (questionBuffer) {
          parseSingleQuestionBuffer(questionBuffer, currentPassage, pendingImage, questions);
          pendingImage = null;
        }
        inQuestionBlock = false;
        questionBuffer = '';
      }
      continue;
    }

    // Fallback: Natural Paragraph Parsing (if teacher didn't use tags)
    const passageMatch = textContent.match(/^(?:\[(?:Passage|قطعة|النص)\]|\b(?:Passage|قطعة|النص)\s*[:：])\s*(.+)/i);
    if (passageMatch) {
      currentPassage = passageMatch[1].trim();
      continue;
    }

    if (textContent.includes('?') || /^\d+[.\-):]/.test(textContent) || textContent.length > 5) {
      parseSingleQuestionBuffer(textContent, currentPassage, pendingImage, questions);
      pendingImage = null;
    }
  }

  if (questionBuffer.trim()) {
    parseSingleQuestionBuffer(questionBuffer.trim(), currentPassage, pendingImage, questions);
  }

  return { questions };
}

async function extractExcelDrawingRowMap(zip: JSZip): Promise<Record<number, string>> {
  const rowToImageMap: Record<number, string> = {};

  try {
    const drawingFiles = Object.keys(zip.files).filter(f => /drawings\/drawing.*\.xml$/i.test(f));

    for (const drawingPath of drawingFiles) {
      const filename = drawingPath.split('/').pop();
      const relsFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith(`${filename}.rels`.toLowerCase()));
      const drawingFile = zip.files[drawingPath];

      if (!drawingFile) continue;

      const rIdToMediaPath: Record<string, string> = {};
      if (relsFile && zip.files[relsFile]) {
        const relsXml = await zip.files[relsFile].async('string');
        const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/gi;
        let relMatch;
        while ((relMatch = relRegex.exec(relsXml)) !== null) {
          const id = relMatch[1];
          const target = relMatch[2];
          const mediaName = target.split('/').pop();
          const actualMediaPath = Object.keys(zip.files).find(f => f.toLowerCase().endsWith(mediaName?.toLowerCase() || ''));
          if (actualMediaPath) {
            rIdToMediaPath[id] = actualMediaPath;
          }
        }
      }

      const drawingXml = await drawingFile.async('string');
      const anchors = drawingXml.split(/<xdr:(?:twoCellAnchor|oneCellAnchor)/i);

      for (const anchor of anchors) {
        const rowMatch = anchor.match(/<xdr:from>[^]*?<xdr:row>(\d+)<\/xdr:row>/i) || anchor.match(/<xdr:row>(\d+)<\/xdr:row>/i);
        const embedMatch = anchor.match(/r:embed="([^"]+)"/i);

        if (rowMatch && embedMatch) {
          const excelRowIndex = parseInt(rowMatch[1], 10);
          const rId = embedMatch[1];
          const mediaPath = rIdToMediaPath[rId];

          if (mediaPath && zip.files[mediaPath]) {
            const mediaBuffer = await zip.files[mediaPath].async('nodebuffer');
            const ext = mediaPath.split('.').pop() || 'png';
            const savedUrl = await saveImageToDisk(mediaBuffer, ext);
            rowToImageMap[excelRowIndex] = savedUrl;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Drawing row map extraction warning:', err);
  }

  return rowToImageMap;
}

async function parseExcelFile(buffer: Buffer): Promise<{ questions: ParsedQuestion[] }> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const questions: ParsedQuestion[] = [];

  let rowToImageMap: Record<number, string> = {};
  const fallbackImages: string[] = [];

  try {
    const zip = await JSZip.loadAsync(buffer);
    rowToImageMap = await extractExcelDrawingRowMap(zip);

    // Extract all media files in order
    const mediaFiles = Object.keys(zip.files).filter(filename => /xl\/media\//i.test(filename) || /media\/image/i.test(filename));
    mediaFiles.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return numA - numB;
    });

    for (const mediaPath of mediaFiles) {
      const zipFile = zip.files[mediaPath];
      if (zipFile && !zipFile.dir) {
        const fileData = await zipFile.async('nodebuffer');
        const ext = mediaPath.split('.').pop() || 'png';
        const savedUrl = await saveImageToDisk(fileData, ext);
        fallbackImages.push(savedUrl);
      }
    }
  } catch (zipError) {
    console.warn('Excel zip media extraction notice:', zipError);
  }

  // Count valid questions with text
  const validRows = rows.filter(r => String(r['question'] || r['text'] || '').trim().length > 0);
  const totalQuestions = validRows.length;
  const totalImages = fallbackImages.length;
  // If questions > images (e.g. 50 questions, 20 images starting at Q31), offset = 50 - 20 = 30
  const imageOffset = (totalQuestions > totalImages && totalImages > 0) ? (totalQuestions - totalImages) : 0;

  let validQuestionIndex = 0;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const text = String(row['question'] || row['text'] || '').trim();
    if (!text) continue;

    const currentQIdx = validQuestionIndex++;
    const passage = String(row['passage'] || row['Passage'] || row['قطعة'] || '').trim() || null;
    const typeStr = String(row['type'] || row['Type'] || row['نوع'] || '').trim().toLowerCase();
    const type: 'mcq' | 'true_false' = (typeStr.includes('true') || typeStr.includes('tf') || typeStr.includes('صح')) ? 'true_false' : 'mcq';

    let imageUrl: string | null = null;
    const rawImg = String(
      row['image'] || row['imageUrl'] || row['imageEmbedded'] || row['صورة'] || row['الصورة'] || ''
    ).trim();

    // 1. Explicit text column image (URL, Data URI, Base64)
    if (rawImg) {
      if (rawImg.startsWith('http://') || rawImg.startsWith('https://') || rawImg.startsWith('/uploads/') || rawImg.startsWith('data:image')) {
        if (rawImg.startsWith('data:image')) {
          const base64Data = rawImg.split(',')[1];
          if (base64Data) {
            const ext = rawImg.includes('png') ? 'png' : 'jpg';
            imageUrl = await saveImageToDisk(Buffer.from(base64Data, 'base64'), ext);
          } else {
            imageUrl = rawImg;
          }
        } else {
          imageUrl = rawImg;
        }
      } else if (rawImg.length > 50) {
        try {
          imageUrl = await saveImageToDisk(Buffer.from(rawImg, 'base64'), 'jpg');
        } catch { /* silent */ }
      }
    }

    // 2. Drawing XML precise row anchor mapping (Excel 0-indexed row vs 1-indexed data row)
    if (!imageUrl) {
      const targetImage = rowToImageMap[rIdx + 1] || rowToImageMap[rIdx + 2] || rowToImageMap[rIdx];
      if (targetImage) {
        imageUrl = targetImage;
      }
    }

    // 3. Fallback to image list ONLY if the image column has an indicator (non-empty rawImg, e.g. 'yes', '1', 'img1', etc.)
    if (!imageUrl && rawImg && fallbackImages.length > 0) {
      // Pick matching image index if rawImg contains a number, else pick corresponding image
      const numMatch = rawImg.match(/\d+/);
      const imgIdx = numMatch ? Math.max(0, parseInt(numMatch[0], 10) - 1) : currentQIdx;
      if (imgIdx < fallbackImages.length) {
        imageUrl = fallbackImages[imgIdx];
      }
    }

    const choices: { text: string; isCorrect: boolean }[] = [];
    if (type === 'true_false') {
      const c1 = String(row['choice1'] || row['A'] || 'صح').trim();
      const c2 = String(row['choice2'] || row['B'] || 'خطأ').trim();
      const correctCol = String(row['correct'] || row['answer'] || 'A').toUpperCase();
      const isFirstCorrect = correctCol === 'A' || correctCol === '1' || correctCol.includes('TRUE') || correctCol.includes('صح');
      choices.push({ text: c1 || 'صح', isCorrect: isFirstCorrect });
      choices.push({ text: c2 || 'خطأ', isCorrect: !isFirstCorrect });
    } else {
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
    }

    if (choices.length >= 2) questions.push({ text, passage, type, imageUrl, choices });
  }
  return { questions };
}

// GET: Stream example file directly as attachment
export async function GET() {
  try {
    const buf = await generateExampleBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="import-example.xlsx"',
      },
    });
  } catch (error) {
    console.error('Example generation error:', error);
    return NextResponse.json({ error: 'Failed to generate example' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const quizId = formData.get('quizId') as string | null;
    const action = formData.get('action') as string || 'preview';
    if (!file || !quizId) return NextResponse.json({ error: 'File and quiz ID are required' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop()?.toLowerCase();
    let parsed: { questions: ParsedQuestion[] };

    if (ext === 'docx' || ext === 'doc') parsed = await parseWordFile(buffer);
    else if (ext === 'xlsx' || ext === 'xls') parsed = await parseExcelFile(buffer);
    else return NextResponse.json({ error: 'Unsupported file type — use .docx or .xlsx' }, { status: 400 });

    if (action === 'preview') return NextResponse.json({ status: 'preview', questions: parsed.questions, count: parsed.questions.length });

    const questionsData = formData.get('questions') as string | null;
    if (!questionsData) return NextResponse.json({ error: 'Question data is required' }, { status: 400 });

    const questions: ParsedQuestion[] = JSON.parse(questionsData);
    let order = await db.question.count({ where: { quizId } });
    for (const q of questions) {
      await db.question.create({
        data: {
          quizId,
          text: q.text,
          passage: q.passage || null,
          type: q.type || 'mcq',
          imageUrl: q.imageUrl || null,
          order: order++,
          points: 1,
          choices: {
            create: q.choices.map((c: { text: string; isCorrect: boolean }, i: number) => ({
              text: c.text,
              isCorrect: c.isCorrect,
              order: i
            }))
          }
        }
      });
    }
    return NextResponse.json({ status: 'imported', count: questions.length });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}