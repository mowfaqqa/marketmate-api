import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
const backend = fileURLToPath(new URL("../", import.meta.url));
const objects = new Map();
const requests = { PUT: 0, GET: 0, DELETE: 0 };
const storage = createServer(async (req, res) => {
  const key = new URL(req.url, "http://127.0.0.1").pathname;
  if (
    !/^AWS4-HMAC-SHA256 Credential=marketmate-test-key\/\d{8}\/auto\/s3\/aws4_request,/.test(
      req.headers.authorization || "",
    ) ||
    !key.startsWith("/marketmate-test/businesses/")
  ) {
    res.writeHead(403).end();
    return;
  }
  requests[req.method]++;
  if (req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    objects.set(key, Buffer.concat(chunks));
    res.writeHead(200, { ETag: '"test-object"' }).end();
  } else if (req.method === "GET") {
    const object = objects.get(key);
    if (!object) {
      res
        .writeHead(404, { "Content-Type": "application/xml" })
        .end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    res
      .writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": object.length,
      })
      .end(object);
  } else if (req.method === "DELETE") {
    objects.delete(key);
    res.writeHead(204).end();
  } else res.writeHead(405).end();
});
storage.listen(0, "127.0.0.1");
await once(storage, "listening");
const port = process.env.TEST_API_PORT || "4102";
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  STUDIO_LOCAL_GENERATOR: "true",
  STUDIO_MONTHLY_UNITS: "4",
  PORT: port,
  API_HOST: "127.0.0.1",
  WEB_ORIGIN: "http://localhost:3000",
  MAIL_MODE: "file",
  MAIL_DIRECTORY: ".local-mail",
  R2_ACCOUNT_ID: "0".repeat(32),
  R2_BUCKET: "marketmate-test",
  R2_ACCESS_KEY_ID: "marketmate-test-key",
  R2_SECRET_ACCESS_KEY: "marketmate-test-secret",
  R2_JURISDICTION: "",
  R2_TEST_ENDPOINT: `http://127.0.0.1:${storage.address().port}`,
};
const api = spawn(process.execPath, ["dist/main.js"], {
  cwd: backend,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let startupLog = "";
api.stdout.on("data", (chunk) => {
  startupLog = (startupLog + chunk.toString()).slice(-2500);
});
api.stderr.on("data", (chunk) => {
  startupLog = (startupLog + chunk.toString()).slice(-2500);
});
try {
  let ready = false;
  for (let i = 0; i < 50 && api.exitCode === null; i++) {
    if (
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    await setTimeout(100);
  }
  assert.ok(
    ready && api.exitCode === null,
    startupLog || "Test API could not start.",
  );
  for (const suite of process.env.TEST_SUITE
    ? [process.env.TEST_SUITE]
    : ["catalogue", "studio", "graphics", "planner", "identity"]) {
    const test = spawn(process.execPath, [`test/${suite}.mjs`], {
      cwd: backend,
      env: { ...env, TEST_ORIGIN: origin },
      stdio: "inherit",
    });
    const [code] = await once(test, "exit");
    assert.equal(code, 0, `${suite} suite failed. ${startupLog}`);
  }
  if (!process.env.TEST_SUITE)
    assert.equal(
      objects.size,
      8,
      "The attached photo, its preview and six graphics should remain.",
    );
  if (!process.env.TEST_SUITE)
    assert.ok(requests.PUT >= 4 && requests.GET >= 1 && requests.DELETE >= 2);
  console.log(
    process.env.TEST_SUITE
      ? `${process.env.TEST_SUITE} suite passed using local S3-compatible storage. No live R2 requests were sent.`
      : "S3-compatible HTTP checks passed: signed writes, private reads and object deletion. No live R2 requests were sent.",
  );
} finally {
  api.kill();
  storage.closeAllConnections();
  storage.close();
}
