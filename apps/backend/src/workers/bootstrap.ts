/**
 * Shared bootstrap for channel workers (Slack, WhatsApp, Cron).
 * Handles: loadPersisted -> initExtra -> createDispatchClient -> start -> initRedis -> initReloadWatch -> SIGINT/SIGTERM.
 */
import createDebug from "debug";
import { loadPersisted } from "../config.js";
import { createDispatchClient } from "../dispatch-client.js";
import { initRedis, closeRedis } from "../data/redis.js";
import {
  initReloadWatch,
  closeReloadWatch,
  type ReloadScope,
} from "../data/reload-flag.js";
import { env } from "../env.js";

export type DispatchClient = ReturnType<typeof createDispatchClient>;

export interface BootstrapOptions {
  /** Worker name for debug logging. */
  name: string;
  /** Reload scopes to watch (e.g. ["slack"]). Empty = no reload watch. */
  reloadScopes: ReloadScope[];
  /** Main start function, receives dispatch client. */
  start: (client: DispatchClient) => Promise<void>;
  /** Called on SIGINT/SIGTERM before closeRedis. */
  stop?: () => Promise<void>;
  /** Extra init before start (e.g. initDb, mkdirSync). */
  initExtra?: () => Promise<void>;
  /** Called when a reload flag fires. Receives the dispatch client so it can be reused. */
  onReload?: (client: DispatchClient) => Promise<void>;
}

export async function bootstrapWorker(opts: BootstrapOptions): Promise<void> {
  const debug = createDebug(`hooman:workers:${opts.name}`);

  await loadPersisted();

  if (opts.initExtra) await opts.initExtra();

  const client = createDispatchClient({
    apiBaseUrl: env.API_BASE_URL,
    secret: env.INTERNAL_SECRET || undefined,
  });

  if (env.REDIS_URL) {
    initRedis(env.REDIS_URL);
    debug("Redis initialized (%s)", env.REDIS_URL);
  }

  await opts.start(client);

  if (env.REDIS_URL && opts.reloadScopes.length && opts.onReload) {
    initReloadWatch(env.REDIS_URL, opts.reloadScopes, async () => {
      debug("Reload flag set; reloading");
      await loadPersisted();
      await opts.onReload!(client);
    });
  }

  debug("%s worker started; posting to %s", opts.name, env.API_BASE_URL);

  const shutdown = async () => {
    debug("Shutting down %s worker…", opts.name);
    await closeReloadWatch();
    if (opts.stop) await opts.stop();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

/** Convenience: call bootstrapWorker and handle top-level errors. */
export function runWorker(opts: BootstrapOptions): void {
  const debug = createDebug(`hooman:workers:${opts.name}`);
  bootstrapWorker(opts).catch((err) => {
    debug("%s worker failed: %o", opts.name, err);
    process.exit(1);
  });
}
