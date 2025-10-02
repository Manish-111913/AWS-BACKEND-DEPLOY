const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const router = express.Router();
const { pool } = require('../config/database');

// Email transporter configuration
let transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: "invexis.test@gmail.com",
    pass: "xmyjnqnyutkllbmx" // Make sure this is your Gmail App Password
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Test email configuration on startup
async function testEmailConfig() {
  try {
    await transporter.verify();
    console.log('✅ SMTP server connection verified successfully');
  } catch (error) {
    console.error('❌ SMTP server connection failed:', error.message);
    console.log('Please check your Gmail App Password and ensure 2FA is enabled');
  }
}

testEmailConfig();

// Send verification email function
async function sendVerificationEmail(toEmail, token, name) {
  console.log(`📧 Sending verification email to: ${toEmail}`);
  
  const verifyUrl = `${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/api/auth/verify-email?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Email Verification</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; width:100vw; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
            <h2 style="color: #007bff; text-align: center;">Welcome to Our Platform!</h2>
            <p>Hello <strong>${name}</strong>,</p>
            <p>Thank you for signing up! To complete your registration and activate your account, please click the button below to verify your email address:</p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${verifyUrl}" 
                   style="background-color: #007bff; 
                          color: white; 
                          padding: 15px 30px; 
                          text-decoration: none; 
                          border-radius: 5px; 
                          display: inline-block;
                          font-weight: bold;">
                    ✅ Verify My Email Address
                </a>
            </div>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background-color: #e9ecef; padding: 10px; border-radius: 4px; font-family: monospace;">
                ${verifyUrl}
            </p>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
            
            <p style="color: #6c757d; font-size: 14px;">
                <strong>Important:</strong> This verification link will expire in 24 hours.
            </p>
            <p style="color: #6c757d; font-size: 14px;">
                If you didn't create an account, please ignore this email.
            </p>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"Your App" <invexis.test@gmail.com>`,
    to: toEmail,
    subject: '🔐 Please Verify Your Email Address',
    html,
    text: `Hello ${name},\n\nPlease verify your email by visiting: ${verifyUrl}\n\nThis link expires in 24 hours.`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw error;
  }
}

