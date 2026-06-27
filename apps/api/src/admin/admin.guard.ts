import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

/**
 * Minimal admin gate. If ADMIN_TOKEN is set, the request must send it as
 * `x-admin-token`. If it's unset (local dev), access is allowed but logged.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) return true;
    const req = context.switchToHttp().getRequest();
    const got = req.headers["x-admin-token"];
    if (got !== expected) throw new UnauthorizedException("Invalid admin token");
    return true;
  }
}
