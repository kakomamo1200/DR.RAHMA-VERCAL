import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, requireAdmin, hashPassword } from '@/lib/auth';
import { sendResetCode } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Admin resetting a student's password
    if (action === 'admin-reset') {
      const user = await getUserFromRequest(request);
      if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      const { userId, newPassword } = body;
      if (!userId || !newPassword) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      const hashed = await hashPassword(newPassword);
      await db.user.update({ where: { id: userId }, data: { password: hashed } });
      return NextResponse.json({ success: true });
    }

    // Step 1: Send verification code to email
    if (action === 'send-code') {
      const { email } = body;
      if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
      const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (!user) return NextResponse.json({ error: 'No account found with this email / لا يوجد حساب بهذا البريد' }, { status: 404 });

      // Invalidate any previous unused codes for this email
      await db.passwordReset.updateMany({ where: { email: user.email, used: false }, data: { used: true } });

      // Generate 6-digit code
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await db.passwordReset.create({ data: { email: user.email, code, expiresAt } });

      try {
        await sendResetCode(user.email, code);
      } catch (emailError) {
        console.error('Email send error:', emailError);
        return NextResponse.json({ error: 'Failed to send email. Check SMTP settings. / فشل إرسال البريد' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Code sent to your email / تم إرسال الرمز لبريدك الإلكتروني' });
    }

    // Step 2: Verify the code
    if (action === 'verify-code') {
      const { email, code } = body;
      if (!email || !code) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

      const resetRecord = await db.passwordReset.findFirst({
        where: { email: email.toLowerCase().trim(), code, used: false, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!resetRecord) return NextResponse.json({ error: 'Invalid or expired code / رمز غير صحيح أو منتهي الصلاحية' }, { status: 400 });

      return NextResponse.json({ success: true, verified: true });
    }

    // Step 3: Reset password after verification
    if (action === 'reset') {
      const { email, code, newPassword } = body;
      if (!email || !code || !newPassword) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      if (newPassword.length < 4) return NextResponse.json({ error: 'Password must be at least 4 characters / كلمة المرور يجب أن تكون 4 أحرف على الأقل' }, { status: 400 });

      const resetRecord = await db.passwordReset.findFirst({
        where: { email: email.toLowerCase().trim(), code, used: false, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!resetRecord) return NextResponse.json({ error: 'Invalid or expired code / رمز غير صحيح أو منتهي الصلاحية' }, { status: 400 });

      const user = await db.user.findUnique({ where: { email: resetRecord.email } });
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

      const hashed = await hashPassword(newPassword);
      await db.user.update({ where: { id: user.id }, data: { password: hashed } });
      await db.passwordReset.update({ where: { id: resetRecord.id }, data: { used: true } });

      return NextResponse.json({ success: true, message: 'Password reset successfully / تم تغيير كلمة المرور بنجاح' });
    }

    // Legacy: direct reset without code (keeping backward compatibility for admin)
    const { email, newPassword, userId } = body;
    if (userId) {
      const user = await getUserFromRequest(request);
      if (!user || !requireAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      const hashed = await hashPassword(newPassword);
      await db.user.update({ where: { id: userId }, data: { password: hashed } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
