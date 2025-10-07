# Email Verification Flow - User Guide

## ✅ Updated Sign-Up Process

The sign-up process now includes email verification!

### Step-by-Step Guide

#### 1. **Sign Up** (http://localhost:3000/signup)
- Enter your email address
- Create a password (minimum 8 characters)
- Confirm your password
- Click "Sign up"

#### 2. **Check Your Email** 📧
After signing up, you'll receive an email with:
- Subject: "Your verification code"
- A 6-digit verification code (e.g., `123456`)

#### 3. **Enter Verification Code**
The page will automatically show a verification form:
- Enter the 6-digit code from your email
- Click "Verify Email"

**Didn't receive the code?**
- Click "Didn't receive the code? Resend" to get a new code
- Check your spam folder

#### 4. **Sign In** ✅
After successful verification:
- You'll be redirected to the sign-in page
- You'll see a green success message: "Email verified successfully!"
- Sign in with your email and password
- Start testing!

---

## 🛠 New Features Added

### In the Sign-Up Component:
- ✅ Two-step process: Registration → Verification
- ✅ Inline verification code input
- ✅ Resend code functionality
- ✅ Better error messages
- ✅ Password validation (min 8 characters)

### In the Auth Service:
- ✅ `confirmSignUp(username, code)` - Verify email with code
- ✅ `resendConfirmationCode(username)` - Resend verification code

### User Experience:
- ✅ Clear instructions at each step
- ✅ Visual feedback (success/error messages)
- ✅ Large input field for verification code
- ✅ Automatic redirect after verification

---

## 📝 Code Integration

### Using the Verification Functions

```typescript
import { confirmSignUp, resendConfirmationCode } from '@/services/auth';

// Verify email with code
await confirmSignUp('user@example.com', '123456');

// Resend verification code
await resendConfirmationCode('user@example.com');
```

---

## 🧪 Testing the Flow

### Quick Test:

1. **Go to**: http://localhost:3000/signup
2. **Sign up** with a test email (use a real email to receive the code)
3. **Check email** for the verification code
4. **Enter code** in the verification form
5. **Click verify** - you'll be redirected to sign-in
6. **Sign in** with your credentials
7. **Start testing** WebSocket connections!

### Alternative: Admin Verification (Development Only)

If you don't want to wait for email, use AWS CLI:

```bash
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id eu-central-1_xxxxxxx \
  --username your-email@example.com \
  --profile sandbox \
  --region eu-central-1
```

Then sign in directly without entering a code.

---

## 🐛 Troubleshooting

### "Code mismatch" error
- ✅ Check you entered the code correctly
- ✅ Code may have expired (valid for 24 hours)
- ✅ Click "Resend" to get a new code

### Email not received
- ✅ Check spam/junk folder
- ✅ Verify email address is correct
- ✅ Click "Resend" button
- ✅ Use admin-confirm-sign-up command (development only)

### "User already exists"
- ✅ User was created but not verified
- ✅ Go to sign-in page
- ✅ Try signing in (may prompt for verification)
- ✅ Or use admin-confirm-sign-up to verify manually

---

## 🎨 UI Features

### Verification Screen:
- Large, centered code input field
- Character spacing for better readability  
- Maximum 6 characters
- Green success messages
- Red error messages
- Resend code link

### Sign-In Screen:
- Success message when arriving from verification
- Clear error messages
- Link to sign-up page

---

## 🔐 Security Notes

- Verification codes expire after 24 hours
- Codes are single-use only
- Email must be verified before sign-in
- Passwords must be at least 8 characters
- Passwords are validated on client and server

---

## ✨ What Changed

**Before:**
- Sign up → Generic success message → Manual verification needed

**After:**
- Sign up → Verification screen → Enter code → Auto-redirect → Sign in ✅

---

**The verification flow is now complete and user-friendly!** 🎉

Users can sign up, verify their email, and sign in without leaving the application.
