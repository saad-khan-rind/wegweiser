import { Module } from "@nestjs/common";
import { ChatModule } from "./chat/chat.module";
import { JourneyModule } from "./journey/journey.module";

@Module({ imports: [ChatModule, JourneyModule] })
export class AppModule {}
