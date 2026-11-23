import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import { Database } from "../infrastructure/database";
import { Mail } from "./mail";
import { checkPassword, digest, hashPassword, token } from "./security";
import { Credentials } from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly mail: Mail,
  ) {}
  private async accountToken(userId: string, purpose: "verify" | "reset") {
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
  async createSession(userId: string) {
    const raw = token();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await this.db.session.create({
      data: { id: digest(raw), userId, expiresAt },
    });
    return { raw, expiresAt };
  }

  async register(input: Credentials) {
    const email = input.email.toLowerCase().trim();
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.db.user.create({
        data: {
          email,
          passwordHash,
          memberships: { create: { business: { create: { name: "" } } } },
        },
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002") {
        throw new ConflictException(
          "Unable to create this account. Try signing in or recovering your password.",
        );
      }
      throw error;
    }
  }
  async authenticate(input: Credentials) {
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
    return user;
  }
  async sendLink(
    user: Pick<User, "id" | "email">,
    purpose: "verify" | "reset",
  ) {
    await this.mail.send(
      user.email,
      purpose,
      await this.accountToken(user.id, purpose),
    );
  }
  async account(user: Pick<User, "id" | "email" | "verifiedAt">) {
    const membership = await this.db.membership.findUniqueOrThrow({
      where: { userId: user.id },
      include: { business: true },
    });
    return {
      email: user.email,
      verified: !!user.verifiedAt,
      business: membership.business,
    };
  }

  endSession(id: string) {
    return this.db.session.deleteMany({ where: { id } });
  }
  private async claimToken(
    tx: Prisma.TransactionClient,
    raw: string,
    purpose: "verify" | "reset",
  ) {
    const record = await tx.accountToken.findUnique({
      where: { id: digest(raw) },
    });
    if (
      !record ||
      record.purpose !== purpose ||
      record.expiresAt <= new Date()
    ) {
      throw new BadRequestException(
        purpose === "verify"
          ? "This link is invalid or expired. Request a new verification email."
          : "This link is invalid or expired. Request another password reset.",
      );
    }
    const claimed = await tx.accountToken.deleteMany({
      where: { id: record.id },
    });
    if (!claimed.count)
      throw new BadRequestException("This link has already been used.");
    return record.userId;
  }
  async verify(raw: string) {
    await this.db.$transaction(async (tx) => {
      const id = await this.claimToken(tx, raw, "verify");
      await tx.user.update({ where: { id }, data: { verifiedAt: new Date() } });
    });
  }
  async forgot(email: string) {
    const user = await this.db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (user) {
      try {
        await this.sendLink(user, "reset");
      } catch {
        /* Keep account existence private. */
      }
    }
  }
  async reset(raw: string, password: string) {
    const passwordHash = await hashPassword(password);
    await this.db.$transaction(async (tx) => {
      const userId = await this.claimToken(tx, raw, "reset");
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.accountToken.deleteMany({ where: { userId, purpose: "reset" } });
    });
  }
}
