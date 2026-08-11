import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, getUserFromRequest, requireAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, newPassword, userId } = body;

    // Admin resetting a student password by userId
    const requestingUser = await getUserFromRequest(request);
    if (requestingUser && requireAdmin(requestingUser) && userId) {
      if (!newPassword || newPassword.length < 4) {
        return NextResponse.json({ error: 'Password must be at least 4 characters' }, { status: 400 });
      }
      const hashedPassword = await hashPassword(newPassword);
      await db.user.update({ where: { id: userId }, data: { password: hashedPassword } });
      return NextResponse.json({ success: true, message: 'Password updated successfully' });
    }

    // User resetting own password via email
    if (!email || !newPassword) {
      return NextResponse.json({ error: 'Email and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 4) {
      return NextResponse.json({ error: 'Password must be at least 4 characters' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });
    }

    const hashedPassword = await hashPassword(newPassword);
    await db.user.update({ where: { id: user.id }, data: { password: hashedPassword } });

    return NextResponse.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
