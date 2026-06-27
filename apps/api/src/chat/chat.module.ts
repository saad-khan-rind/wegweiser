import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { LlmService } from "../llm/llm.service";

@Module({
  controllers: [ChatController],
  providers: [ChatService, KnowledgeService, LlmService],
})
export class ChatModule {}
