"use client"

import type React from "react"

import { useState, useEffect, createContext, useContext, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LogInIcon, LogOutIcon, UserIcon, EyeIcon, EyeOffIcon, UserPlusIcon } from "lucide-react"

interface CognitoConfig {
  userPoolId: string
  clientId: string
  region: string
}

interface AuthUser {
  email: string
  accessToken: string
  idToken: string
  refreshToken: string
  sub: string
}

interface AuthContextType {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  confirmSignup: (email: string, confirmationCode: string) => Promise<void>
  changePassword: (email: string, oldPassword: string, newPassword: string, session: string) => Promise<void>
  logout: () => void
  isLoading: boolean
  error: string | null
  pendingChallenge: { type: string; session: string; email: string } | null
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
  config: CognitoConfig
}

export function AuthProvider({ children, config }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingChallenge, setPendingChallenge] = useState<{ type: string; session: string; email: string } | null>(
    null,
  )

  // Check for existing session on mount
  useEffect(() => {
    const savedUser = localStorage.getItem("cognito-user")
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser)
        // Check if tokens are still valid (basic check)
        if ((parsedUser.accessToken && isTokenValid(parsedUser.accessToken) && parsedUser.idToken && isTokenValid(parsedUser.idToken))) {
          setUser(parsedUser)
        } else {
          // Attempt to refresh token
          const refreshToken = parsedUser.refreshToken;
          if (refreshToken && isTokenValid(refreshToken)) {
            /*refreshCognitoToken(refreshToken, config)
              .then((refreshedUser) => {
                const parsedUser = JSON.parse(localStorage.getItem("cognito-user") || "")
                const updatedUser = {
                  email: parsedUser.email,
                  sub: parsedUser.sub,
                  accessToken: refreshedUser.AuthenticationResult.AccessToken,
                  idToken: refreshedUser.AuthenticationResult.IdToken,
                  refreshToken: refreshedUser.AuthenticationResult.RefreshToken,
                }
                setUser(updatedUser)
                localStorage.setItem("cognito-user", JSON.stringify(updatedUser))
              })
              .catch((err) => {
                console.error("Failed to refresh token:", err)
                localStorage.removeItem("cognito-user")
              })*/
             localStorage.removeItem("cognito-user")
          }
          else {
            localStorage.removeItem("cognito-user")
          }
        }
      } catch (error) {
        console.error("Error parsing saved user:", error)
        localStorage.removeItem("cognito-user")
      }
    }
  }, [])

  const isTokenValid = (token: string): boolean => {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]))
      const currentTime = Math.floor(Date.now() / 1000)
      return payload.exp > currentTime
    } catch {
      return false
    }
  }

  const clearError = () => setError(null)

  const login = async (email: string, password: string) => {
    setIsLoading(true)
    setError(null)
    setPendingChallenge(null)

    try {
      const authResponse = await authenticateWithCognito(email, password, config)

      if (authResponse.ChallengeName === "NEW_PASSWORD_REQUIRED") {
        setPendingChallenge({
          type: "NEW_PASSWORD_REQUIRED",
          session: authResponse.Session,
          email,
        })
        setError("Password change required. Please set a new password.")
        return
      }

      if (!authResponse.AuthenticationResult) {
        throw new Error("No authentication result received")
      }

      const authUser: AuthUser = {
        email,
        accessToken: authResponse.AuthenticationResult.AccessToken,
        idToken: authResponse.AuthenticationResult.IdToken,
        refreshToken: authResponse.AuthenticationResult.RefreshToken,
        sub: authResponse.sub,
      }

      setUser(authUser)
      localStorage.setItem("cognito-user", JSON.stringify(authUser))
    } catch (error: any) {
      setError(error.message || "Authentication failed")
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const signup = async (email: string, password: string) => {
    setIsLoading(true)
    setError(null)

    try {
      await signupWithCognito(email, password, config)
      // Signup successful, user needs to confirm their email
    } catch (error: any) {
      setError(error.message || "Signup failed")
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const confirmSignup = async (email: string, confirmationCode: string) => {
    setIsLoading(true)
    setError(null)

    try {
      await confirmSignupWithCognito(email, confirmationCode, config)
    } catch (error: any) {
      setError(error.message || "Confirmation failed")
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const changePassword = async (email: string, oldPassword: string, newPassword: string, session: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const authResponse = await respondToNewPasswordChallenge(email, oldPassword, newPassword, session, config)

      const authUser: AuthUser = {
        email,
        accessToken: authResponse.AuthenticationResult.AccessToken,
        idToken: authResponse.AuthenticationResult.IdToken,
        refreshToken: authResponse.AuthenticationResult.RefreshToken,
        sub: authResponse.sub,
      }

      setUser(authUser)
      localStorage.setItem("cognito-user", JSON.stringify(authUser))
      setPendingChallenge(null)
    } catch (error: any) {
      setError(error.message || "Password change failed")
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem("cognito-user")
    setError(null)
    setPendingChallenge(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        signup,
        confirmSignup,
        changePassword,
        logout,
        isLoading,
        error,
        pendingChallenge,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

async function refreshCognitoToken(refreshToken: string, config: CognitoConfig) {
  const { userPoolId, clientId, region } = config

  const refreshRequest = {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: clientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  }

  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify(refreshRequest),
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || `Token refresh failed: ${data.__type}`)
    }
    if (!data.AuthenticationResult) {
      throw new Error("No authentication result received during token refresh")
    }

    return {
      AuthenticationResult: {
        AccessToken: data.AuthenticationResult.AccessToken,
        IdToken: data.AuthenticationResult.IdToken,
        RefreshToken: data.AuthenticationResult.RefreshToken,
      },
    }
  } catch (error: any) {
    if (error.message) {
      throw error
    }
    throw new Error("Network error: Unable to connect to token refresh service")
  }
}

// AWS Cognito authentication function
async function authenticateWithCognito(email: string, password: string, config: CognitoConfig) {
  const { userPoolId, clientId, region } = config

  const authRequest = {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: clientId,
    AuthParameters: {
      USERNAME: email, // Use email as username since signInAliases.email is true
      PASSWORD: password,
    },
  }

  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify(authRequest),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Authentication failed: ${data.__type}`)
    }

    // Handle challenges
    if (data.ChallengeName) {
      return {
        ChallengeName: data.ChallengeName,
        Session: data.Session,
        ChallengeParameters: data.ChallengeParameters,
      }
    }

    if (!data.AuthenticationResult) {
      throw new Error("No authentication result received")
    }

    // Parse ID token to get user info
    const idTokenPayload = JSON.parse(atob(data.AuthenticationResult.IdToken.split(".")[1]))

    return {
      AuthenticationResult: {
        AccessToken: data.AuthenticationResult.AccessToken,
        IdToken: data.AuthenticationResult.IdToken,
        RefreshToken: data.AuthenticationResult.RefreshToken,
      },
      sub: idTokenPayload.sub,
    }
  } catch (error: any) {
    if (error.message) {
      throw error
    }
    throw new Error("Network error: Unable to connect to authentication service")
  }
}

// AWS Cognito signup function
async function signupWithCognito(email: string, password: string, config: CognitoConfig) {
  const { clientId, region } = config

  const signupRequest = {
    ClientId: clientId,
    Username: email, // Use email as username
    Password: password,
    UserAttributes: [
      {
        Name: "email",
        Value: email,
      },
    ],
  }

  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.SignUp",
      },
      body: JSON.stringify(signupRequest),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Signup failed: ${data.__type}`)
    }

    return data
  } catch (error: any) {
    if (error.message) {
      throw error
    }
    throw new Error("Network error: Unable to connect to signup service")
  }
}

// AWS Cognito confirm signup function
async function confirmSignupWithCognito(email: string, confirmationCode: string, config: CognitoConfig) {
  const { clientId, region } = config

  const confirmRequest = {
    ClientId: clientId,
    Username: email, // Use email as username
    ConfirmationCode: confirmationCode,
  }

  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.ConfirmSignUp",
      },
      body: JSON.stringify(confirmRequest),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Confirmation failed: ${data.__type}`)
    }

    return data
  } catch (error: any) {
    if (error.message) {
      throw error
    }
    throw new Error("Network error: Unable to connect to confirmation service")
  }
}

// Handle NEW_PASSWORD_REQUIRED challenge
async function respondToNewPasswordChallenge(
  email: string,
  oldPassword: string,
  newPassword: string,
  session: string,
  config: CognitoConfig,
) {
  const { clientId, region } = config

  const challengeRequest = {
    ClientId: clientId,
    ChallengeName: "NEW_PASSWORD_REQUIRED",
    Session: session,
    ChallengeResponses: {
      USERNAME: email, // Use email as username
      PASSWORD: oldPassword,
      NEW_PASSWORD: newPassword,
    },
  }

  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.RespondToAuthChallenge",
      },
      body: JSON.stringify(challengeRequest),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Password change failed: ${data.__type}`)
    }

    if (!data.AuthenticationResult) {
      throw new Error("No authentication result received after password change")
    }

    // Parse ID token to get user info
    const idTokenPayload = JSON.parse(atob(data.AuthenticationResult.IdToken.split(".")[1]))

    return {
      AuthenticationResult: {
        AccessToken: data.AuthenticationResult.AccessToken,
        IdToken: data.AuthenticationResult.IdToken,
        RefreshToken: data.AuthenticationResult.RefreshToken,
      },
      sub: idTokenPayload.sub,
    }
  } catch (error: any) {
    if (error.message) {
      throw error
    }
    throw new Error("Network error: Unable to connect to password change service")
  }
}

