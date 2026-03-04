// ai.js
import { saveMessage } from './data.js'

export const AI_USER_ID = "00000000-0000-0000-0000-000000000001"

const assistants = {
  general: {
    name: "General Assistant",
    reply: async (text) => {
      return `🧠 AI: Вы сказали "${text}". Я помогу вам.`
    }
  },
  coder: {
    name: "Code Assistant",
    reply: async (text) => {
      return `💻 Code AI: Вот идея для "${text}" — попробуйте разделить на модули.`
    }
  },
  analyst: {
    name: "Analyst",
    reply: async (text) => {
      return `📊 Analyst AI: Давайте разберём это логически: ${text}`
    }
  }
}

export async function handleAIMessage(io, senderId, content, assistantType = "general") {
  const assistant = assistants[assistantType]
  if (!assistant) return

  const reply = await assistant.reply(content)

  await saveMessage(AI_USER_ID, senderId, reply)

  io.to(`user:${senderId}`).emit('message', {
    senderId: AI_USER_ID,
    content: reply
  })
}

export function listAssistants() {
  return Object.keys(assistants)
}