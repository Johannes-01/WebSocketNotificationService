"use client"

import { useState, useEffect, useRef } from "react"
import { Terminal } from "@/components/ui/terminal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PauseIcon, PlayIcon, WifiIcon, WifiOffIcon } from "lucide-react"

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

interface Message {
  id: string
  content: string
  timestamp: Date
  type: "system" | "data" | "error"
}

export default function WebSocketTerminal() {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<ConnectionStatus>("disconnected")
  const [isPaused, setIsPaused] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<Message[]>([])
  const [websocketUrl, setWebsocketUrl] = useState("ws://localhost:8080")
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
    if (!isValidWebSocketUrl(websocketUrl)) {
      addMessage(`[${formatTimestamp(new Date())}] ERROR: Invalid WebSocket URL: ${websocketUrl}`, "error")
      setStatus("error")
      return
    }

    if (socketRef.current?.readyState === WebSocket.CONNECTING || socketRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      setStatus("connecting")
      addMessage(`[${formatTimestamp(new Date())}] Connecting to ${websocketUrl}...`, "system")

      const socket = new WebSocket(websocketUrl)

      socket.onopen = () => {
        setStatus("connected")
        setReconnectAttempts(0)
        addMessage(`[${formatTimestamp(new Date())}] ✅ Connected to ${websocketUrl}`, "system")
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
          addMessage(`[${formatTimestamp(new Date())}] ERROR: Failed to process message: ${error}`, "error")
        }
      }

      socket.onclose = (event) => {
        setStatus("disconnected")
        const reason = event.reason || "Unknown reason"
        const code = event.code
        addMessage(`[${formatTimestamp(new Date())}] ❌ Disconnected (Code: ${code}, Reason: ${reason})`, "system")

        // Auto-reconnect logic
        if (autoReconnect && reconnectAttempts < maxReconnectAttempts && !event.wasClean) {
          const nextAttempt = reconnectAttempts + 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000) // Exponential backoff, max 30s
          setReconnectAttempts(nextAttempt)
          addMessage(
            `[${formatTimestamp(new Date())}] 🔄 Attempting to reconnect in ${delay / 1000}s... (${nextAttempt}/${maxReconnectAttempts})`,
            "system",
          )

          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        }
      }

      socket.onerror = (error) => {
        setStatus("error")
        console.error("WebSocket error:", error)
        addMessage(
          `[${formatTimestamp(new Date())}] ❌ Connection error: Failed to connect to ${websocketUrl}`,
          "error",
        )
        addMessage(
          `[${formatTimestamp(new Date())}] 💡 Make sure your WebSocket server is running and accessible`,
          "system",
        )
      }

      socketRef.current = socket
    } catch (error) {
      setStatus("error")
      addMessage(`[${formatTimestamp(new Date())}] ERROR: ${error}`, "error")
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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (terminalRef.current && !isPaused) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [messages, isPaused])

  // Cleanup on unmount
  useEffect(() => {
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

  return (
    <div className="flex flex-col space-y-4">
      {/* Connection Configuration */}
      <div className="flex flex-col space-y-2 p-4 border rounded-lg bg-white">
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <Label htmlFor="websocket-url">WebSocket URL</Label>
            <Input
              id="websocket-url"
              value={websocketUrl}
              onChange={(e) => setWebsocketUrl(e.target.value)}
              placeholder="ws://localhost:8080"
              disabled={status === "connected" || status === "connecting"}
            />
          </div>
          <div className="flex items-center space-x-2 pt-6">
            <Button
              variant={status === "connected" ? "destructive" : "default"}
              onClick={status === "connected" ? disconnect : connect}
              disabled={status === "connecting"}
            >
              {getStatusIcon()}
              {status === "connected" ? "Disconnect" : status === "connecting" ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      </div>

      {/* Status and Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Badge variant={getStatusColor()}>
            {status === "connected"
              ? "Connected"
              : status === "connecting"
                ? "Connecting..."
                : status === "error"
                  ? "Error"
                  : "Disconnected"}
          </Badge>
          {reconnectAttempts > 0 && status !== "connected" && (
            <Badge variant="outline">
              Reconnect attempt {reconnectAttempts}/{maxReconnectAttempts}
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
        </div>
      </div>

      {/* Terminal */}
      <Terminal ref={terminalRef} className="h-[500px] overflow-auto">
        {messages.length === 0 && (
          <div className="text-gray-500 italic">No messages yet. Connect to a WebSocket server to see output...</div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`terminal-line ${
              message.type === "error" ? "text-red-400" : message.type === "system" ? "text-blue-400" : "text-green-400"
            }`}
          >
            {message.content}
          </div>
        ))}
        {isPaused && queuedMessages.length > 0 && (
          <div className="text-yellow-400 mt-2 border-t border-yellow-800 pt-2">
            📦 {queuedMessages.length} new message{queuedMessages.length !== 1 ? "s" : ""} queued. Click Resume to view.
          </div>
        )}
      </Terminal>
    </div>
  )
}
