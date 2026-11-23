import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { SessionGuard, type Request } from "../auth/session.guard";
import { RateLimits } from "../infrastructure/rate-limits";

import { GraphicInput } from "./graphics.dto";
import type { HeaderResponse as Headers } from "../infrastructure/rate-limits";
import { Graphics } from "./graphics.service";
@Controller()
@UseGuards(SessionGuard)
export class GraphicsController {
  constructor(
    private graphics: Graphics,
    private rate: RateLimits,
  ) {}

  @Post("studio/:jobId/graphics")
  create(
    @Req() req: Request,
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Body() input: GraphicInput,
    @Res({ passthrough: true }) res: Headers,
  ) {
    return this.graphics.create(req, jobId, input, res, this.rate);
  }

  @Get("studio/graphics/:id/file")
  async file(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("download") download: string | undefined,
    @Res({ passthrough: true }) res: Headers,
  ) {
    this.rate.enforce(res, "graphic-file", req.user.id, 30);
    const file = await this.graphics.file(req, id);
    return new StreamableFile(file, {
      type: "image/png",
      disposition: `${download === "1" ? "attachment" : "inline"}; filename="marketmate-${id}.png"`,
    });
  }
}