// Enhanced password validation
function validatePassword(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  const errors = [];
  
  if (password.length < minLength) {
    errors.push(`at least ${minLength} characters long`);
  }
  if (!hasUpperCase) {
    errors.push('at least one uppercase letter');
  }
  if (!hasLowerCase) {
    errors.push('at least one lowercase letter');
  }
  if (!hasNumbers) {
    errors.push('at least one number');
  }
  if (!hasSpecialChar) {
    errors.push('at least one special character');
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      message: `Password must contain: ${errors.join(', ')}`
    };
  }
  
  return { valid: true };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { name, email, password, confirmPassword } = req.body;
    
    // Input validation
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ 
        error: 'All fields are required',
        required: ['name', 'email', 'password', 'confirmPassword']
      });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Email format validation
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!emailRegex.test(email.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Password validation
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.message });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists (in both active and pending users)
    const existingUser = await client.query(
      'SELECT user_id, is_active FROM Users WHERE LOWER(email) = $1', 
      [normalizedEmail]
    );
    
    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      if (user.is_active) {
        return res.status(409).json({ error: 'Email is already registered and verified' });
      } else {
        return res.status(409).json({ 
          error: 'Email is already registered but not verified. Please check your email for the verification link or request a new one.',
          needsVerification: true
        });
      }
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user with is_active=false (PENDING VERIFICATION)
    const insertQuery = `
      INSERT INTO Users (
        business_id, 
        email, 
        password_hash, 
        name, 
        role_id, 
        is_active, 
        created_at, 
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING user_id, email, name
    `;
    
    const values = [
      1,                    // business_id
      normalizedEmail,      // email
      hashedPassword,       // password_hash
      name.trim(),         // name
      1,                   // role_id (assuming 1 is default user role)
      false                // is_active (false until email verification)
    ];
    
    const result = await client.query(insertQuery, values);
    const newUser = result.rows[0];
    
    console.log('👤 New user created with ID:', newUser.user_id);

    // Create verification token
    const tokenPayload = {
      userId: newUser.user_id,
      email: normalizedEmail,
      type: 'email_verification',
      timestamp: Date.now()
    };
    
    const verificationToken = jwt.sign(
      tokenPayload, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Send verification email
    console.log('📧 Attempting to send verification email...');
    await sendVerificationEmail(normalizedEmail, verificationToken, name);

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Please check your email and click the verification link to activate your account.',
      data: {
        userId: newUser.user_id,
        email: normalizedEmail,
        name: name.trim(),
        status: 'pending_verification'
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Signup error:', error);
    
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    if (error.message.includes('send')) {
      return res.status(500).json({ 
        error: 'User created but failed to send verification email. Please contact support.',
        emailError: true
      });
    }
    
    return res.status(500).json({ 
      error: 'Registration failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
    
  } finally {
    client.release();
  }
});

// GET /api/auth/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ Verification Failed</h2>
          <p>No verification token provided.</p>
          <a href="${process.env.PORT || 'https://page-test.edgeone.app'}/login" 
             style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
            Go to Login
          </a>
        </body>
      </html>
    `);
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { userId, email, type } = decoded;
    
    if (type !== 'email_verification') {
      throw new Error('Invalid token type');
    }

    console.log(`🔍 Verifying email for user ${userId}: ${email}`);

    // Check if user exists and is not already active
    const userCheck = await client.query(
      'SELECT user_id, name, email, is_active FROM Users WHERE user_id = $1 AND LOWER(email) = $2',
      [userId, email.toLowerCase()]
    );

    if (userCheck.rows.length === 0) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #dc3545;">❌ Verification Failed</h2>
            <p>Invalid verification token or user not found.</p>
            <a href="${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/signup" 
               style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
              Sign Up Again
            </a>
          </body>
        </html>
      `);
    }

    const user = userCheck.rows[0];

    if (user.is_active) {
      return res.status(200).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ffc107;">⚠️ Already Verified</h2>
            <p>Your email address has already been verified.</p>
            <a href="${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/login" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
              Continue to Login
            </a>
          </body>
        </html>
      `);
    }

    // Activate the user account
    const updateResult = await client.query(
      `UPDATE Users 
       SET is_active = true, 
           updated_at = NOW(),
           last_active_at = NOW()
       WHERE user_id = $1 AND LOWER(email) = $2
       RETURNING user_id, name, email`,
      [userId, email.toLowerCase()]
    );

    if (updateResult.rows.length === 0) {
      throw new Error('Failed to activate user account');
    }

    await client.query('COMMIT');
    
    console.log('✅ Email verified successfully for user:', updateResult.rows[0]);

    // Success page
    return res.status(200).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f8f9fa;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #28a745; margin-bottom: 20px;">✅ Email Verified Successfully!</h2>
            <p style="color: #666; margin-bottom: 30px;">
              Welcome <strong>${user.name}</strong>! Your account has been activated and you can now sign in.
            </p>
            <a href="${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/login" 
               style="background-color: #007bff; 
                      color: white; 
                      padding: 15px 30px; 
                      text-decoration: none; 
                      border-radius: 5px; 
                      display: inline-block;
                      font-weight: bold;">
              Continue to Login 🚀
            </a>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Email verification error:', error);
    
    return res.status(400).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #dc3545;">❌ Verification Failed</h2>
          <p>The verification link is invalid or has expired.</p>
          <div style="margin-top: 30px;">
            <a href="${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/signup" 
               style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 0 10px;">
              Sign Up Again
            </a>
            <a href="${process.env.FRONTEND_URL || 'https://page-test.edgeone.app'}/resend-verification" 
               style="background-color: #ffc107; color: black; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 0 10px;">
              Resend Verification
            </a>
          </div>
        </body>
      </html>
    `);
    
  } finally {
    client.release();
  }
});

