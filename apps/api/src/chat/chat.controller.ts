import { Body, Controller, Get, Post } from "@nestjs/common";
import { ChatService, ChatRequest } from "./chat.service";

@Controller("api")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("health")
  health() {
    return { ok: true, service: "wegweiser-api" };
  }

  @Post("chat")
  async ask(@Body() body: ChatRequest) {
    return this.chat.chat(body ?? { query: "" });
  }
}
