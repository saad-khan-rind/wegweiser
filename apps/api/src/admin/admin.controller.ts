import {
  Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Controller("api/admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("documents")
  documents() {
    return this.admin.documents();
  }

  @Post("ingest")
  ingest(@Body() body: { title: string; text: string; source?: string; url?: string; date?: string }) {
    return this.admin.ingestText(body);
  }

  @Post("ingest-file")
  @UseInterceptors(FileInterceptor("file"))
  ingestFile(
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Body() meta: { title?: string; source?: string; url?: string; date?: string },
  ) {
    return this.admin.ingestFile(file, meta);
  }

  @Post("refresh")
  refresh(@Body() body: { region?: string; lang?: string }) {
    return this.admin.refresh(body);
  }
}
