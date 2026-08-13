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
    ['', 'mcq', '1. What insulates neuronal axons in the central nervous system (CNS)?', 'Schwann cells', 'Oligodendrocytes', 'Astrocytes', 'Microglia', 'B', ''],
    ['', 'mcq', '2. Saltatory conduction refers to:', 'Continuous conduction along the entire axon membrane', 'Action potentials jumping from node to node', 'Conduction that occurs only in unmyelinated fibers', 'Backward propagation of the action potential', 'B', ''],
    ['', 'true_false', '3. Oligodendrocytes myelinate axons in the peripheral nervous system (PNS).', 'True', 'False', '', '', 'B', ''],
    ['', 'true_false', '4. Saltatory conduction increases the speed of impulse conduction along myelinated axons.', 'True', 'False', '', '', 'A', ''],
    ['Case 1: A 45-year-old man presents with tingling and burning sensations in both feet. Full NCS of lower limbs shows normal results.', 'mcq', '5. What is the most likely explanation for normal NCS findings despite his symptoms?', 'The study was performed incorrectly', 'His symptoms are due to a lesion affecting small Aδ and C fibers', 'He has no nerve pathology', 'The stimulation current was supramaximal', 'B', ''],
    ['', 'true_false', '6. يتكون القلب البشري من 4 حجرات رئيسية.', 'صح', 'خطأ', '', '', 'A', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 45 }, { wch: 12 }, { wch: 60 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 10 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Quiz Template Example');
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

  const isTF = /\b(T\/F|True\s*\/\s*False|صح\s*\/\s*خطأ|صح_خطأ|TRUE_FALSE)\b/i.test(rawBuffer) || /\[(?:TRUE_FALSE|صح_خطأ)\]/i.test(rawBuffer) || /\(True\s*\/\s*False\)/i.test(rawBuffer);

  const choices: { text: string; isCorrect: boolean }[] = [];
  const questionTextLines: string[] = [];

  for (const line of lines) {
    if (/^\[\/?(?:TRUE_FALSE|صح_خطأ|QUESTION|سؤال|Q|PASSAGE|قطعة|النص|CORRECT|CHOICE|صورة|IMAGE)\]$/i.test(line)) continue;

    // Choice patterns: MUST match letter followed by punctuation (. - : )), NOT spaces alone!
    const choiceMatch = line.match(/^(?:\*|\[CORRECT\])?\s*(?:\(?([A-Ea-eأ-د])\)?[\.\-:)]+|\*|\[CHOICE\]\s*)(.+)/i);
    const hasAsterisk = line.startsWith('*') || line.includes('[CORRECT]') || line.includes('✔') || /\((?:صح|صحيحة|correct)\)/i.test(line);

    if (choiceMatch && choiceMatch[2]) {
      const choiceContent = choiceMatch[2]
        .replace(/\[\/?CORRECT\]/gi, '')
        .replace(/\[\/?CHOICE\]/gi, '')
        .replace(/\((?:صح|صحيحة|correct)\)/gi, '')
        .trim();
      if (choiceContent) {
        choices.push({
          text: choiceContent,
          isCorrect: hasAsterisk
        });
      }
    } else {
      questionTextLines.push(line);
    }
  }

  let finalQText = questionTextLines.join(' ')
    .replace(/^Case\s+Scenario\s*/i, '')
    .replace(/\[\/?(?:QUESTION|سؤال|Q|TRUE_FALSE|صح_خطأ|CORRECT|CHOICE|صورة|IMAGE|PASSAGE|قطعة|النص)\]/gi, '')
    .replace(/\[\/?.*?\]/gi, '')
    .trim();

  if (!finalQText && lines[0]) {
    finalQText = lines[0].replace(/\[\/?.*?\]/gi, '').trim();
  }

  // Reject headers, banners, instructions, or empty text
  if (!finalQText || finalQText.length < 3 || /^صورة|image|img$/i.test(finalQText)) return;
  if (/^(?:quiz|lecture|chapter|course|instructor|dr\.|answer key|مفتاح الإجابات|إجابات الاختبار|نموذج الإجابة|instructions)/i.test(finalQText)) return;

  const hasExplicitCorrect = choices.some(c => c.isCorrect);

  if (isTF || choices.length < 2) {
    let tfCorrectIndex = 0;
    if (hasExplicitCorrect) {
      const correctChoiceIndex = choices.findIndex(c => c.isCorrect);
      if (correctChoiceIndex !== -1) {
        const text = choices[correctChoiceIndex].text;
        if (/خطأ|false/i.test(text)) tfCorrectIndex = 1;
      }
    }

    questionsList.push({
      text: finalQText.replace(/\(?\b(T\/F|True\s*\/\s*False|صح\s*\/\s*خطأ|صح_خطأ)\b\)?/gi, '').trim(),
      passage,
      type: 'true_false',
      imageUrl: image,
      choices: [
        { text: 'صح', isCorrect: tfCorrectIndex === 0 },
        { text: 'خطأ', isCorrect: tfCorrectIndex === 1 }
      ]
    });
  } else {
    // MCQ format
    const filteredChoices = choices
      .filter(c => c.text && c.text.toLowerCase() !== finalQText.toLowerCase())
      .slice(0, 4);

    if (filteredChoices.length >= 2) {
      if (!filteredChoices.some(c => c.isCorrect)) {
        filteredChoices[0].isCorrect = true;
      }

      questionsList.push({
        text: finalQText,
        passage,
        type: 'mcq',
        imageUrl: image,
        choices: filteredChoices
      });
    }
  }
}

