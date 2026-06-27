import { Module } from "@nestjs/common";
import { ChatModule } from "./chat/chat.module";
import { JourneyModule } from "./journey/journey.module";
import { AdminModule } from "./admin/admin.module";

@Module({ imports: [ChatModule, JourneyModule, AdminModule] })
export class AppModule {}
