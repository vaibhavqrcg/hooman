import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getWorkspaceDbPath } from "./workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** apps/api when running from src or dist (for Prisma schema cwd). */
const API_ROOT = join(__dirname, "..", "..");

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = `file:${getWorkspaceDbPath()}`;
    }
    prisma = new PrismaClient();
  }
  return prisma;
}

/** Run migrations and ensure DB is ready. Call before using getPrisma() in production. */
export async function initDb(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `file:${getWorkspaceDbPath()}`;
  }
  const schemaPath = join(API_ROOT, "prisma", "schema.prisma");
  execSync(`npx prisma migrate deploy --schema=${schemaPath}`, {
    cwd: API_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  getPrisma();
}
