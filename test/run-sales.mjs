import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.toLowerCase().includes("test")) {
  console.error(
    "Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name includes test. No database changes were made.",
  );
  process.exit(1);
}
const cwd = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env, DATABASE_URL: url, TEST_SUITE: "sales" };
for (const args of [["exec", "prisma", "migrate", "deploy"], ["build"]]) {
  const result = spawnSync("pnpm", args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(process.execPath, ["test/run-catalogue.mjs"], {
  cwd,
  env,
  stdio: "inherit",
});
process.exit(result.status || 0);
