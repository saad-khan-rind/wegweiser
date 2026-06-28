import { Body, Controller, Get, Post, Req, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Exchange the single admin's email + password for a signed token. */
  @Post("login")
  login(@Body() body: { email?: string; password?: string }) {
    const { token, email, expiresIn } = this.auth.login(
      body?.email ?? "",
      body?.password ?? "",
    );
    return { token, email, expiresIn, tokenType: "Bearer" };
  }

  /** Lets the frontend confirm a stored token is still valid on reload. */
  @Get("me")
  me(@Req() req: any) {
    const header: string = req.headers["authorization"] || req.headers["Authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const payload = this.auth.verify(token);
    if (!payload) throw new UnauthorizedException("Invalid or expired token");
    return { email: payload.sub, expiresAt: payload.exp };
  }
}
