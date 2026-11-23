import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  currentBusinessId,
  SessionGuard,
  type Request,
} from "../auth/session.guard";
import {
  ArchiveInput,
  OfferInput,
  ProductInput,
  ProductQuery,
  ProductUpdate,
  VersionInput,
} from "./catalogue.dto";

import { Catalogue, productView } from "./catalogue.service";
@Controller("products")
@UseGuards(SessionGuard)
export class CatalogueController {
  constructor(private readonly catalogue: Catalogue) {}

  @Get()
  async list(@Req() req: Request, @Query() query: ProductQuery) {
    return this.catalogue.list(currentBusinessId(req), query);
  }

  @Post()
  async create(@Req() req: Request, @Body() input: ProductInput) {
    return this.catalogue.create(currentBusinessId(req), input);
  }

  @Get(":id")
  async get(@Req() req: Request, @Param("id", ParseUUIDPipe) id: string) {
    return productView(await this.catalogue.owned(currentBusinessId(req), id));
  }

  @Put(":id")
  async update(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: ProductUpdate,
  ) {
    return this.catalogue.update(currentBusinessId(req), id, input);
  }

  @Patch(":id/archive")
  async archive(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: ArchiveInput,
  ) {
    return this.catalogue.archive(currentBusinessId(req), id, input);
  }

  @Put(":id/offer")
  async offer(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: OfferInput,
  ) {
    return this.catalogue.saveOffer(currentBusinessId(req), id, input);
  }

  @Post(":id/offer/cancel")
  async cancel(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: VersionInput,
  ) {
    return this.catalogue.cancelOffer(currentBusinessId(req), id, input);
  }
}
