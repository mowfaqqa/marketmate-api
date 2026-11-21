import {
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { Database } from "./database";
import { Mail } from "./mail";
import { checkPassword, digest, hashPassword, token } from "./security";
import { Credentials, EmailInput, TokenInput, ResetInput } from "./dto";
import { RateLimits } from "./rate-limits";
export interface Request {
  headers: Record<string, string | undefined>;
  ip: string;
  method: string;
  user: User;
  sessionId: string;
}
interface Response {
  setHeader(name: string, value: string): void;
  cookie(name: string, value: string, options: Record<string, unknown>): void;
}
const cookieName = "marketmate_session";
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
});
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
      include: { user: true },
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
@Controller("auth")
export class AuthController {
  constructor(
    private readonly db: Database,
    private readonly mail: Mail,
  ) {}
  private async accountToken(userId: string, purpose: string) {
    const raw = token();
    await this.db.accountToken.create({
      data: {
        id: digest(raw),
        userId,
        purpose,
        expiresAt: new Date(
          Date.now() + (purpose === "verify" ? 86400000 : 1800000),
        ),
      },
    });
    return raw;
  }
  private async loginSession(userId: string, res: Response) {
    const raw = token();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await this.db.session.create({
      data: { id: digest(raw), userId, expiresAt },
    });
    res.cookie(cookieName, raw, { ...cookieOptions(), expires: expiresAt });
  }
  @Post("register")
  @UseGuards(RateGuard)
  async register(
    @Body() input: Credentials,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = input.email.toLowerCase().trim();
    const passwordHash = await hashPassword(input.password);
    const user = await this.db
      .$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { email } }))
          throw new ConflictException(
            "Unable to create this account. Try signing in or recovering your password.",
          );
        return tx.user.create({
          data: {
            email,
            passwordHash,
            memberships: { create: { business: { create: { name: "" } } } },
          },
        });
      })
      .catch((error) => {
        if (error.code === "P2002")
          throw new ConflictException(
            "Unable to create this account. Try signing in.",
          );
        throw error;
      });
    await this.loginSession(user.id, res);
    await this.mail.send(
      email,
      "verify",
      await this.accountToken(user.id, "verify"),
    );
    return { message: "Check your email to verify your account." };
  }
  @Post("login")
  @UseGuards(RateGuard)
  async login(
    @Body() input: Credentials,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.db.user.findUnique({
      where: { email: input.email.toLowerCase().trim() },
    });
    const fallback = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await checkPassword(
      input.password,
      user?.passwordHash || fallback,
    );
    if (!user || !valid)
      throw new UnauthorizedException("Email or password is incorrect.");
    await this.loginSession(user.id, res);
    return { message: "Signed in." };
  }
  @Get("me")
  @UseGuards(SessionGuard)
  async me(@Req() req: Request) {
    const membership = await this.db.membership.findUniqueOrThrow({
      where: { userId: req.user.id },
      include: { business: true },
    });
    return {
      email: req.user.email,
      verified: !!req.user.verifiedAt,
      business: membership.business,
    };
  }
  @Post("logout")
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.db.session.deleteMany({ where: { id: req.sessionId } });
    res.cookie(cookieName, "", { ...cookieOptions(), maxAge: 0 });
    return { message: "Signed out." };
  }
  @Post("verify")
  @UseGuards(RateGuard)
  async verify(@Body() input: TokenInput) {
    await this.db.$transaction(async (tx) => {
      const record = await tx.accountToken.findUnique({
        where: { id: digest(input.token) },
      });
      if (
        !record ||
        record.purpose !== "verify" ||
        record.expiresAt <= new Date()
      )
        throw new BadRequestException(
          "This link is invalid or expired. Request a new verification email.",
        );
      const claimed = await tx.accountToken.deleteMany({
        where: { id: record.id },
      });
      if (!claimed.count)
        throw new BadRequestException("This link has already been used.");
      await tx.user.update({
        where: { id: record.userId },
        data: { verifiedAt: new Date() },
      });
    });
    return {
      message: "Email verified. You can continue setting up your business.",
    };
  }
  @Post("resend-verification")
  @UseGuards(SessionGuard, RateGuard)
  async resend(@Req() req: Request) {
    if (!req.user.verifiedAt)
      await this.mail.send(
        req.user.email,
        "verify",
        await this.accountToken(req.user.id, "verify"),
      );
    return { message: "If verification is needed, a new link has been sent." };
  }
  @Post("forgot-password")
  @UseGuards(RateGuard)
  async forgot(@Body() input: EmailInput) {
    const user = await this.db.user.findUnique({
      where: { email: input.email.toLowerCase().trim() },
    });
    if (user) {
      try {
        await this.mail.send(
          user.email,
          "reset",
          await this.accountToken(user.id, "reset"),
        );
      } catch {
        /* Keep account existence private. */
      }
    }
    return {
      message: "If an account exists, you will receive a password reset link.",
    };
  }
  @Post("reset-password")
  @UseGuards(RateGuard)
  async reset(@Body() input: ResetInput) {
    const passwordHash = await hashPassword(input.password);
    await this.db.$transaction(async (tx) => {
      const record = await tx.accountToken.findUnique({
        where: { id: digest(input.token) },
      });
      if (
        !record ||
        record.purpose !== "reset" ||
        record.expiresAt <= new Date()
      )
        throw new BadRequestException(
          "This link is invalid or expired. Request another password reset.",
        );
      const claimed = await tx.accountToken.deleteMany({
        where: { id: record.id },
      });
      if (!claimed.count)
        throw new BadRequestException("This link has already been used.");
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: record.userId } });
      await tx.accountToken.deleteMany({
        where: { userId: record.userId, purpose: "reset" },
      });
    });
    return { message: "Password changed. Please sign in again." };
  }
}
