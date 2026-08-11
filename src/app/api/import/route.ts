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
  const blocks = html.split(/<\/p>/i).filter(b => b.trim());
  let pendingImage: string | null = null;
  let currentPassage: string | null = null;

  for (const block of blocks) {
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (imgMatch) {
      pendingImage = imgMatch[1];
    }

    const textContent = block.replace(/<[^>]+>/g, '').trim();
    if (!textContent) continue;

    // Detect Passage
    const passageMatch = textContent.match(/^(?:\[(?:Passage|قطعة|النص)\]|\b(?:Passage|قطعة|النص)\s*[:：])\s*(.+)/i);
    if (passageMatch) {
      currentPassage = passageMatch[1].trim();
      continue;
    }

    if (textContent.includes('?') || /^\d+[.\-):]/.test(textContent) || textContent.length > 10) {
      // Check for True/False question
      const isTF = /\b(T\/F|True\/False|صح\/خطأ|صح أم خطأ)\b/i.test(textContent);
      const choiceMatches: { letter: string; text: string }[] = [];
      const engRegex = /\(?([A-Da-d])\)?\s*([^\n(]{2,})/g;
      let match;
      while ((match = engRegex.exec(textContent)) !== null) {
        choiceMatches.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
      }
      if (choiceMatches.length < 2) {
        const numRegex = /(?:^|\n)\s*\d+[.\-)\s]+([^\n]{2,})/g;
        while ((match = numRegex.exec(textContent)) !== null) {
          choiceMatches.push({ letter: String.fromCharCode(65 + choiceMatches.length), text: match[1].trim() });
        }
      }

      if (isTF || choiceMatches.length < 2) {
        // True/False default choices if missing
        let qText = textContent.replace(/\b(T\/F|True\/False|صح\/خطأ|صح أم خطأ)\b/gi, '').trim();
        questions.push({
          text: qText,
          passage: currentPassage,
          type: 'true_false',
          imageUrl: pendingImage,
          choices: [
            { text: 'صح', isCorrect: true },
            { text: 'خطأ', isCorrect: false }
          ]
        });
        pendingImage = null;
      } else {
        let questionText = textContent.split(/\(?[A-Da-d]\)?\s*[^\n]{2,}/).join('').trim();
        questionText = questionText.replace(/^\s*[\n\r]+/, '').trim();
        if (questionText) {
          questions.push({
            text: questionText,
            passage: currentPassage,
            type: 'mcq',
            imageUrl: pendingImage,
            choices: choiceMatches.map((c) => ({ text: c.text, isCorrect: c.letter === 'A' }))
          });
          pendingImage = null;
        }
      }
    }
  }
  return { questions };
}

async function extractExcelDrawingRowMap(zip: JSZip): Promise<Record<number, string>> {
  const rowToImageMap: Record<number, string> = {};

  try {
    const drawingFiles = Object.keys(zip.files).filter(f => /^xl\/drawings\/drawing\d+\.xml$/i.test(f));

    for (const drawingPath of drawingFiles) {
      const relsPath = drawingPath.replace(/xl\/drawings\/(drawing\d+\.xml)/i, 'xl/drawings/_rels/$1.rels');
      const relsFile = zip.files[relsPath];
      const drawingFile = zip.files[drawingPath];

      if (!relsFile || !drawingFile) continue;

      const relsXml = await relsFile.async('string');
      const drawingXml = await drawingFile.async('string');

      // Map rId -> media file path (e.g. rId1 -> xl/media/image1.png)
      const rIdToMediaPath: Record<string, string> = {};
      const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
      let relMatch;
      while ((relMatch = relRegex.exec(relsXml)) !== null) {
        const id = relMatch[1];
        let target = relMatch[2];
        if (target.startsWith('../')) target = 'xl/' + target.slice(3);
        else if (!target.startsWith('xl/')) target = 'xl/media/' + target.split('/').pop();
        rIdToMediaPath[id] = target;
      }

      // Find all anchors and extract row index and rId
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

    // Collect fallback images only if drawing XML mapping wasn't found
    if (Object.keys(rowToImageMap).length === 0) {
      const mediaFiles = Object.keys(zip.files).filter(filename => /^xl\/media\//i.test(filename));
      mediaFiles.sort();
      for (const mediaPath of mediaFiles) {
        const zipFile = zip.files[mediaPath];
        if (zipFile && !zipFile.dir) {
          const fileData = await zipFile.async('nodebuffer');
          const ext = mediaPath.split('.').pop() || 'png';
          const savedUrl = await saveImageToDisk(fileData, ext);
          fallbackImages.push(savedUrl);
        }
      }
    }
  } catch (zipError) {
    console.warn('Excel zip media extraction notice:', zipError);
  }

  let fallbackImageIndex = 0;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const text = String(row['question'] || row['text'] || '').trim();
    if (!text) continue;

    const passage = String(row['passage'] || row['Passage'] || row['قطعة'] || '').trim() || null;
    const typeStr = String(row['type'] || row['Type'] || row['نوع'] || '').trim().toLowerCase();
    const type: 'mcq' | 'true_false' = (typeStr.includes('true') || typeStr.includes('tf') || typeStr.includes('صح')) ? 'true_false' : 'mcq';

    let imageUrl: string | null = null;
    const rawImg = String(
      row['image'] || row['imageUrl'] || row['imageEmbedded'] || row['صورة'] || row['الصورة'] || ''
    ).trim();

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

    // Match exact Excel row index from drawing XML
    if (!imageUrl) {
      const targetImage = rowToImageMap[rIdx + 1] || rowToImageMap[rIdx + 2] || rowToImageMap[rIdx];
      if (targetImage) {
        imageUrl = targetImage;
      }
    }

    // Fall back to sequential image list only if no drawing row map exists at all
    if (!imageUrl && Object.keys(rowToImageMap).length === 0 && fallbackImageIndex < fallbackImages.length) {
      imageUrl = fallbackImages[fallbackImageIndex++];
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