import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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

import { PlanInput, DayInput, Completion } from "./planner.dto";
import type { HeaderResponse as Headers } from "../infrastructure/rate-limits";
import { Planner } from "./planner.service";
@Controller("planner")
@UseGuards(SessionGuard)
export class PlannerController {
  constructor(
    private planner: Planner,
    private rate: RateLimits,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.planner.list(currentBusinessId(req));
  }

  @Post()
  create(
    @Req() req: Request,
    @Body() input: PlanInput,
    @Res({ passthrough: true }) res: Headers,
  ) {
    this.rate.enforce(res, "plan-create", req.user.id, 5);
    return this.planner.create(req, input);
  }

  @Patch(":plan/days/:day")
  edit(
    @Req() req: Request,
    @Param("plan", ParseUUIDPipe) plan: string,
    @Param("day", ParseUUIDPipe) day: string,
    @Body() input: DayInput,
    @Res({ passthrough: true }) res: Headers,
  ) {
    this.rate.enforce(res, "plan-edit", req.user.id, 20);
    return this.planner.edit(req, plan, day, input);
  }

  @Patch(":plan/days/:day/completion")
  complete(
    @Req() req: Request,
    @Param("plan", ParseUUIDPipe) plan: string,
    @Param("day", ParseUUIDPipe) day: string,
    @Body() input: Completion,
    @Res({ passthrough: true }) res: Headers,
  ) {
    this.rate.enforce(res, "plan-completion", req.user.id, 30);
    return this.planner.complete(req, plan, day, input);
  }
}
