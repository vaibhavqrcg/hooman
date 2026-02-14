import createDebug from "debug";
import { readFile, writeFile } from "fs/promises";
import { getWorkspaceConfigPath, WORKSPACE_ROOT } from "./workspace.js";
import type { ChannelsConfig } from "./types.js";
import { env } from "./env.js";

const debug = createDebug("hooman:config");

const CONFIG_PATH = getWorkspaceConfigPath();

/** Default configurable system instructions (personality, persona handoff). User can override in Settings. */
export const DEFAULT_AGENT_INSTRUCTIONS = `You are Hooman, a digital concierge that operates on behalf of the user.
Be conversational and human-first. Use memory context when provided to tailor and remember preferences.
When a task fits a specialized persona (by role and capabilities), hand off to that persona to do it; otherwise respond yourself.`;

/**
 * Static instructions always appended to the agent (not user-configurable).
 * Covers channel replies and WhatsApp chat ID so the agent always follows these rules.
 */
export const STATIC_AGENT_INSTRUCTIONS_APPEND = `
## Channel replies (IMPORTANT)

You receive messages from different channels (web chat, Slack, WhatsApp, Email).
When a "[Channel context]" block is present in the conversation, you MUST reply on that channel
using the available MCP tools. This is mandatory — do not skip it or just respond in text.

Steps when channel context is present:
1. Read the source_channel and identifiers (chatId, channelId, messageId, etc.) from the channel context.
2. Compose your reply text.
3. Call the appropriate MCP tool to send the reply on the source channel:
   - WhatsApp → call whatsapp_send_message with the chatId and your reply text.
   - Slack → call the Slack MCP tool to post a message in the channelId. Using threadTs to reply in-thread is optional — use your judgment (e.g. DMs often feel more natural without threading).
   - Email → call the email MCP tool to reply to the message.
4. Your final text output should be the same reply you sent via the tool.

## WhatsApp chat ID from phone number

When the user asks you to message them (or someone) on WhatsApp and gives a phone number, you can derive the chatId yourself. Format: digits only (country code + number, no + or spaces) followed by @c.us. Examples:
- +1 555 123 4567 → 15551234567@c.us
- +91 98765 43210 → 919876543210@c.us
- 44 20 7123 4567 → 442071234567@c.us
Strip all non-digits from the number, then append @c.us. Use that as chatId in whatsapp_send_message. Do not ask the user to "share the chat ID" or "message first" if they have already provided a phone number.

Never fabricate tool results. If a tool call fails, report the actual error.`;

/** Settings UI / persisted config (API key, embedding model, LLM model, web search, MCP, transcription, agent). */
export interface PersistedConfig {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_EMBEDDING_MODEL: string;
  OPENAI_WEB_SEARCH: boolean;
  MCP_USE_SERVER_MANAGER: boolean;
  OPENAI_TRANSCRIPTION_MODEL: string;
  AGENT_NAME: string;
  AGENT_INSTRUCTIONS: string;
}

/** Full config: persisted + PORT from env. */
export interface AppConfig extends PersistedConfig {
  PORT: number;
}

const DEFAULTS: PersistedConfig = {
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.2",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_WEB_SEARCH: false,
  MCP_USE_SERVER_MANAGER: false,
  OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-transcribe",
  AGENT_NAME: "Hooman",
  AGENT_INSTRUCTIONS: DEFAULT_AGENT_INSTRUCTIONS,
};

let store: PersistedConfig = { ...DEFAULTS };
let channelsStore: ChannelsConfig = {};

export function getConfig(): AppConfig {
  return { ...store, PORT: env.PORT };
}

