import { ApiCookieAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SessionGuard, type Request } from "../auth";
import { Catalogue } from "../catalogue";
import { Sales } from "./sales.service";
import { SalesPdf } from "./sales-pdf.service";
import {
  CustomerInput,
  CustomerUpdate,
  DocumentInput,
  DocumentUpdate,
  IssueInput,
  ListQuery,
  PaymentInput,
  ReasonInput,
  VersionInput,
} from "./sales.dto";

@ApiTags("Customers")
@ApiCookieAuth()
@Controller("customers")
@UseGuards(SessionGuard)
export class CustomersController {
  constructor(
    private readonly catalogue: Catalogue,
    private readonly sales: Sales,
  ) {}
  @Get() async list(@Req() req: Request, @Query() query: ListQuery) {
    return this.sales.customers(await this.catalogue.businessId(req), query);
  }
  @Get(":id") async get(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.sales.getCustomer(await this.catalogue.businessId(req), id);
  }
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable unique key for this request; reuse on retries.",
  })
  @Post()
  async create(
    @Req() req: Request,
    @Headers("idempotency-key") key: string,
    @Body() input: CustomerInput,
  ) {
    return this.sales.createCustomer(
      await this.catalogue.businessId(req),
      key,
      input,
    );
  }
  @Patch(":id") async update(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CustomerUpdate,
  ) {
    return this.sales.updateCustomer(
      await this.catalogue.businessId(req),
      id,
      input,
    );
  }
}
@ApiTags("Sales documents")
@ApiCookieAuth()
@Controller("sales-documents")
@UseGuards(SessionGuard)
export class SalesController {
  constructor(
    private readonly catalogue: Catalogue,
    private readonly sales: Sales,
    private readonly pdf: SalesPdf,
  ) {}
  @Get() async list(@Req() req: Request, @Query() query: ListQuery) {
    return this.sales.list(await this.catalogue.businessId(req), query);
  }
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable unique key for this request; reuse on retries.",
  })
  @Post()
  async create(
    @Req() req: Request,
    @Headers("idempotency-key") key: string,
    @Body() input: DocumentInput,
  ) {
    return this.sales.create(await this.catalogue.businessId(req), key, input);
  }
  @Get(":id") async get(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.sales.get(await this.catalogue.businessId(req), id);
  }
  @Patch(":id") async update(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: DocumentUpdate,
  ) {
    return this.sales.update(await this.catalogue.businessId(req), id, input);
  }
  @Delete(":id") async remove(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: VersionInput,
  ) {
    return this.sales.remove(
      await this.catalogue.businessId(req),
      id,
      input.version,
    );
  }
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @Post(":id/issue")
  async issue(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body() input: IssueInput,
  ) {
    return this.sales.issue(
      await this.catalogue.businessId(req),
      id,
      req.user.id,
      key,
      input,
    );
  }
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @Post(":id/convert")
  async convert(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body() input: VersionInput,
  ) {
    return this.sales.convert(
      await this.catalogue.businessId(req),
      id,
      key,
      input.version,
    );
  }
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @Post(":id/replace")
  async replace(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body() input: VersionInput,
  ) {
    return this.sales.convert(
      await this.catalogue.businessId(req),
      id,
      key,
      input.version,
      true,
    );
  }
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @Post(":id/void")
  async void(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body() input: ReasonInput,
  ) {
    return this.sales.void(
      await this.catalogue.businessId(req),
      id,
      req.user.id,
      key,
      input,
    );
  }
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @Post(":id/payments")
  async payment(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body() input: PaymentInput,
  ) {
    return this.sales.payment(
      await this.catalogue.businessId(req),
      id,
      req.user.id,
      key,
      input,
    );
  }
  @Post(":id/pdf") async render(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: VersionInput,
  ) {
    return this.pdf.request(
      await this.catalogue.businessId(req),
      id,
      input.version,
    );
  }
  @Get(":id/history-download") async history(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Res()
    res: { setHeader(k: string, v: string): void; send(value: string): void },
  ) {
    const row = await this.sales.get(await this.catalogue.businessId(req), id);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sales-history-${id}.json"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(
      JSON.stringify(
        {
          ...row,
          paymentNotice:
            "Owner-entered records; not bank verified. Reversals do not transfer funds.",
        },
        null,
        2,
      ),
    );
  }
  @Get(":id/download") async download(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Res()
    res: { setHeader(k: string, v: string): void; send(bytes: Buffer): void },
  ) {
    const { bytes, filename } = await this.pdf.download(
      await this.catalogue.businessId(req),
      id,
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  }
}
@ApiTags("Manual payments")
@ApiCookieAuth()
@Controller("payments")
@UseGuards(SessionGuard)
export class PaymentsController {
  constructor(
    private readonly catalogue: Catalogue,
    private readonly sales: Sales,
  ) {}
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @Post(":id/reverse")
  async reverse(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string,
    @Body() input: ReasonInput,
  ) {
    return this.sales.reverse(
      await this.catalogue.businessId(req),
      id,
      req.user.id,
      key,
      input,
    );
  }
}