// POST /api/auth/signin
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required',
        fields: { email: !email, password: !password }
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`🔑 Sign in attempt for: ${normalizedEmail}`);

    // Find user by email
    const userResult = await pool.query(
      `SELECT 
        user_id, 
        email, 
        password_hash, 
        name, 
        role_id, 
        business_id, 
        is_active,
        created_at,
        last_login_at
      FROM Users 
      WHERE LOWER(email) = $1`,
      [normalizedEmail]
    );

    if (userResult.rows.length === 0) {
      console.log('❌ User not found:', normalizedEmail);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    console.log(`👤 Found user: ${user.name} (ID: ${user.user_id}), Active: ${user.is_active}`);

    // Check if email is verified
    if (!user.is_active) {
      console.log('⚠️ User email not verified:', normalizedEmail);
      return res.status(403).json({ 
        error: 'Please verify your email address before signing in. Check your inbox for the verification link.',
        needsVerification: true,
        email: normalizedEmail
      });
    }

    // Verify password
    console.log('🔍 Verifying password...');
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', normalizedEmail);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('✅ Password verified successfully');

    // Update last login timestamp
    await pool.query(
      'UPDATE Users SET last_login_at = NOW(), last_active_at = NOW() WHERE user_id = $1',
      [user.user_id]
    );

    // Generate session token
    const sessionPayload = {
      userId: user.user_id,
      email: user.email,
      roleId: user.role_id,
      businessId: user.business_id,
      type: 'session'
    };

    const sessionToken = jwt.sign(
      sessionPayload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('🎉 Sign in successful for user:', user.name);

    return res.status(200).json({
      success: true,
      message: 'Sign in successful',
      token: sessionToken,
      user: {
        id: user.user_id,
        name: user.name,
        email: user.email,
        roleId: user.role_id,
        businessId: user.business_id
      }
    });

  } catch (error) {
    console.error('❌ Sign in error:', error);
    return res.status(500).json({ 
      error: 'Server error during sign in. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find unverified user
    const userResult = await pool.query(
      'SELECT user_id, name, email, is_active FROM Users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    if (user.is_active) {
      return res.status(400).json({ error: 'Email is already verified' });
    }

    // Create new verification token
    const tokenPayload = {
      userId: user.user_id,
      email: normalizedEmail,
      type: 'email_verification',
      timestamp: Date.now()
    };
    
    const verificationToken = jwt.sign(
      tokenPayload, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Send verification email
    await sendVerificationEmail(normalizedEmail, verificationToken, user.name);

    return res.status(200).json({
      success: true,
      message: 'Verification email sent successfully. Please check your inbox.'
    });

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    return res.status(500).json({ 
      error: 'Failed to send verification email. Please try again later.' 
    });
  }
});

// GET /api/auth/status - Check authentication status
router.get('/status', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'session') {
      return res.status(401).json({ authenticated: false });
    }
    
    return res.status(200).json({ 
      authenticated: true,
      user: {
        userId: decoded.userId,
        email: decoded.email,
        roleId: decoded.roleId
      }
    });
  } catch (error) {
    return res.status(401).json({ authenticated: false });
  }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'invexis-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
  const { name, email, phone_number } = req.body;
  const userId = req.user.userId;

  console.log('➡️  PUT /api/auth/profile', { userId, body: { name, email, phone_number } });

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Name and email are required' 
      });
    }

    // Check if email is already taken by another user (Postgres)
  const emailCheckQuery = 'SELECT user_id FROM Users WHERE email = $1 AND user_id != $2';
  const emailExists = await pool.query(emailCheckQuery, [email, userId]);
    
    if (emailExists.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is already taken by another user' 
      });
    }

    // Update user profile
    const updateQuery = `
      UPDATE Users 
      SET name = $1, email = $2, phone_number = $3, updated_at = NOW() 
      WHERE user_id = $4
    `;
    
  await pool.query(updateQuery, [name, email, phone_number || null, userId]);

    // Get updated user data
    const getUserQuery = 'SELECT user_id, name, email, phone_number, created_at FROM Users WHERE user_id = $1';
  const updatedUser = await pool.query(getUserQuery, [userId]);
  console.log('✅ Profile updated DB rows:', updatedUser.rows);

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.rows[0].user_id,
        fullName: updatedUser.rows[0].name,
        name: updatedUser.rows[0].name,
        email: updatedUser.rows[0].email,
        phone: updatedUser.rows[0].phone_number,
        createdAt: updatedUser.rows[0].created_at
      }
    });

  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update profile',
      details: process.env.NODE_ENV === 'development' ? (error.message || String(error)) : undefined
    });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

  console.log('➡️  PUT /api/auth/change-password', { userId, hasCurrent: !!currentPassword, hasNew: !!newPassword });

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'Current password and new password are required' 
      });
    }

    // Validate new password strength (optional - add your requirements)
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'New password must be at least 6 characters long' 
      });
    }

  // Get current user to verify current password (Postgres)
  const getUserQuery = 'SELECT email, password_hash FROM Users WHERE user_id = $1';
  const userResult = await pool.query(getUserQuery, [userId]);

  if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

  const user = userResult.rows[0];

    // Verify current password
    const currentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!currentPasswordValid) {
      return res.status(400).json({ 
        success: false, 
        error: 'Current password is incorrect' 
      });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

  // Update password in database (Postgres)
  const updatePasswordQuery = 'UPDATE Users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2';
  await pool.query(updatePasswordQuery, [hashedNewPassword, userId]);
  console.log('✅ Password updated for userId:', userId);

    res.json({ 
      success: true, 
      message: 'Password changed successfully' 
    });

  } catch (error) {
    console.error('❌ Password change error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to change password',
      details: process.env.NODE_ENV === 'development' ? (error.message || String(error)) : undefined
    });
  }
});

// Test endpoint for debugging
router.get('/test-email', async (req, res) => {
  try {
    const testEmail = req.query.email || 'test@example.com';
    
    await transporter.sendMail({
      from: '"Test" <chowdaryvineelan@gmail.com>',
      to: testEmail,
      subject: 'Test Email - ' + new Date().toISOString(),
      html: '<h2>✅ Email configuration is working!</h2><p>This is a test email sent at ' + new Date().toISOString() + '</p>'
    });

    res.json({ 
      success: true, 
      message: 'Test email sent successfully',
      to: testEmail
    });
  } catch (error) {
    console.error('Test email failed:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Test email failed',
      error: error.message 
    });
  }
});

module.exports = router;