export function updateConfig(patch: Partial<PersistedConfig>): PersistedConfig {
  if (patch.OPENAI_API_KEY !== undefined)
    store.OPENAI_API_KEY = String(patch.OPENAI_API_KEY);
  if (patch.OPENAI_MODEL !== undefined)
    store.OPENAI_MODEL =
      String(patch.OPENAI_MODEL).trim() || DEFAULTS.OPENAI_MODEL;
  if (patch.OPENAI_EMBEDDING_MODEL !== undefined)
    store.OPENAI_EMBEDDING_MODEL =
      String(patch.OPENAI_EMBEDDING_MODEL).trim() ||
      DEFAULTS.OPENAI_EMBEDDING_MODEL;
  if (patch.OPENAI_WEB_SEARCH !== undefined)
    store.OPENAI_WEB_SEARCH = Boolean(patch.OPENAI_WEB_SEARCH);
  if (patch.MCP_USE_SERVER_MANAGER !== undefined)
    store.MCP_USE_SERVER_MANAGER = Boolean(patch.MCP_USE_SERVER_MANAGER);
  if (patch.OPENAI_TRANSCRIPTION_MODEL !== undefined)
    store.OPENAI_TRANSCRIPTION_MODEL =
      String(patch.OPENAI_TRANSCRIPTION_MODEL).trim() ||
      DEFAULTS.OPENAI_TRANSCRIPTION_MODEL;
  if (patch.AGENT_NAME !== undefined)
    store.AGENT_NAME = String(patch.AGENT_NAME).trim() || DEFAULTS.AGENT_NAME;
  if (patch.AGENT_INSTRUCTIONS !== undefined)
    store.AGENT_INSTRUCTIONS =
      String(patch.AGENT_INSTRUCTIONS).trim() || DEFAULTS.AGENT_INSTRUCTIONS;
  persist().catch((err) => debug("persist error: %o", err));
  return { ...store };
}

export function getChannelsConfig(): ChannelsConfig {
  return { ...channelsStore };
}

export function updateChannelsConfig(
  patch: Partial<ChannelsConfig>,
): ChannelsConfig {
  if (patch.slack !== undefined) channelsStore.slack = patch.slack;
  if (patch.email !== undefined) channelsStore.email = patch.email;
  if (patch.whatsapp !== undefined) channelsStore.whatsapp = patch.whatsapp;
  persist().catch((err) => debug("persist error: %o", err));
  return getChannelsConfig();
}

async function persist(): Promise<void> {
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(WORKSPACE_ROOT, { recursive: true });
    const blob = { ...store, channels: channelsStore };
    await writeFile(CONFIG_PATH, JSON.stringify(blob, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

export async function loadPersisted(): Promise<void> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedConfig> & {
      channels?: ChannelsConfig;
    };
    if (parsed && typeof parsed === "object") {
      if (parsed.OPENAI_API_KEY !== undefined)
        store.OPENAI_API_KEY = String(parsed.OPENAI_API_KEY);
      if (parsed.OPENAI_MODEL !== undefined)
        store.OPENAI_MODEL =
          String(parsed.OPENAI_MODEL).trim() || DEFAULTS.OPENAI_MODEL;
      if (parsed.OPENAI_EMBEDDING_MODEL !== undefined)
        store.OPENAI_EMBEDDING_MODEL =
          String(parsed.OPENAI_EMBEDDING_MODEL).trim() ||
          DEFAULTS.OPENAI_EMBEDDING_MODEL;
      if (parsed.OPENAI_WEB_SEARCH !== undefined)
        store.OPENAI_WEB_SEARCH = Boolean(parsed.OPENAI_WEB_SEARCH);
      if (parsed.MCP_USE_SERVER_MANAGER !== undefined)
        store.MCP_USE_SERVER_MANAGER = Boolean(parsed.MCP_USE_SERVER_MANAGER);
      if (parsed.OPENAI_TRANSCRIPTION_MODEL !== undefined)
        store.OPENAI_TRANSCRIPTION_MODEL =
          String(parsed.OPENAI_TRANSCRIPTION_MODEL).trim() ||
          DEFAULTS.OPENAI_TRANSCRIPTION_MODEL;
      if (parsed.AGENT_NAME !== undefined)
        store.AGENT_NAME =
          String(parsed.AGENT_NAME).trim() || DEFAULTS.AGENT_NAME;
      if (parsed.AGENT_INSTRUCTIONS !== undefined)
        store.AGENT_INSTRUCTIONS =
          String(parsed.AGENT_INSTRUCTIONS).trim() ||
          DEFAULTS.AGENT_INSTRUCTIONS;
      if (parsed.channels && typeof parsed.channels === "object")
        channelsStore = { ...parsed.channels };
    }
  } catch {
    // no file or invalid
  }
}
