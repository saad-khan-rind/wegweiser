import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import * as crypto from "crypto";

export interface LoginResult {
  token: string;
  email: string;
  expiresIn: number;
}

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Single-admin authentication.
 *
 * Credentials come from the environment (ADMIN_EMAIL / ADMIN_PASSWORD) — there
 * is exactly one user. On success we issue a compact, signed token
 * (`base64url(payload).base64url(HMAC-SHA256(payload, secret))`). No external
 * JWT dependency is needed; verification only requires the same secret, so the
 * API stays stateless across restarts.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger("AuthService");
  // 12 hours.
  private readonly ttlSeconds = 60 * 60 * 12;

  private get secret(): string {
    return (
      process.env.ADMIN_JWT_SECRET ||
      process.env.ADMIN_TOKEN ||
      "wegweiser-dev-signing-secret"
    );
  }

  private get adminEmail(): string {
    return (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  }

  private get adminPassword(): string {
    return process.env.ADMIN_PASSWORD || "";
  }

  get configured(): boolean {
    return Boolean(this.adminEmail && this.adminPassword);
  }

  login(email: string, password: string): LoginResult {
    if (!this.configured) {
      this.log.error("Admin login attempted but ADMIN_EMAIL/ADMIN_PASSWORD are not set.");
      throw new UnauthorizedException("Admin login is not configured on the server");
    }
    const normalizedEmail = (email || "").trim().toLowerCase();
    const emailOk = safeEqual(normalizedEmail, this.adminEmail);
    const passwordOk = safeEqual(password || "", this.adminPassword);
    if (!emailOk || !passwordOk) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      sub: normalizedEmail,
      iat: now,
      exp: now + this.ttlSeconds,
    };
    return { token: this.sign(payload), email: normalizedEmail, expiresIn: this.ttlSeconds };
  }

  /** Verifies signature + expiry; returns the decoded payload or null. */
  verify(token: string): TokenPayload | null {
    try {
      const [body, signature] = (token || "").split(".");
      if (!body || !signature) return null;
      const expected = this.hmac(body);
      if (!safeEqual(signature, expected)) return null;
      const payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as TokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== "number" || payload.exp < now) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private sign(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(body: string): string {
    return crypto.createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}

/** Constant-time comparison that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