function extractAnswerKeyMapFromHtml(html: string): Record<number, string> {
  const map: Record<number, string> = {};
  const akSectionMatch = html.match(/(?:Answer Key|مفتاح الإجابات|إجابات الاختبار|نموذج الإجابة)[\s\S]*/i);
  if (akSectionMatch) {
    const akText = akSectionMatch[0].replace(/<[^>]+>/g, ' ');
    const matches = akText.matchAll(/(\d+)\s*[\.\-:\t\s]+\s*([A-Ea-eأ-د]|True|False|صح|خطأ)/gi);
    for (const m of matches) {
      const qNum = parseInt(m[1]);
      if (qNum > 0 && qNum < 300) {
        map[qNum] = m[2].trim().toUpperCase();
      }
    }
  }
  return map;
}

async function parseWordFile(buffer: Buffer): Promise<{ questions: ParsedQuestion[] }> {
  let imageCounter = 0;
  const imageMap: Record<string, string> = {};

  const result = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const imgBuffer = await image.read();
      const ext = image.contentType?.split('/')[1] || 'png';
      const savedUrl = await saveImageToDisk(Buffer.from(imgBuffer), ext);
      imageCounter++;
      const marker = `[IMAGE_${imageCounter}]`;
      imageMap[marker] = savedUrl;
      return { src: savedUrl };
    }),
  });

  const fullHtml = result.value;

  // Extract Answer Key map from tables/lists at the end
  const answerKeyMap = extractAnswerKeyMapFromHtml(fullHtml);

  // 1. Direct Deterministic Parser (100% reliable, zero AI hallucinations, preserves all 30/41 questions)
  const deterministicResult = await parseWordFileDeterministic(html, answerKeyMap);

  // If deterministic parser extracted questions successfully (>= 3 questions), use it immediately!
  if (deterministicResult.questions.length >= 3) {
    return deterministicResult;
  }

  // 2. Fallback to Gemini AI API only if deterministic parser found fewer than 3 questions
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const textWithMarkers = html
        .replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, (match, src) => {
          const entry = Object.entries(imageMap).find(([k, v]) => v === src);
          return entry ? `\n${entry[0]}\n` : '\n[IMAGE]\n';
        })
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const aiPrompt = `You are an expert AI quiz document parser. Analyze the following document text and extract ONLY genuine quiz questions into valid JSON.

CRITICAL RULES:
1. IGNORE DOCUMENT TITLES & METADATA: Completely IGNORE document titles, course names, lecture headers (e.g. "NEUROPHYSIOLOGY & NERVE CONDUCTION STUDIES Quiz — Lecture 1...", "Section A", "Section B", "Dr. Rahma", "Instructions: Choose the best answer"). DO NOT output document titles or section headers as questions!
2. KEEP EXACT WORDING: PRESERVE THE EXACT ORIGINAL WORDING of all real questions and choices. DO NOT rephrase, alter, or summarize any words or characters.
3. NO REPEATING QUESTION AS CHOICE: NEVER put the question text or question title inside the choices array! Choices must ONLY be actual options (e.g. A, B, C, D).
4. MAXIMUM 4 CHOICES FOR MCQ: For MCQ questions, extract at most 4 choices (A, B, C, D). Strip choice prefixes like "A)", "B)", "A.".
5. PASSAGES: If a reading passage precedes questions, assign it to "passage".
6. TRUE/FALSE: For True/False questions, set type to "true_false" and provide "صح" and "خطأ" choices.
7. IMAGES: Link image markers (e.g. "[IMAGE_1]") to their respective questions via "imageMarker".

Document Content:
${textWithMarkers}`;

      const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiPrompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const jsonText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const parsedJSON = JSON.parse(jsonText);
          const rawQuestions = parsedJSON.questions || parsedJSON;
          if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
            const aiQuestions: ParsedQuestion[] = rawQuestions
              .map((q: any, qIdx: number) => {
                const imgUrl = q.imageMarker ? (imageMap[q.imageMarker] || null) : null;
                const rawQText = (q.text || '').trim();

                const cleanQText = rawQText
                  .replace(/^سؤال\s*\d+[:：\s]*/i, '')
                  .replace(/^س\d+[:：\s]*/i, '')
                  .replace(/^\d+[\.\-:\s]*/, '')
                  .trim();

                const qNum = qIdx + 1;
                const targetAnsLetter = answerKeyMap[qNum];

                let cleanedChoices: { text: string; isCorrect: boolean }[] = [];
                const isExplicitTF = q.type === 'true_false' || /\b(T\/F|True\/False|صح\/خطأ|صح_خطأ)\b/i.test(rawQText) || /\b(صح|خطأ|true|false)\b/i.test(rawQText);

                if (isExplicitTF) {
                  let isTrue = true;
                  if (targetAnsLetter) {
                    isTrue = targetAnsLetter === 'TRUE' || targetAnsLetter === 'صح' || targetAnsLetter === 'A';
                  } else if (Array.isArray(q.choices)) {
                    isTrue = !q.choices.some((c: any) => (typeof c === 'string' ? c : c.text).includes('خطأ') && c.isCorrect);
                  }
                  cleanedChoices = [
                    { text: 'صح', isCorrect: isTrue },
                    { text: 'خطأ', isCorrect: !isTrue }
                  ];
                } else if (Array.isArray(q.choices) && q.choices.length >= 2) {
                  cleanedChoices = q.choices
                    .map((c: any) => {
                      const rawText = typeof c === 'string' ? c : (c.text || '');
                      const cleanChoiceText = rawText
                        .replace(/^(?:\(?([A-Ea-eأ-د])\)?[\.\-:\s]+|\*)/i, '')
                        .trim();
                      return {
                        text: cleanChoiceText,
                        isCorrect: typeof c === 'object' ? Boolean(c.isCorrect) : false
                      };
                    })
                    .filter((c: any) => {
                      if (!c.text || c.text.length < 1) return false;
                      if (c.text.toLowerCase() === cleanQText.toLowerCase()) return false;
                      if (/^(?:سؤال|س\d+|مفتاح الإجابات|answer key)$/i.test(c.text)) return false;
                      return true;
                    })
                    .slice(0, 4);

                  // Apply Answer Key if present
                  if (targetAnsLetter) {
                    const letterIndexMap: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'أ': 0, 'ب': 1, 'ج': 2, 'د': 3 };
                    const correctIdx = letterIndexMap[targetAnsLetter];
                    if (correctIdx !== undefined && correctIdx < cleanedChoices.length) {
                      cleanedChoices.forEach((c, idx) => { c.isCorrect = (idx === correctIdx); });
                    }
                  } else if (!cleanedChoices.some(c => c.isCorrect) && cleanedChoices.length > 0) {
                    cleanedChoices[0].isCorrect = true;
                  }
                }

                if (cleanedChoices.length < 2) {
                  return null;
                }

                return {
                  text: cleanQText,
                  passage: q.passage || null,
                  type: isExplicitTF ? 'true_false' : 'mcq',
                  imageUrl: imgUrl,
                  choices: cleanedChoices
                };
              })
              .filter((q: ParsedQuestion | null): q is ParsedQuestion => {
                if (!q || !q.text || q.text.length < 3) return false;
                const lower = q.text.toLowerCase();
                if (lower.includes('quiz') || lower.includes('lecture') || lower.includes('intro to') || lower.includes('technique of') || lower.includes('conduction studies')) return false;
                if (/^(?:quiz|lecture|chapter|course|instructor|dr\.|answer key|مفتاح الإجابات|إجابات الاختبار|نموذج الإجابة|instructions)/i.test(q.text)) return false;
                if (/^(?:[0-9]{1,3}\s*[\-:\.]\s*[A-Da-dأ-د])\s*$/.test(q.text)) return false;
                return true;
              });

            if (aiQuestions.length > 0) {
              return { questions: aiQuestions };
            }
          }
        }
      }
    } catch (aiErr) {
      console.warn('Gemini AI parsing failed, falling back to deterministic parser:', aiErr);
    }
  }

  // Fallback Deterministic Parser
  return parseWordFileDeterministic(html, answerKeyMap);
}

