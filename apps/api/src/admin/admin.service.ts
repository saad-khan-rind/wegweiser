import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { AiConfigService } from "../llm/ai-config.service";

function aiUrl(): string {
  const ai = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
  if (!ai) throw new ServiceUnavailableException("AI_SERVICE_URL not configured");
  return ai;
}

@Injectable()
export class AdminService {
  private readonly log = new Logger("AdminService");

  constructor(private readonly aiConfig: AiConfigService) {}

  async ingestText(body: { title: string; text: string; source?: string; url?: string; date?: string }) {
    const res = await fetch(`${aiUrl()}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ServiceUnavailableException(`ingest failed (${res.status})`);
    return res.json();
  }

  async ingestFile(file: { buffer: Buffer; originalname: string }, meta: { title?: string; source?: string; url?: string; date?: string }) {
    const form = new FormData();
    const blob = new Blob([file.buffer]);
    form.append("file", blob, file.originalname);
    form.append("title", meta.title ?? file.originalname);
    form.append("source", meta.source ?? "admin upload");
    form.append("url", meta.url ?? "");
    form.append("date", meta.date ?? "");
    const res = await fetch(`${aiUrl()}/ingest-file`, { method: "POST", body: form as any });
    if (!res.ok) throw new ServiceUnavailableException(`file ingest failed (${res.status})`);
    return res.json();
  }

  async documents() {
    const res = await fetch(`${aiUrl()}/documents`);
    if (!res.ok) throw new ServiceUnavailableException(`documents failed (${res.status})`);
    return res.json();
  }

  async refresh(body: { region?: string; lang?: string }) {
    const res = await fetch(`${aiUrl()}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: body.region ?? "bavaria", lang: body.lang ?? "en" }),
    });
    if (!res.ok) throw new ServiceUnavailableException(`refresh failed (${res.status})`);
    return res.json();
  }

  llmConfig() {
    return this.aiConfig.status();
  }

  setLlmConfig(body: { geminiApiKey?: string }) {
    return this.aiConfig.setGeminiApiKey(body.geminiApiKey ?? "");
  }
}
