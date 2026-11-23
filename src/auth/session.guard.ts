import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { Database } from "../infrastructure/database";
import { digest } from "./security";
import { RateLimits } from "../infrastructure/rate-limits";
export interface Request {
  headers: Record<string, string | undefined>;
  ip: string;
  method: string;
  user: Pick<User, "id" | "email" | "verifiedAt">;
  businessId?: string;
  sessionId: string;
}
export function currentBusinessId(req: Request): string {
  if (!req.businessId) throw new NotFoundException("Business not found.");
  return req.businessId;
}
export interface Response {
  setHeader(name: string, value: string): void;
  cookie(name: string, value: string, options: Record<string, unknown>): void;
}
export const cookieName = "marketmate_session";
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly db: Database,
    private readonly rate: RateLimits,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw))
      throw new UnauthorizedException("Please sign in.");
    const session = await this.db.session.findUnique({
      where: { id: digest(raw) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            verifiedAt: true,
            memberships: { select: { businessId: true } },
          },
        },
      },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException(
        "Your session has expired. Please sign in.",
      );
    const read = ["GET", "HEAD"].includes(req.method);
    this.rate.enforce(
      context.switchToHttp().getResponse<Response>(),
      read ? "read" : "write",
      session.userId,
      read ? 240 : 120,
    );
    req.user = session.user;
    req.businessId = session.user.memberships[0]?.businessId;
    req.sessionId = session.id;
    return true;
  }
}
@Injectable()
export class RateGuard implements CanActivate {
  constructor(private readonly rate: RateLimits) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    this.rate.enforce(
      context.switchToHttp().getResponse<Response>(),
      "auth",
      req.ip,
      30,
      15 * 60000,
    );
    return true;
  }
}
