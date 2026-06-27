import { Body, Controller, Get, Post } from "@nestjs/common";
import { ChatService, ChatRequest } from "./chat.service";

@Controller("api")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("health")
  async health() {
    const ai = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    let aiHealth: any = { configured: Boolean(ai) };
    if (ai) {
      try {
        const res = await fetch(`${ai}/health`, { signal: AbortSignal.timeout(4000) });
        aiHealth = { configured: true, ...(await res.json()) };
      } catch (e) {
        aiHealth = { configured: true, reachable: false, error: (e as Error).message };
      }
    }
    return { ok: true, service: "wegweiser-api", ai: aiHealth };
  }

  @Post("chat")
  async ask(@Body() body: ChatRequest) {
    return this.chat.chat(body ?? { query: "" });
  }
}
