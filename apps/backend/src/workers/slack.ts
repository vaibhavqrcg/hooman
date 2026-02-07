/**
 * Slack worker: runs only the Slack channel adapter (Socket Mode), posting message events to API via POST /api/internal/dispatch.
 * Inbound listening only. For Slack MCP tools (history, post, etc.) the app uses the prebuilt slack-mcp-server when the channel is enabled.
 * Respects channel on/off: at startup and when Redis reload flag is set (e.g. after PATCH /api/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only slack).
 */
import { getChannelsConfig } from "../config.js";
import {
  startSlackAdapter,
  stopSlackAdapter,
} from "../channels/slack-adapter.js";
import { runWorker, type DispatchClient } from "./bootstrap.js";

async function startAdapter(client: DispatchClient): Promise<void> {
  await stopSlackAdapter();
  await startSlackAdapter(client, () => getChannelsConfig().slack);
}

runWorker({
  name: "slack",
  reloadScopes: ["slack"],
  start: (client) => startAdapter(client),
  stop: () => stopSlackAdapter(),
  onReload: (client) => startAdapter(client),
});
