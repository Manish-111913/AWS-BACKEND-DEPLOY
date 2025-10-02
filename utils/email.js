const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

// Email transporter configuration (Gmail with App Password)
let transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'invexis.test@gmail.com',
    pass: process.env.SMTP_PASS || 'xmyjnqnyutkllbmx'
  },
  tls: { rejectUnauthorized: false }
});

// Verify SMTP on module load
(async () => {
  try {
    await transporter.verify();
    console.log('✅ SMTP server connection verified (utils/email)');
  } catch (error) {
    console.error('❌ SMTP verification failed (utils/email):', error.message);
  }
})();

function createVerificationToken(userId, email) {
  const payload = {
    userId,
    email: (email || '').toLowerCase().trim(),
    type: 'email_verification',
    timestamp: Date.now()
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
}

async function sendVerificationEmail(toEmail, token, name) {
  const verifyUrl = `${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/api/auth/verify-email?token=${token}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Email Verification</title></head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
        <h2 style="color: #007bff; text-align: center;">Welcome!</h2>
        <p>Hello <strong>${name || 'there'}</strong>,</p>
        <p>Please click the button below to verify your email and activate your account:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Verify Email</a>
        </div>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; background-color: #e9ecef; padding: 10px; border-radius: 4px; font-family: monospace;">${verifyUrl}</p>
      </div>
    </body>
    </html>`;

  const mailOptions = {
    from: `Invexis <${process.env.SMTP_USER || 'invexis.test@gmail.com'}>`,
    to: toEmail,
    subject: 'Verify your email address',
    html,
    text: `Hello ${name || ''},\n\nVerify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  createVerificationToken,
  sendVerificationEmail,
};
