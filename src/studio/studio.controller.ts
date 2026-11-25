import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  currentBusinessId,
  SessionGuard,
  type Request,
} from "../auth/session.guard";
import { RateLimits } from "../infrastructure/rate-limits";
import {
  Brief,
  DraftInput,
  DraftId,
  Feedback,
  ArchiveInput,
} from "./studio.dto";
import { Studio } from "./studio.service";
@Controller("studio")
@UseGuards(SessionGuard)
export class StudioController {
  constructor(
    private studio: Studio,
    private rate: RateLimits,
  ) {}
  @Get()
  async list(@Req() req: Request) {
    return this.studio.list(currentBusinessId(req));
  }
  @Post("preview")
  async preview(@Req() req: Request, @Body() brief: Brief) {
    return this.studio.facts(currentBusinessId(req), brief);
  }
  @Post()
  @HttpCode(202)
  async start(
    @Req() req: Request,
    @Res({ passthrough: true })
    res: { setHeader(name: string, value: string): void },
    @Body() brief: Brief,
  ) {
    const businessId = currentBusinessId(req);
    this.rate.enforce(res, "studio-start", businessId, 5);
    if (!brief.manual && !req.user.verifiedAt)
      throw new BadRequestException(
        "Verify your email before generating content.",
      );
    return this.studio.start(businessId, brief);
  }
  @Get(":id")
  async get(@Req() req: Request, @Param("id") id: string) {
    return this.studio.owned(currentBusinessId(req), id);
  }
  @Post(":id/edit")
  async edit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: DraftInput,
  ) {
    return this.studio.review(
      currentBusinessId(req),
      id,
      input.draftId,
      req.user.id,
      "edit",
      input.text,
    );
  }
  @Post(":id/approve")
  async approve(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: DraftId,
  ) {
    return this.studio.review(
      currentBusinessId(req),
      id,
      input.draftId,
      req.user.id,
      "approve",
    );
  }
  @Post(":id/copy")
  async copy(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: DraftId,
  ) {
    return this.studio.review(
      currentBusinessId(req),
      id,
      input.draftId,
      req.user.id,
      "copy",
    );
  }
  @Post(":id/feedback")
  async feedback(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: Feedback,
  ) {
    return this.studio.feedback(currentBusinessId(req), id, input);
  }
  @Post(":id/archive")
  async archive(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: ArchiveInput,
  ) {
    return this.studio.archive(currentBusinessId(req), id, input);
  }
}
