import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";

/**
 * Admin gate. Accepts either:
 *   - `Authorization: Bearer <token>` issued by POST /api/auth/login, or
 *   - the legacy `x-admin-token` header matching ADMIN_TOKEN (kept for
 *     backwards compatibility / scripted ingestion).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const header: string =
      req.headers["authorization"] || req.headers["Authorization"] || "";
    if (header.startsWith("Bearer ")) {
      const token = header.slice(7).trim();
      const payload = this.auth.verify(token);
      if (payload) {
        req.adminUser = payload.sub;
        return true;
      }
    }

    const legacy = process.env.ADMIN_TOKEN;
    if (legacy) {
      const got = req.headers["x-admin-token"];
      if (got === legacy) return true;
    }

    throw new UnauthorizedException("Admin authentication required");
  }
}
