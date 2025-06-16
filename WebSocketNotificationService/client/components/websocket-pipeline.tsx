"use client"

import { useState, useEffect, useRef } from "react"
import { Terminal } from "@/components/ui/terminal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PauseIcon, PlayIcon, WifiIcon, WifiOffIcon, XIcon } from "lucide-react"

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

interface Message {
  id: string
  content: string
  timestamp: Date
  type: "system" | "data" | "error" | "success" | "warning"
}

interface Pipeline {
  id: string
  name: string
  url: string
}

interface WebSocketPipelineProps {
  pipeline: Pipeline
  onRemove: () => void
}

export default function WebSocketPipeline({ pipeline, onRemove }: WebSocketPipelineProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<ConnectionStatus>("disconnected")
  const [isPaused, setIsPaused] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<Message[]>([])
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const maxReconnectAttempts = 5

  const socketRef = useRef<WebSocket | null>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const addMessage = (content: string, type: Message["type"] = "data") => {
    const message: Message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      content,
      timestamp: new Date(),
      type,
    }

    if (isPaused && type === "data") {
      setQueuedMessages((prev) => [...prev, message])
    } else {
      setMessages((prev) => [...prev, message])
    }
  }

  const formatTimestamp = (date: Date) => {
    return date.toISOString().replace("T", " ").substr(0, 19)
  }

  const isValidWebSocketUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === "ws:" || parsed.protocol === "wss:"
    } catch {
      return false
    }
  }

  const connect = () => {
    if (!isValidWebSocketUrl(pipeline.url)) {
      addMessage(`[${formatTimestamp(new Date())}] ❌ Invalid WebSocket URL: ${pipeline.url}`, "error")
      addMessage(`[${formatTimestamp(new Date())}] 💡 URL should start with ws:// or wss://`, "system")
      setStatus("error")
      return
    }

    if (socketRef.current?.readyState === WebSocket.CONNECTING || socketRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      setStatus("connecting")
      addMessage(`[${formatTimestamp(new Date())}] 🔌 Connecting to ${pipeline.url}...`, "system")

      const socket = new WebSocket(pipeline.url)

      socket.onopen = () => {
        setStatus("connected")
        setReconnectAttempts(0)
        addMessage(`[${formatTimestamp(new Date())}] ✅ Connected to ${pipeline.url}`, "success")
      }

      socket.onmessage = (event) => {
        try {
          const timestamp = formatTimestamp(new Date())
          let message = event.data

          // Try to parse JSON for better formatting
          try {
            const parsed = JSON.parse(message)
            message = `[${timestamp}] ${JSON.stringify(parsed, null, 2)}`
          } catch {
            message = `[${timestamp}] ${message}`
          }

          addMessage(message, "data")
        } catch (error) {
          addMessage(`[${formatTimestamp(new Date())}] ❌ Failed to process message: ${error}`, "error")
        }
      }

      socket.onclose = (event) => {
        setStatus("disconnected")
        const reason = event.reason || "Connection closed"
        const code = event.code
        addMessage(`[${formatTimestamp(new Date())}] ❌ Disconnected (Code: ${code}, Reason: ${reason})`, "error")

        // Auto-reconnect logic
        if (autoReconnect && reconnectAttempts < maxReconnectAttempts && !event.wasClean) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
          setReconnectAttempts((prev) => prev + 1)
          addMessage(
            `[${formatTimestamp(new Date())}] 🔄 Reconnecting in ${delay / 1000}s... (${reconnectAttempts + 1}/${maxReconnectAttempts})`,
            "warning",
          )

          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        }
      }

      socket.onerror = (error) => {
        setStatus("error")
        console.error("WebSocket error details:", error)
        addMessage(`[${formatTimestamp(new Date())}] ❌ Connection failed to ${pipeline.url}`, "error")
        addMessage(`[${formatTimestamp(new Date())}] 💡 Make sure your WebSocket server is running`, "system")
      }

      socketRef.current = socket
    } catch (error) {
      setStatus("error")
      addMessage(`[${formatTimestamp(new Date())}] ❌ Connection error: ${error}`, "error")
      console.error("Failed to create WebSocket:", error)
    }
  }

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (socketRef.current) {
      socketRef.current.close(1000, "Manual disconnect")
      socketRef.current = null
    }
    setReconnectAttempts(0)
    setStatus("disconnected")
  }

  const togglePause = () => {
    if (isPaused && queuedMessages.length > 0) {
      setMessages((prev) => [...prev, ...queuedMessages])
      setQueuedMessages([])
    }
    setIsPaused(!isPaused)
  }

  const clearMessages = () => {
    setMessages([])
    setQueuedMessages([])
  }

  const handleRemove = () => {
    disconnect()
    onRemove()
  }

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (terminalRef.current && !isPaused) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [messages, isPaused])

  // Auto-connect on mount
  useEffect(() => {
    connect()

    // Cleanup on unmount
    return () => {
      disconnect()
    }
  }, [])

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "success"
      case "connecting":
        return "warning"
      case "error":
        return "destructive"
      default:
        return "secondary"
    }
  }

  const getStatusIcon = () => {
    return status === "connected" ? <WifiIcon className="h-3 w-3" /> : <WifiOffIcon className="h-3 w-3" />
  }

  const getMessageColor = (type: Message["type"]) => {
    switch (type) {
      case "error":
        return "text-red-400"
      case "success":
        return "text-green-400"
      case "warning":
        return "text-yellow-400"
      case "system":
        return "text-blue-400"
      default:
        return "text-green-400"
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{pipeline.name}</CardTitle>
          <Button variant="ghost" size="sm" onClick={handleRemove} className="text-red-500 hover:text-red-700">
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Badge variant={getStatusColor()}>
              {getStatusIcon()}
              <span className="ml-1">
                {status === "connected"
                  ? "Connected"
                  : status === "connecting"
                    ? "Connecting..."
                    : status === "error"
                      ? "Error"
                      : "Disconnected"}
              </span>
            </Badge>
            <span className="text-sm text-gray-500">{pipeline.url}</span>
            {reconnectAttempts > 0 && status !== "connected" && (
              <Badge variant="outline">
                Reconnect {reconnectAttempts}/{maxReconnectAttempts}
              </Badge>
            )}
            {isPaused && (
              <Badge variant="outline" className="bg-yellow-100">
                Paused ({queuedMessages.length} queued)
              </Badge>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <Button size="sm" variant="outline" onClick={togglePause}>
              {isPaused ? <PlayIcon className="h-4 w-4 mr-1" /> : <PauseIcon className="h-4 w-4 mr-1" />}
              {isPaused ? "Resume" : "Pause"}
            </Button>
            <Button size="sm" variant="outline" onClick={clearMessages}>
              Clear
            </Button>
            <Button
              size="sm"
              variant={status === "connected" ? "destructive" : "default"}
              onClick={status === "connected" ? disconnect : connect}
              disabled={status === "connecting"}
            >
              {status === "connected" ? "Disconnect" : "Connect"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Terminal ref={terminalRef} className="h-[400px] overflow-auto">
          {messages.length === 0 && (
            <div className="text-gray-500 italic">Waiting for messages from {pipeline.url}...</div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`terminal-line ${getMessageColor(message.type)}`}>
              {message.content}
            </div>
          ))}
          {isPaused && queuedMessages.length > 0 && (
            <div className="text-yellow-400 mt-2 border-t border-yellow-800 pt-2">
              📦 {queuedMessages.length} new message{queuedMessages.length !== 1 ? "s" : ""} queued. Click Resume to
              view.
            </div>
          )}
        </Terminal>
      </CardContent>
    </Card>
  )
}