import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { type Request } from "../auth/session.guard";
import { RateLimits } from "../infrastructure/rate-limits";

@Injectable()
export class UploadRateGuard implements CanActivate {
  constructor(private readonly rate: RateLimits) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    this.rate.enforce(
      context.switchToHttp().getResponse(),
      "photo-upload",
      req.user.id,
      30,
    );
    return true;
  }
}
