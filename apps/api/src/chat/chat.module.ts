import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { LlmService } from "../llm/llm.service";
import { AiConfigService } from "../llm/ai-config.service";

@Module({
  controllers: [ChatController],
  providers: [ChatService, KnowledgeService, LlmService, AiConfigService],
})
export class ChatModule {}
