import { Body, Controller, Post } from "@nestjs/common";
import { JourneyService } from "./journey.service";
import { sanitizeTags } from "../common/deidentify";

@Controller("api")
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Post("journey")
  build(@Body() body: { tags?: string[] }) {
    return this.journey.build(sanitizeTags(body?.tags));
  }
}
