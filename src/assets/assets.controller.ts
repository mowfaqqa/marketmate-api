import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SessionGuard, type Request } from "../auth/session.guard";
import { UploadInput } from "../catalogue/catalogue.dto";

import { MAX_BYTES } from "./image";
import { UploadRateGuard } from "./upload-rate.guard";
import { Assets } from "./assets.service";
@Controller()
@UseGuards(SessionGuard)
export class AssetsController {
  constructor(private readonly assets: Assets) {}

  @Post("products/:id/image-upload")
  @UseGuards(UploadRateGuard)
  async authorize(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UploadInput,
  ) {
    return this.assets.authorizeUpload(req, id, input);
  }

  @Post("assets/:id/complete")
  @UseGuards(UploadRateGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  async complete(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("x-upload-token") uploadToken: string | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    return this.assets.complete(req, id, uploadToken, file);
  }

  @Post("assets/:id/authorize")
  async authorizeRead(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.assets.authorizeRead(req, id);
  }

  @Delete("assets/:id")
  async remove(@Req() req: Request, @Param("id", ParseUUIDPipe) id: string) {
    return this.assets.remove(req, id);
  }

  @Get("assets/:id/file")
  async file(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("size") size: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
    @Res()
    response: {
      setHeader(k: string, v: string): void;
      send(data: Buffer): void;
    },
  ) {
    const bytes = await this.assets.read(req, id, size, expires, signature);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Content-Disposition", `inline; filename="${id}.webp"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.send(bytes);
  }
}
