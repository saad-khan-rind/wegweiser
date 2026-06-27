import { Injectable } from "@nestjs/common";

export interface AiProviderStatus {
  provider: "gemini" | "ollama" | "mock";
  model: string;
  geminiConfigured: boolean;
}

@Injectable()
export class AiConfigService {
  private static geminiApiKey = process.env.GEMINI_API_KEY ?? "";
  private static geminiModel = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

  get geminiApiKey(): string {
    return AiConfigService.geminiApiKey;
  }

  get geminiModel(): string {
    return AiConfigService.geminiModel;
  }

  setGeminiApiKey(apiKey: string): AiProviderStatus {
    AiConfigService.geminiApiKey = apiKey.trim();
    return this.status();
  }

  status(): AiProviderStatus {
    if (this.geminiApiKey) {
      return { provider: "gemini", model: this.geminiModel, geminiConfigured: true };
    }
    if (process.env.OLLAMA_URL || process.env.AI_SERVICE_URL) {
      return { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.1:8b", geminiConfigured: false };
    }
    return { provider: "mock", model: "none", geminiConfigured: false };
  }
}
