import { AuthService } from "./auth.service";
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Credentials, EmailInput, TokenInput, ResetInput } from "./auth.dto";
import {
  cookieName,
  SessionGuard,
  RateGuard,
  type Request,
  type Response,
} from "./session.guard";
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
});
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private async loginSession(userId: string, res: Response) {
    const { raw, expiresAt } = await this.auth.createSession(userId);
    res.cookie(cookieName, raw, { ...cookieOptions(), expires: expiresAt });
  }
  @Post("register")
  @UseGuards(RateGuard)
  async register(
    @Body() input: Credentials,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.register(input);
    await this.loginSession(user.id, res);
    await this.auth.sendLink(user, "verify");
    return { message: "Check your email to verify your account." };
  }
  @Post("login")
  @UseGuards(RateGuard)
  async login(
    @Body() input: Credentials,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.authenticate(input);
    await this.loginSession(user.id, res);
    return { message: "Signed in." };
  }
  @Get("me")
  @UseGuards(SessionGuard)
  async me(@Req() req: Request) {
    return this.auth.account(req.user);
  }
  @Post("logout")
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.endSession(req.sessionId);
    res.cookie(cookieName, "", { ...cookieOptions(), maxAge: 0 });
    return { message: "Signed out." };
  }
  @Post("verify")
  @UseGuards(RateGuard)
  async verify(@Body() input: TokenInput) {
    await this.auth.verify(input.token);
    return {
      message: "Email verified. You can continue setting up your business.",
    };
  }
  @Post("resend-verification")
  @UseGuards(SessionGuard, RateGuard)
  async resend(@Req() req: Request) {
    if (!req.user.verifiedAt) await this.auth.sendLink(req.user, "verify");
    return { message: "If verification is needed, a new link has been sent." };
  }
  @Post("forgot-password")
  @UseGuards(RateGuard)
  async forgot(@Body() input: EmailInput) {
    await this.auth.forgot(input.email);
    return {
      message: "If an account exists, you will receive a password reset link.",
    };
  }
  @Post("reset-password")
  @UseGuards(RateGuard)
  async reset(@Body() input: ResetInput) {
    await this.auth.reset(input.token, input.password);
    return { message: "Password changed. Please sign in again." };
  }
}
