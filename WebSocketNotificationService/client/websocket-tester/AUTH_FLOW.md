# Authentication Flow - Complete Guide

## ✅ Complete Authentication & Navigation Flow

The authentication flow now includes proper redirects and navigation throughout the application.

---

## 🔄 **Flow Diagram**

```
[Sign Up] → [Verify Email] → [Sign In] → [Home/Dashboard] → [Sign Out] → [Sign In]
                                  ↓
                          (if not authenticated)
                                  ↓
                    [Protected Route] → [Sign In with redirect]
```

---

## 📍 **Navigation Paths**

### 1. **Sign Up Flow** (`/signup`)
- User enters email and password
- Clicks "Sign up"
- → **Verification screen appears** (same page)
- User enters 6-digit code from email
- Clicks "Verify Email"
- → **Redirected to `/signin?verified=true`**
- Success message displayed
- User signs in
- → **Redirected to `/` (home page)**

### 2. **Sign In Flow** (`/signin`)
- User enters credentials
- Clicks "Sign in"
- → **Redirected to home page `/`**
- If came from a protected route:
  - → **Redirected to original destination** (e.g., `/signin?redirect=/dashboard` → `/dashboard`)

### 3. **Sign Out Flow**
- User clicks "Sign Out" button in header
- WebSocket disconnects (if connected)
- Auth state cleared
- → **Redirected to `/signin`**

### 4. **Protected Routes**
- Unauthenticated user tries to access home page
- → **Redirected to `/signin?redirect=/`**
- After sign in → **Back to intended page**

---

## 🎯 **Key Components**

### 1. **SignIn Component** (`src/components/auth/SignIn.tsx`)

**Features:**
- ✅ Email verification success message
- ✅ Auto-redirect to home page after sign-in
- ✅ Supports redirect parameter for deep linking
- ✅ Error handling with visual feedback

**Code:**
```tsx
async function handleSubmit(e: React.FormEvent) {
  await signIn(email, password);
  const redirectTo = searchParams.get('redirect') || '/';
  router.push(redirectTo); // ← Redirect after sign-in
}
```

### 2. **SignUp Component** (`src/components/auth/SignUp.tsx`)

**Features:**
- ✅ Two-step process (register → verify)
- ✅ Inline verification form
- ✅ Auto-redirect to sign-in after verification
- ✅ Resend code functionality

**Code:**
```tsx
async function handleVerification(e: React.FormEvent) {
  await confirmSignUp(email, verificationCode);
  router.push('/signin?verified=true'); // ← Redirect after verification
}
```

### 3. **WebSocketTester Component** (`src/components/WebSocketTester.tsx`)

**Features:**
- ✅ Sign-out button in header
- ✅ Disconnects WebSocket before sign-out
- ✅ Redirects to sign-in page

**Code:**
```tsx
const handleSignOut = async () => {
  if (ws) ws.close(); // Disconnect WebSocket
  await signOut();
  router.push('/signin'); // ← Redirect after sign-out
};
```

### 4. **Home Page** (`src/app/page.tsx`)

**Features:**
- ✅ Shows sign-in prompt if not authenticated
- ✅ Shows WebSocket tester if authenticated
- ✅ Automatic state management

**Code:**
```tsx
if (!user) {
  return <div>Please sign in...</div>;
}
return <WebSocketTester />;
```

---

## 🛡️ **Middleware Protection**

The middleware (`src/middleware.ts`) handles:
- Checking authentication status
- Redirecting unauthenticated users to `/signin`
- Preventing authenticated users from accessing auth pages
- Preserving intended destination with redirect parameter

---

## 🔐 **Authentication State**

### Managed by `AuthContext`:
- `user` - Current Cognito user
- `tokens` - Access, ID, and refresh tokens
- `isAuthenticated` - Boolean state
- `isLoading` - Loading state during auth operations

### Methods:
- `signIn(email, password)` - Authenticate user
- `signUp(email, password)` - Register new user
- `signOut()` - Clear session
- `getIdToken()` - Get current ID token

---

## 🧪 **Testing the Flow**

### Test Case 1: New User Registration
1. Go to `/signup`
2. Enter email and password
3. Verify you see verification form
4. Enter code from email
5. ✅ Should redirect to `/signin?verified=true`
6. ✅ Should see green success message
7. Sign in
8. ✅ Should redirect to `/` (home page)
9. ✅ Should see WebSocket tester

### Test Case 2: Sign Out and Sign In
1. While signed in, click "Sign Out"
2. ✅ Should redirect to `/signin`
3. Sign in again
4. ✅ Should redirect to `/` (home page)

### Test Case 3: Deep Link Protection
1. Sign out
2. Manually navigate to `/` 
3. ✅ Should redirect to `/signin?redirect=/`
4. Sign in
5. ✅ Should redirect back to `/`

---

## 🎨 **UI/UX Improvements**

### Sign In Page:
- Green success banner after email verification
- Red error messages with background
- Loading states on buttons
- Link to sign-up page

### Sign Up Page:
- Large verification code input
- Resend code button
- Clear error/success messages
- Link to sign-in page

### Dashboard Header:
- User email display
- Prominent sign-out button
- Clean layout

---

## 🔄 **Redirect Parameters**

### Usage:
```
/signin?redirect=/dashboard  → After sign-in, go to /dashboard
/signin?verified=true        → Show verification success message
```

### Implementation:
```tsx
const redirectTo = searchParams.get('redirect') || '/';
router.push(redirectTo);
```

---

## ✨ **What Changed**

### Before:
- ❌ Sign-in didn't redirect anywhere
- ❌ No sign-out button in dashboard
- ❌ Manual navigation needed after sign-in

### After:
- ✅ Auto-redirect to home after sign-in
- ✅ Sign-out button in header
- ✅ Clean navigation flow
- ✅ Proper redirect parameter support
- ✅ WebSocket cleanup on sign-out

---

## 📝 **Summary**

The authentication flow is now complete with:

1. **Sign Up** → Verify → **Redirect to Sign In**
2. **Sign In** → **Redirect to Home**
3. **Sign Out** → **Redirect to Sign In**
4. **Protected Routes** → **Redirect to Sign In** (with return URL)

All redirects are automatic and user-friendly! 🎉