interface AuthFormProps {
  onSuccess?: () => void
}

export function AuthForm({ onSuccess }: AuthFormProps) {
  const { login, signup, confirmSignup, changePassword, isLoading, error, pendingChallenge, clearError } = useAuth()
  const [activeTab, setActiveTab] = useState("login")
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)

  // Login form state
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")

  // Signup form state
  const [signupEmail, setSignupEmail] = useState("")
  const [signupPassword, setSignupPassword] = useState("")
  const [confirmationCode, setConfirmationCode] = useState("")
  const [signupStep, setSignupStep] = useState<"signup" | "confirm">("signup")

  // Password change form state
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginEmail.trim() || !loginPassword.trim()) return

    try {
      await login(loginEmail.trim(), loginPassword)
      if (!pendingChallenge) {
        onSuccess?.()
      }
    } catch (error) {
      // Error is handled by the auth context
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signupEmail.trim() || !signupPassword.trim()) return

    try {
      await signup(signupEmail.trim(), signupPassword)
      setSignupStep("confirm")
      clearError()
    } catch (error) {
      // Error is handled by the auth context
    }
  }

  const handleConfirmSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!confirmationCode.trim()) return

    try {
      await confirmSignup(signupEmail, confirmationCode.trim())
      setActiveTab("login")
      setSignupStep("signup")
      setSignupEmail("")
      setSignupPassword("")
      setConfirmationCode("")
      clearError()
    } catch (error) {
      // Error is handled by the auth context
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPassword.trim() || !confirmNewPassword.trim() || !pendingChallenge) return

    if (newPassword !== confirmNewPassword) {
      return // This should be handled by form validation
    }

    try {
      await changePassword(pendingChallenge.email, loginPassword, newPassword, pendingChallenge.session)
      onSuccess?.()
    } catch (error) {
      // Error is handled by the auth context
    }
  }

  // Show password change form if challenge is pending
  if (pendingChallenge?.type === "NEW_PASSWORD_REQUIRED") {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            Set New Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
              Your account requires a new password. Please set a new password to continue.
            </div>
            <div>
              <Label htmlFor="current-email">Email</Label>
              <div className="font-mono text-sm bg-gray-100 p-2 rounded">{pendingChallenge.email}</div>
            </div>
            <div>
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  disabled={isLoading}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  disabled={isLoading}
                >
                  {showNewPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm your new password"
                disabled={isLoading}
                required
              />
            </div>
            {newPassword && confirmNewPassword && newPassword !== confirmNewPassword && (
              <div className="text-red-600 text-sm">Passwords do not match</div>
            )}
            {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">❌ {error}</div>}
            <Button
              type="submit"
              className="w-full"
              disabled={
                isLoading || !newPassword.trim() || !confirmNewPassword.trim() || newPassword !== confirmNewPassword
              }
            >
              {isLoading ? "Setting Password..." : "Set New Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LogInIcon className="h-5 w-5" />
          AWS Cognito Authentication
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Enter your email address"
                  disabled={isLoading}
                  required
                />
              </div>
              <div>
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={isLoading}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                  >
                    {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">❌ {error}</div>}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !loginEmail.trim() || !loginPassword.trim()}
              >
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="space-y-4">
            {signupStep === "signup" ? (
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="Enter your email address"
                    disabled={isLoading}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Choose a password"
                    disabled={isLoading}
                    required
                  />
                </div>
                {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">❌ {error}</div>}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || !signupEmail.trim() || !signupPassword.trim()}
                >
                  <UserPlusIcon className="h-4 w-4 mr-1" />
                  {isLoading ? "Creating Account..." : "Create Account"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleConfirmSignup} className="space-y-4">
                <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
                  We've sent a confirmation code to <strong>{signupEmail}</strong>. Please enter it below to verify your
                  account.
                </div>
                <div>
                  <Label htmlFor="confirmation-code">Confirmation Code</Label>
                  <Input
                    id="confirmation-code"
                    type="text"
                    value={confirmationCode}
                    onChange={(e) => setConfirmationCode(e.target.value)}
                    placeholder="Enter confirmation code"
                    disabled={isLoading}
                    required
                  />
                </div>
                {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">❌ {error}</div>}
                <Button type="submit" className="w-full" disabled={isLoading || !confirmationCode.trim()}>
                  {isLoading ? "Confirming..." : "Confirm Account"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setSignupStep("signup")}
                  disabled={isLoading}
                >
                  Back to Sign Up
                </Button>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export function UserProfile() {
  const { user, logout } = useAuth()

  if (!user) return null

  const accessTokenPayload = JSON.parse(atob(user.accessToken.split(".")[1]))
  const accessTokenExpiry = new Date(accessTokenPayload.exp * 1000)
  const accessTokenIsExpiringSoon = accessTokenExpiry.getTime() - Date.now() < 5 * 60 * 1000 // 5 minutes

  const idTokenPayload = JSON.parse(atob(user.idToken.split(".")[1]))
  const idTokenExpiry = new Date(idTokenPayload.exp * 1000)
  const idTokenIsExpiringSoon = accessTokenExpiry.getTime() - Date.now() < 5 * 60 * 1000 // 5 minutes

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            User Profile
          </div>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOutIcon className="h-4 w-4 mr-1" />
            Logout
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Email</Label>
            <div className="font-mono text-sm bg-gray-100 p-2 rounded">{user.email}</div>
          </div>
          <div>
            <Label>User ID (Sub)</Label>
            <div className="font-mono text-sm bg-gray-100 p-2 rounded truncate">{user.sub}</div>
          </div>
          <div className="md:col-span-2">
            <Label>Access Token Status</Label>
            <div className="flex items-center gap-2">
              <Badge variant={accessTokenIsExpiringSoon ? "warning" : "success"}>
                {accessTokenIsExpiringSoon ? "Expiring Soon" : "Valid"}
              </Badge>
              <span className="text-xs text-gray-500">Expires: {accessTokenExpiry.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div>
          <Label>Access Token</Label>
          <div className="font-mono text-xs bg-gray-100 p-3 rounded max-h-32 overflow-auto break-all">
            {user.accessToken}
          </div>
        </div>
        <div className="md:col-span-2">
          <Label>ID Token Status</Label>
          <div className="flex items-center gap-2">
            <Badge variant={idTokenIsExpiringSoon ? "warning" : "success"}>
              {idTokenIsExpiringSoon ? "Expiring Soon" : "Valid"}
            </Badge>
            <span className="text-xs text-gray-500">Expires: {idTokenExpiry.toLocaleString()}</span>
          </div>
        </div>
        <div>
          <Label>ID Token</Label>
          <div className="font-mono text-xs bg-gray-100 p-3 rounded max-h-32 overflow-auto break-all">
            {user.idToken}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