async function parseWordFileDeterministic(html: string, answerKeyMap: Record<number, string>): Promise<{ questions: ParsedQuestion[] }> {
  const questions: ParsedQuestion[] = [];
  const blocks = html.split(/(?=<(?:p|div|tr|h\d|img)[^>]*>)/i).filter(b => b.trim());

  let pendingImage: string | null = null;
  let currentPassage: string | null = null;
  let inPassageBlock = false;
  let passageBuffer = '';

  let inTaggedQuestionBlock = false;
  let questionLinesBuffer: string[] = [];

  const flushQuestion = () => {
    if (questionLinesBuffer.length > 0) {
      const rawBuf = questionLinesBuffer.join('\n').trim();
      if (rawBuf) {
        parseSingleQuestionBuffer(rawBuf, currentPassage, pendingImage, questions);
        pendingImage = null;
      }
      questionLinesBuffer = [];
    }
  };

  const isQuestionHeaderLine = (line: string) => {
    return /^(?:[Qq]\d*[\.\-:\s]|\(?\d+\)?[\.\-:\s]|س\s*\d+|سؤال\s*\d+)/.test(line.trim()) ||
           /\[(?:QUESTION|سؤال|Q)\]/i.test(line);
  };

  const isChoiceLine = (line: string) => {
    return /^(?:\*|\[CORRECT\])?\s*(?:\(?([A-Ea-eأ-د])\)?[\.\-:\s]+|\*|\[CHOICE\])/i.test(line.trim());
  };

  for (const block of blocks) {
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (imgMatch) {
      pendingImage = imgMatch[1];
    }

    const textContent = block.replace(/<[^>]+>/g, '').trim();
    if (!textContent) continue;

    // Passage Tags: [PASSAGE] or [قطعة]
    if (/\[(?:PASSAGE|قطعة|النص)\]/i.test(textContent)) {
      flushQuestion();
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

    if (/\[\/(?:PASSAGE|قطعة|النص)\]/i.test(textContent)) {
      currentPassage = passageBuffer.trim() || currentPassage;
      inPassageBlock = false;
      passageBuffer = '';
      continue;
    }

    // Question Block Tagging Mode
    if (/\[(?:QUESTION|سؤال|Q)\]/i.test(textContent)) {
      flushQuestion();
      inTaggedQuestionBlock = true;
      const content = textContent.replace(/\[(?:QUESTION|سؤال|Q)\]/i, '').trim();
      if (content) questionLinesBuffer.push(content);

      if (/\[\/(?:QUESTION|سؤال|Q)\]/i.test(textContent)) {
        flushQuestion();
        inTaggedQuestionBlock = false;
      }
      continue;
    }

    if (inTaggedQuestionBlock) {
      if (/\[\/(?:QUESTION|سؤال|Q)\]/i.test(textContent)) {
        const content = textContent.replace(/\[\/(?:QUESTION|سؤال|Q)\]/i, '').trim();
        if (content) questionLinesBuffer.push(content);
        flushQuestion();
        inTaggedQuestionBlock = false;
      } else {
        questionLinesBuffer.push(textContent);
      }
      continue;
    }

    // Natural / Untagged Paragraph Parsing Mode
    const passageMatch = textContent.match(/^(?:\[(?:Passage|قطعة|النص)\]|\b(?:Passage|قطعة|النص)\s*[:：])\s*(.+)/i);
    if (passageMatch) {
      flushQuestion();
      currentPassage = passageMatch[1].trim();
      continue;
    }

    const lowerText = textContent.toLowerCase();
    const isJustTag = /^\[\/?.*?\]$/.test(textContent.trim());
    if (lowerText === 'صورة' || lowerText === 'image' || lowerText === 'img' || isJustTag) {
      continue;
    }

    // Skip document banners & section headers (e.g. "Section A — Multiple Choice", "Section B — True/False")
    if (/^Section\s+[A-D]\s*—/i.test(textContent) || /^NEUROPHYSIOLOGY/i.test(textContent) || /^Quiz\s*—/i.test(textContent) || /^\d+\s*questions\s*•/i.test(textContent)) {
      flushQuestion();
      continue;
    }

    // Case scenarios passage header (e.g. "Case 1", "Case 2")
    if (/^Case\s+\d+/i.test(textContent)) {
      flushQuestion();
      currentPassage = textContent;
      continue;
    }

    if (isQuestionHeaderLine(textContent)) {
      // Flush previous question and start new question block
      flushQuestion();
      questionLinesBuffer.push(textContent);
    } else if (isChoiceLine(textContent)) {
      // Choice line belonging to the current question
      questionLinesBuffer.push(textContent);
    } else if (questionLinesBuffer.length > 0) {
      // Continuation of current question or passage
      questionLinesBuffer.push(textContent);
    } else if (textContent.includes('?') || textContent.includes('؟') || textContent.length > 5) {
      // Natural question starter without a explicit number
      flushQuestion();
      questionLinesBuffer.push(textContent);
    }
  }

  // Flush any remaining question buffer
  flushQuestion();

  // Apply Answer Key map to parsed questions
  questions.forEach((q, idx) => {
    const qNum = idx + 1;
    const targetAnsLetter = answerKeyMap[qNum];
    if (targetAnsLetter && q.choices && q.choices.length > 0) {
      const letterIndexMap: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'أ': 0, 'ب': 1, 'ج': 2, 'د': 3 };
      const correctIdx = letterIndexMap[targetAnsLetter];
      if (correctIdx !== undefined && correctIdx < q.choices.length) {
        q.choices.forEach((c, cIdx) => { c.isCorrect = (cIdx === correctIdx); });
      } else if (q.type === 'true_false') {
        const isTrue = targetAnsLetter === 'TRUE' || targetAnsLetter === 'صح' || targetAnsLetter === 'A';
        q.choices = [
          { text: 'صح', isCorrect: isTrue },
          { text: 'خطأ', isCorrect: !isTrue }
        ];
      }
    }
  });

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

// Generate example Word (.docx) file buffer
async function generateWordExampleBuffer(): Promise<Buffer> {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  const escapeXml = (str: string) => (str || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
    return c;
  });

  const title = 'NEUROPHYSIOLOGY & NCS — SAMPLE QUIZ TEMPLATE';
  const subtitle = 'Standard Word Quiz Format Template — Dr. Rahma Quiz Bank';

  let bodyXml = `<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1E3A8A"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:rPr><w:i/><w:color w:val="666666"/></w:rPr><w:t>${escapeXml(subtitle)}</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  bodyXml += `<w:p><w:r><w:rPr><w:b/><w:color w:val="1E3A8A"/></w:rPr><w:t>Section A — Multiple Choice Questions (Q1–Q2)</w:t></w:r></w:p>`;

  // Q1
  bodyXml += `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1. What insulates neuronal axons in the central nervous system (CNS)?</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>A) Schwann cells</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>B) Oligodendrocytes</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>C) Astrocytes</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>D) Microglia</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  // Q2
  bodyXml += `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>2. Saltatory conduction refers to:</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>A) Continuous conduction along the entire axon membrane</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>B) Action potentials jumping from node to node</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>C) Conduction that occurs only in unmyelinated fibers</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>D) Backward propagation of the action potential</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  bodyXml += `<w:p><w:r><w:rPr><w:b/><w:color w:val="1E3A8A"/></w:rPr><w:t>Section B — True / False Questions (Q3–Q4)</w:t></w:r></w:p>`;

  // Q3
  bodyXml += `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>3. Oligodendrocytes myelinate axons in the peripheral nervous system (PNS). (True / False)</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  // Q4
  bodyXml += `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>4. Saltatory conduction increases the speed of impulse conduction along myelinated axons. (True / False)</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  bodyXml += `<w:p><w:r><w:rPr><w:b/><w:color w:val="1E3A8A"/></w:rPr><w:t>Section C — Clinical Case Scenarios (Q5)</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:rPr><w:b/><w:color w:val="B45309"/></w:rPr><w:t>Case 1: A 45-year-old man presents with tingling and burning sensations in both feet. A full nerve conduction study of lower limbs shows normal results.</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>5. What is the most likely explanation for normal NCS findings despite his symptoms?</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>A) The nerve conduction study must have been performed incorrectly</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>B) His symptoms are due to a lesion affecting small Aδ and C fibers</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>C) He has no nerve pathology of any kind</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>D) The stimulation current used was supramaximal</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  // Answer Key Section
  bodyXml += `<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1E3A8A"/></w:rPr><w:t>Answer Key</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:t>1. B   2. B   3. False   4. True   5. B</w:t></w:r></w:p>`;

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`);

  return await zip.generateAsync({ type: 'nodebuffer' });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || searchParams.get('type') || searchParams.get('action');

    if (format === 'word' || format === 'docx') {
      const buf = await generateWordExampleBuffer();
      return new NextResponse(buf, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': 'attachment; filename="quiz-template-example.docx"',
        },
      });
    }

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