import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getUserFromRequest, requireAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request); if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    const bytes = await file.arrayBuffer(); const buffer = Buffer.from(bytes);
    const ext = path.extname(file.name) || '.bin';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), buffer);
    return NextResponse.json({ url: `/uploads/${filename}`, filename });
  } catch (error) { console.error('Upload error:', error); return NextResponse.json({ error: 'Upload failed' }, { status: 500 }); }
}