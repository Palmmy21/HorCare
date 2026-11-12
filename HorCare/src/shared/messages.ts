// LINE inbox — conversations between a property and its tenants over the tenant LINE OA.
// Stored per property so a conversation never crosses properties:
//   users/{owner}/buildings/{b}/line_threads/{lineUserId}
//   users/{owner}/buildings/{b}/line_threads/{lineUserId}/messages/{id}

export type MessageDirection = 'in' | 'out';
export type MessageKind = 'text' | 'sticker' | 'image' | 'audio' | 'video' | 'file' | 'location';

/** Files from tenants (photos, voice messages) are kept in Firestore chunks; the message only describes them. */
export interface MessageMedia {
  content_type: string;
  size: number;
  /** Number of base64 chunks stored under the message (see api/_line-media.ts). */
  chunks: number;
  /** The stored file is a still picture of a video that was too large to keep. */
  preview?: boolean;
}

/** A place the tenant shared from LINE's map. */
export interface MessageLocation { title?: string; address?: string; lat: number; lng: number }

export interface LineThread {
  /** The tenant's LINE user id (also the document id). */
  line_user_id: string;
  room_id: string;
  room_number: string;
  /** From the tenant profile at the time of the last message; may be null. */
  tenant_name: string | null;
  last_message_text: string;
  last_message_at: string;
  last_direction: MessageDirection;
  /** Messages from the tenant the property has not opened yet. */
  unread_count: number;
  /** When the tenant was last sent the automatic "we got your message" reply. */
  last_ack_at: string | null;
  /** Last press of "ขอความช่วยเหลือ": the conversation is flagged while it has unread messages. */
  help_requested_at?: string;
}

/** Waiting for a person after the tenant asked for help (and nobody has read it since). */
export const needsHelp = (t: Pick<LineThread, 'help_requested_at' | 'unread_count'>): boolean => !!t.help_requested_at && t.unread_count > 0;

export interface LineMessage {
  id: string;
  direction: MessageDirection;
  kind: MessageKind;
  text: string;
  at: string;
  /** For outgoing messages: who sent it (display name). */
  by: string | null;
  /** Present for stored photos, voice messages, videos and files. */
  media?: MessageMedia;
  location?: MessageLocation;
  /** LINE sticker ids: enough to show the sticker's picture. */
  sticker?: { package_id: string; sticker_id: string };
  /** The name the tenant's file had. */
  file_name?: string;
  /** Length of a voice message or video. */
  duration_ms?: number;
}

/** Where a shared place opens on a map. */
export const mapUrl = (l: Pick<MessageLocation, 'lat' | 'lng'>): string => `https://www.google.com/maps?q=${l.lat},${l.lng}`;
/** A LINE sticker's picture (static; animated stickers show their first frame). */
export const stickerUrl = (stickerId: string): string => `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(stickerId)}/android/sticker.png`;

/** "1.4 MB", "320 KB". */
export function fileSizeText(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export const MAX_OUTGOING_CHARS = 1000;
export const MAX_INCOMING_CHARS = 2000;
