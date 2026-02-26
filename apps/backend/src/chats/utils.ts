import type { FilePart, ImagePart, TextPart } from "ai";

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
