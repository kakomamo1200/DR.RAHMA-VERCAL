import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function sendResetCode(email: string, code: string) {
  const fromName = process.env.SMTP_FROM_NAME || 'Dr. Rahma Quiz Bank';
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #6d28d9; margin: 0; font-size: 24px;">🔐 ${fromName}</h1>
        <p style="color: #64748b; font-size: 14px; margin-top: 8px;">Password Reset Code / رمز إعادة تعيين كلمة المرور</p>
      </div>
      <div style="background: white; border-radius: 12px; padding: 24px; text-align: center; border: 1px solid #e2e8f0;">
        <p style="color: #334155; font-size: 14px; margin: 0 0 16px;">Your verification code is / رمز التحقق الخاص بك:</p>
        <div style="background: linear-gradient(135deg, #6d28d9, #7c3aed); color: white; font-size: 36px; font-weight: bold; letter-spacing: 12px; padding: 16px 24px; border-radius: 12px; display: inline-block; font-family: monospace;">
          ${code}
        </div>
        <p style="color: #ef4444; font-size: 13px; margin-top: 16px; font-weight: 600;">⏱ This code expires in 10 minutes / ينتهي خلال 10 دقائق</p>
      </div>
      <p style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 16px;">If you didn't request this, ignore this email. / إذا لم تطلب هذا، تجاهل هذا البريد.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"${fromName}" <${process.env.SMTP_EMAIL}>`,
    to: email,
    subject: `${code} — Password Reset Code / رمز إعادة تعيين كلمة المرور`,
    html,
  });
}
