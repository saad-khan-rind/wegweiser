import { Injectable } from "@nestjs/common";

// Server-side journey templates. The web app ships its own copy so it works
// offline; this endpoint lets other clients (or a future Integreat app
// integration) request a personalized route from coarse tags only.
const TEMPLATES: Record<string, string[]> = {
  "status:arriving": ["arrived", "anmeldung", "taxid", "health", "bank", "residence"],
  "status:asylum": ["arrived", "asylumApply", "anmeldung", "asylumInterview", "integration", "workauth"],
  "status:student": ["arrived", "enrol", "anmeldung", "residence", "health", "studentwork"],
  "status:worker": ["arrived", "anmeldung", "taxid", "bluecard", "bank", "employer"],
  "status:eu": ["arrived", "anmeldung", "taxid", "health", "bank"],
  "status:family": ["arrived", "anmeldung", "health", "childcare", "kindergeld", "reunification"],
};

@Injectable()
export class JourneyService {
  build(tags: string[]): { stationIds: string[] } {
    const status = tags.find((t) => t.startsWith("status:")) ?? "status:arriving";
    const ids = [...(TEMPLATES[status] ?? TEMPLATES["status:arriving"])];
    if (tags.includes("family:has_children") && status !== "status:family") {
      for (const extra of ["childcare", "kindergeld"]) if (!ids.includes(extra)) ids.push(extra);
    }
    return { stationIds: ids };
  }
}
