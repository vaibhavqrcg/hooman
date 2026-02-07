/**
 * WhatsApp connection status type. Connection state is held by the WhatsApp worker
 * and read by the API via Redis RPC (hooman:whatsapp:connection:request/response).
 */
export type WhatsAppConnectionStatus = "disconnected" | "pairing" | "connected";

export interface WhatsAppConnection {
  status: WhatsAppConnectionStatus;
  qr?: string;
  /** Current user's WhatsApp ID (e.g. 1234567890@c.us). */
  selfId?: string;
  /** Display number (e.g. +1234567890). */
  selfNumber?: string;
}
