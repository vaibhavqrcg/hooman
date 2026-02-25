import { readFile } from "fs/promises";
import { join } from "path";
import type { FilePart, ImagePart, TextPart } from "ai";
import createDebug from "debug";
import { BACKEND_ROOT } from "../env.js";
import type { ChannelsConfig } from "../types.js";

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type UserContentPart = TextPart | ImagePart | FilePart;

export interface UserContentAttachment {
  name: string;
  contentType: string;
  data: string;
}

/**
 * Build AI SDK user content parts (text + optional image/file attachments as data URLs).
 */
export function buildUserContentParts(
  text: string,
  attachments?: UserContentAttachment[],
): UserContentPart[] {
  const parts: UserContentPart[] = [{ type: "text", text }];
  if (attachments?.length) {
    for (const a of attachments) {
      const data = typeof a.data === "string" ? a.data.trim() : "";
      if (!data) continue;
      const contentType = a.contentType.toLowerCase().split(";")[0].trim();
      const dataUrl = `data:${contentType};base64,${data}`;
      if (
        IMAGE_MIME_TYPES.includes(
          contentType as (typeof IMAGE_MIME_TYPES)[number],
        )
      ) {
        parts.push({
          type: "image",
          image: dataUrl,
          mediaType: contentType,
        });
      } else {
        parts.push({
          type: "file",
          data: dataUrl,
          mediaType: contentType,
        });
      }
    }
  }
  return parts;
}

const debug = createDebug("hooman:prompts");

const PROMPTS_DIR = join(BACKEND_ROOT, "prompts");

interface PromptCache {
  defaultAgentInstructions?: string;
  staticAppend?: string;
  channelSlack?: string;
  channelWhatsapp?: string;
}

const cache: PromptCache = {};

async function loadOne(
  key: keyof PromptCache,
  filename: string,
): Promise<void> {
  const path = join(PROMPTS_DIR, filename);
  try {
    const content = await readFile(path, "utf-8");
    cache[key] = content;
    debug("loaded prompt %s from %s", key, path);
  } catch (err) {
    debug("prompt file not loaded %s: %o", path, err);
  }
}

/**
 * Load all prompt files from apps/backend/prompts/ into memory.
 * Call once at startup. Files are expected to exist.
 */
export async function loadPrompts(): Promise<void> {
  await Promise.all([
    loadOne("defaultAgentInstructions", "default-agent-instructions.md"),
    loadOne("staticAppend", "static-append.md"),
    loadOne("channelSlack", "channel-slack.md"),
    loadOne("channelWhatsapp", "channel-whatsapp.md"),
  ]);
}

export function getDefaultAgentInstructions(): string {
  return cache.defaultAgentInstructions ?? "";
}

export function getStaticAppend(): string {
  return cache.staticAppend ?? "";
}

export function getChannelSlackInstructions(): string {
  return cache.channelSlack ?? "";
}

export function getChannelWhatsAppInstructions(): string {
  return cache.channelWhatsapp ?? "";
}

/**
 * Full static instructions: base + channel-specific formatting (only for enabled channels).
 * Call with getChannelsConfig() from config to avoid circular dependency.
 */
export function getFullStaticAgentInstructionsAppend(
  channels: ChannelsConfig,
): string {
  let out = getStaticAppend();
  if (channels.slack?.enabled) {
    out += getChannelSlackInstructions();
  }
  if (channels.whatsapp?.enabled) {
    out += getChannelWhatsAppInstructions();
  }
  return out;
}

export interface BuildAgentSystemPromptParams {
  userInstructions: string;
  staticAppend: string;
  skillsSection: string;
  sessionId?: string;
}

/**
 * Build the full agent system prompt: user instructions + static append + skills section + optional session instructions.
 */
export function buildAgentSystemPrompt(
  params: BuildAgentSystemPromptParams,
): string {
  const { userInstructions, staticAppend, skillsSection, sessionId } = params;
  const sessionInstructions = sessionId
    ? `\n\nYour current sessionId is: ${sessionId}. Use this for session-scoped memory tools.\n`
    : "";
  return userInstructions + staticAppend + skillsSection + sessionInstructions;
}
