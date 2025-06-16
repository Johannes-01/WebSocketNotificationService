import WebSocketTerminal from "@/components/websocket-terminal"
import MultiWebSocketClient from "../components/multi-websocket-client"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24 bg-gray-100">
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">WebSocket Output</h1>
        <MultiWebSocketClient />
      </div>
    </main>
  )
}
