import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AiConfigService } from "../llm/ai-config.service";

@Module({ controllers: [AdminController], providers: [AdminService, AiConfigService] })
export class AdminModule {}
