"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PlusIcon, SendIcon } from "lucide-react"
import { useAuth } from "@/components/auth/cognito-auth"
import WebSocketPipeline from "./websocket-pipeline"

interface Pipeline {
  id: string
  name: string
  url: string
}

export default function MultiWebSocketClient() {
  const { user } = useAuth()
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [newPipelineUrl, setNewPipelineUrl] = useState("wss://echo.websocket.org/")
  const [newPipelineName, setNewPipelineName] = useState("")
  const [httpApiUrl, setHttpApiUrl] = useState("https://httpbin.org/post")
  const [messageText, setMessageText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [httpResponse, setHttpResponse] = useState("")

  const addPipeline = () => {
    if (!newPipelineUrl.trim()) return

    const pipeline: Pipeline = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: newPipelineName.trim() || `Pipeline ${pipelines.length + 1}`,
      url: newPipelineUrl.trim(),
    }

    setPipelines((prev) => [...prev, pipeline])
    setNewPipelineName("")
    setNewPipelineUrl("wss://echo.websocket.org/")
  }

  const removePipeline = (id: string) => {
    setPipelines((prev) => prev.filter((p) => p.id !== id))
  }

  const sendHttpMessage = async () => {
    if (!httpApiUrl.trim() || !messageText.trim()) return

    setIsLoading(true)
    setHttpResponse("")

    try {
      const headers: Record<string, string> = {
        "Connection": "keep-alive",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Content-Type": "application/json",
      }

      // Add Authorization header if user is authenticated
      if (user?.idToken) {
        headers.Authorization = `Bearer ${user.idToken}`
      }

      const response = await fetch(httpApiUrl, {
        method: "POST",
        headers,
        body: messageText
      })
      console.log("HTTP Response:", response)

      const responseText = await response.text();
      let formattedResponse = ""

      if (response.ok) {
        formattedResponse = `✅ Success (${response.status}): ${responseText}`
      } else {
        formattedResponse = `❌ Error (${response.status}): ${responseText}`
      }

      setHttpResponse(formattedResponse)
    } catch (error) {
      setHttpResponse(`❌ Network Error: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      sendHttpMessage()
    }
  }

  return (
    <div className="space-y-6">
      {/* HTTP API Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SendIcon className="h-5 w-5" />
            HTTP API Messenger
            {user?.accessToken && <span className="text-sm font-normal text-green-600">(Authenticated)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="http-api-url">HTTP API URL</Label>
              <Input
                id="http-api-url"
                value={httpApiUrl}
                onChange={(e) => setHttpApiUrl(e.target.value)}
                placeholder="https://httpbin.org/post"
              />
            </div>
            <div>
              <Label htmlFor="message-text">Message</Label>
              <div className="flex gap-2">
                <Input
                  id="message-text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Enter your message..."
                  onKeyDown={handleKeyPress}
                />
                <Button onClick={sendHttpMessage} disabled={isLoading || !messageText.trim() || !httpApiUrl.trim()}>
                  <SendIcon className="h-4 w-4 mr-1" />
                  {isLoading ? "Sending..." : "Send"}
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Press Ctrl+Enter to send {user?.idToken && "• Authorization header included"}
              </p>
            </div>
          </div>
          {httpResponse && (
            <div className="mt-4">
              <Label>Response</Label>
              <div className="bg-gray-100 p-3 rounded-md font-mono text-sm whitespace-pre-wrap max-h-64 overflow-auto">
                {httpResponse}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Management */}
      <Card>
        <CardHeader>
          <CardTitle>Add New WebSocket Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="pipeline-name">Pipeline Name</Label>
              <Input
                id="pipeline-name"
                value={newPipelineName}
                onChange={(e) => setNewPipelineName(e.target.value)}
                placeholder="My Pipeline"
              />
            </div>
            <div>
              <Label htmlFor="pipeline-url">WebSocket URL</Label>
              <Input
                id="pipeline-url"
                value={newPipelineUrl}
                onChange={(e) => setNewPipelineUrl(e.target.value)}
                placeholder="wss://echo.websocket.org/"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addPipeline} disabled={!newPipelineUrl.trim()} className="w-full">
                <PlusIcon className="h-4 w-4 mr-1" />
                Add Pipeline
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Pipelines */}
      <div className="space-y-4">
        {pipelines.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500">No pipelines created yet. Add a pipeline above to get started.</p>
            </CardContent>
          </Card>
        ) : (
          pipelines.map((pipeline) => (
            <WebSocketPipeline
              key={pipeline.id}
              pipeline={pipeline}
              onRemove={() => removePipeline(pipeline.id)}
              accessToken={user?.accessToken}
            />
          ))
        )}
      </div>
    </div>
  )
}