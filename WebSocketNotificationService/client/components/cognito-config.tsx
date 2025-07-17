"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsIcon } from "lucide-react"

interface CognitoConfig {
  userPoolId: string
  clientId: string
  region: string
}

interface CognitoConfigProps {
  config: CognitoConfig
  onConfigChange: (config: CognitoConfig) => void
}

export function CognitoConfig({ config, onConfigChange }: CognitoConfigProps) {
  const [localConfig, setLocalConfig] = useState(config)
  const [isEditing, setIsEditing] = useState(false)

  const handleSave = () => {
    onConfigChange(localConfig)
    setIsEditing(false)
    // Save to localStorage for persistence
    localStorage.setItem("cognito-config", JSON.stringify(localConfig))
  }

  const handleCancel = () => {
    setLocalConfig(config)
    setIsEditing(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            AWS Cognito Configuration
          </div>
          {!isEditing && (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
            <div>
              <Label htmlFor="user-pool-id">User Pool ID</Label>
              <Input
                id="user-pool-id"
                value={localConfig.userPoolId}
                onChange={(e) => setLocalConfig({ ...localConfig, userPoolId: e.target.value })}
                placeholder="eu-central-1_xxxxxxxxx"
              />
            </div>
            <div>
              <Label htmlFor="client-id">Client ID</Label>
              <Input
                id="client-id"
                value={localConfig.clientId}
                onChange={(e) => setLocalConfig({ ...localConfig, clientId: e.target.value })}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <Label htmlFor="region">AWS Region</Label>
              <Input
                id="region"
                value={localConfig.region}
                onChange={(e) => setLocalConfig({ ...localConfig, region: e.target.value })}
                placeholder="eu-central-1"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={!localConfig.userPoolId || !localConfig.clientId || !localConfig.region}
              >
                Save Configuration
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>User Pool ID</Label>
              <div className="font-mono text-sm bg-gray-100 p-2 rounded">{config.userPoolId || "Not configured"}</div>
            </div>
            <div>
              <Label>Client ID</Label>
              <div className="font-mono text-sm bg-gray-100 p-2 rounded">{config.clientId || "Not configured"}</div>
            </div>
            <div>
              <Label>Region</Label>
              <div className="font-mono text-sm bg-gray-100 p-2 rounded">{config.region || "Not configured"}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
