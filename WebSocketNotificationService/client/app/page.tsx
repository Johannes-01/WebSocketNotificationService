"use client"

import { useState, useEffect } from "react"
import { AuthProvider, useAuth, AuthForm, UserProfile } from "@/components/auth/cognito-auth"
import { CognitoConfig } from "@/components/cognito-config"
import MultiWebSocketClient from "@/components/multi-websocket-client"

interface CognitoConfigType {
  userPoolId: string
  clientId: string
  region: string
}

function AppContent() {
  const { user } = useAuth()

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-100">
        <div className="w-full max-w-md">
          <AuthForm />
        </div>
      </div>
    )
  }

  return (
    <main className="flex min-h-screen flex-col p-4 md:p-8 bg-gray-100">
      <div className="w-full max-w-7xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">WebSocket Pipeline Manager</h1>

        <UserProfile />

        <MultiWebSocketClient />
      </div>
    </main>
  )
}

export default function Home() {
  const [cognitoConfig, setCognitoConfig] = useState<CognitoConfigType>({
    userPoolId: "",
    clientId: "",
    region: "eu-central-1",
  })
  const [configLoaded, setConfigLoaded] = useState(false)

  // Load config from localStorage on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem("cognito-config")
    if (savedConfig) {
      try {
        setCognitoConfig(JSON.parse(savedConfig))
      } catch (error) {
        console.error("Error parsing saved config:", error)
      }
    }
    setConfigLoaded(true)
  }, [])

  // Show config form if not configured
  if (!configLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-gray-100">
        <div className="text-center">Loading...</div>
      </div>
    )
  }

  if (!cognitoConfig.userPoolId || !cognitoConfig.clientId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-100">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-bold mb-2">WebSocket Pipeline Manager</h1>
            <p className="text-gray-600">Configure your AWS Cognito settings to get started</p>
          </div>
          <CognitoConfig config={cognitoConfig} onConfigChange={setCognitoConfig} />
        </div>
      </div>
    )
  }

  return (
    <AuthProvider config={cognitoConfig}>
      <AppContent />
    </AuthProvider>
  )
}