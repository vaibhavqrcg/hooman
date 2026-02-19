/**
 * Slack worker: runs only the Slack channel adapter (Socket Mode), posting message events to API via POST /api/internal/dispatch.
 * Subscribes to Redis for response delivery (hooman:response_delivery) and sends replies via chat.postMessage.
 * Respects channel on/off: at startup and when Redis reload flag is set (e.g. after PATCH /api/channels).
 * Run as a separate PM2 process (e.g. pm2 start ecosystem.config.cjs --only slack).
 */
import createDebug from "debug";
import { getChannelsConfig } from "../config.js";
import {
  startSlackAdapter,
  stopSlackAdapter,
  sendMessageToChannel,
} from "../channels/slack-adapter.js";
import { createSubscriber } from "../data/pubsub.js";
import { RESPONSE_DELIVERY_CHANNEL } from "../types.js";
import { runWorker, type DispatchClient } from "./bootstrap.js";

const debug = createDebug("hooman:workers:slack");

let responseDeliverySubscriber: ReturnType<typeof createSubscriber> | null =
  null;

async function startAdapter(client: DispatchClient): Promise<void> {
  await stopSlackAdapter();
  await startSlackAdapter(client, () => getChannelsConfig().slack);

  if (responseDeliverySubscriber) {
    await responseDeliverySubscriber.close();
    responseDeliverySubscriber = null;
  }
  responseDeliverySubscriber = createSubscriber();
  if (responseDeliverySubscriber) {
    responseDeliverySubscriber.subscribe(RESPONSE_DELIVERY_CHANNEL, (raw) => {
      try {
        const payload = JSON.parse(raw) as {
          channel?: string;
          channelId?: string;
          threadTs?: string;
          text?: string;
        };
        if (payload.channel !== "slack") return;
        const channelId = payload.channelId;
        const text = payload.text;
        if (typeof channelId !== "string" || typeof text !== "string") return;
        sendMessageToChannel(channelId, text, payload.threadTs).catch((err) => {
          debug("response_delivery slack send error: %o", err);
        });
      } catch (err) {
        debug("response_delivery parse/handle error: %o", err);
      }
    });
    debug("Response delivery subscriber started");
  }
}

runWorker({
  name: "slack",
  reloadScopes: ["slack"],
  start: (client) => startAdapter(client),
  stop: async () => {
    if (responseDeliverySubscriber) {
      await responseDeliverySubscriber.close();
      responseDeliverySubscriber = null;
    }
    await stopSlackAdapter();
  },
  onReload: (client) => startAdapter(client),
});
