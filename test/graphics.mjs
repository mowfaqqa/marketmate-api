import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
config({ path: new URL("../.env", import.meta.url), quiet: true });
const db = new PrismaClient();
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:4102";
async function call(path, cookie, status, body) {
  const response = await fetch(origin + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body && JSON.stringify(body),
  });
  assert.equal(
    response.status,
    status,
    response.ok ? path : await response.clone().text(),
  );
  return response;
}
const register = () =>
  call("/auth/register", "", 201, {
    email: `graphics-${randomUUID()}@example.com`,
    password: "graphics-synthetic-password",
  }).then((response) => response.headers.get("set-cookie").split(";")[0]);
try {
  const cookie = await register();
  const other = await register();
  const { business } = await (await call("/auth/me", cookie, 200)).json();
  const businessId = business.id;
  await db.business.update({
    where: { id: businessId },
    data: {
      name: "Ọlá & Sons Design and Tailoring Workshop in Victoria Island Lagos",
      brandColor: "#ffffff",
      contact: "+2348012345678",
    },
  });
  const product = await db.product.create({
    data: {
      businessId,
      name: "Cotton shirt",
      type: "PRODUCT",
      pricingMode: "FIXED",
      priceKobo: 250000n,
    },
  });
  const photo = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#ddaa33" },
  })
    .webp()
    .toBuffer();
  const asset = await db.mediaAsset.create({
    data: {
      businessId,
      productId: product.id,
      storageProvider: "LEGACY_DB",
      status: "READY",
      width: 64,
      height: 48,
      bytes: photo.length,
      content: photo,
      preview: photo,
      checksum: "fixture",
      uploadTokenHash: "fixture",
      uploadExpiresAt: new Date(),
      productVersion: 0,
    },
  });
  await db.product.update({
    where: { id: product.id },
    data: { primaryAssetId: asset.id },
  });
  const offer = await db.offer.create({
    data: {
      businessId,
      productId: product.id,
      promoPriceKobo: 200000n,
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() + 3600000),
      terms: "While supplies last. Pickup in store.",
    },
  });
  const service = await db.product.create({
    data: {
      businessId,
      name: "Tailoring",
      type: "SERVICE",
      pricingMode: "INQUIRY",
    },
  });

  async function draft(productId, goal) {
    const brief = {
      key: randomUUID(),
      productId,
      goal,
      channel: "instagram",
      tone: "friendly",
      manual: true,
    };
    const facts = await (
      await call("/studio/preview", cookie, 201, brief)
    ).json();
    const job = await (
      await call("/studio", cookie, 202, {
        ...brief,
        productVersion: facts.productVersion,
        businessVersion: facts.businessVersion,
      })
    ).json();
    const path = "/studio/" + job.id;
    const current = await (await call(path, cookie, 200)).json();
    const edit = await (
      await call(path + "/edit", cookie, 201, {
        draftId: current.drafts[0].id,
        text: "Discover our latest collection & visit the shop.",
      })
    ).json();
    return { path, draftId: edit.id };
  }

  const retail = await draft(product.id, "offer");
  const services = await draft(service.id, "inquiries");
  await call(retail.path + "/graphics", cookie, 409, {
    draftId: retail.draftId,
    layout: "spotlight",
    format: "square",
  });
  for (const item of [retail, services])
    await call(item.path + "/approve", cookie, 201, { draftId: item.draftId });
  let first;
  for (const layout of ["spotlight", "offer", "service"]) {
    const item = layout === "service" ? services : retail;
    for (const format of ["square", "story"]) {
      const payload = { draftId: item.draftId, layout, format };
      const { id } = await (
        await call(item.path + "/graphics", cookie, 201, payload)
      ).json();
      const file = "/studio/graphics/" + id + "/file";
      const preview = Buffer.from(
        await (await call(file, cookie, 200)).arrayBuffer(),
      );
      const download = await call(file + "?download=1", cookie, 200);
      assert.match(download.headers.get("content-disposition"), /^attachment/);
      assert.deepEqual(preview, Buffer.from(await download.arrayBuffer()));
      const metadata = await sharp(preview).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.width, 1080);
      assert.equal(metadata.height, format === "square" ? 1080 : 1920);
      first ??= { id, file, payload };
    }
  }
  assert.equal(
    (
      await (
        await call(retail.path + "/graphics", cookie, 201, first.payload)
      ).json()
    ).id,
    first.id,
  );
  await call(first.file, other, 404);
  await call(first.file, "", 401);
  await db.offer.update({
    where: { id: offer.id },
    data: {
      startsAt: new Date(Date.now() - 120000),
      endsAt: new Date(Date.now() - 1000),
    },
  });
  await call(first.file, cookie, 400);
  assert.equal(
    await db.studioGraphic.count({ where: { businessId, status: "ready" } }),
    6,
  );
  console.log(
    "Graphics HTTP checks passed for six outputs, private access, identical previews and downloads, caching and offer expiry.",
  );
} finally {
  await db.$disconnect();
}
