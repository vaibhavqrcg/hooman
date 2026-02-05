import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Project root (repo root). From apps/api/dist/lib -> 4 levels up; from apps/api/src/lib -> 4 levels up. */
const PROJECT_ROOT = resolve(join(__dirname, "..", "..", "..", ".."));

/** All runtime data lives under workspace/ at project root. */
export const WORKSPACE_ROOT = join(PROJECT_ROOT, "workspace");

export const WORKSPACE_MCPCWD = join(WORKSPACE_ROOT, "mcpcwd");

export function getWorkspaceDbPath(): string {
  return join(WORKSPACE_ROOT, "hooman.db");
}

export function getWorkspaceMemoryDbPath(): string {
  return join(WORKSPACE_ROOT, "memory.db");
}

/** Mem0 vector store SQLite DB (embeddings). */
export function getWorkspaceVectorDbPath(): string {
  return join(WORKSPACE_ROOT, "vector.db");
}

export function getWorkspaceConfigPath(): string {
  return join(WORKSPACE_ROOT, "config.json");
}

export function getWorkspaceAttachmentsDir(): string {
  return join(WORKSPACE_ROOT, "attachments");
}
