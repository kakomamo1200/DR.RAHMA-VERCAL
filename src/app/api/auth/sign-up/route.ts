import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 409 });
    }
    const userCount = await db.user.count();
    const role = userCount === 0 ? 'admin' : 'student';
    const hashed = await hashPassword(password);
    const user = await db.user.create({
      data: { email: email.toLowerCase().trim(), password: hashed, name: name || null, role },
    });
    const token = generateToken({ userId: user.id, email: user.email, role: user.role });
    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (error) {
    console.error('Sign-up error:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
