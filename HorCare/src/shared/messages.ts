// LINE inbox — conversations between a property and its tenants over the tenant LINE OA.
// Stored per property so a conversation never crosses properties:
//   users/{owner}/buildings/{b}/line_threads/{lineUserId}
//   users/{owner}/buildings/{b}/line_threads/{lineUserId}/messages/{id}

export type MessageDirection = 'in' | 'out';
export type MessageKind = 'text' | 'sticker' | 'image' | 'audio' | 'video' | 'file';

/** Files from tenants (photos, voice messages) live in Cloud Storage; the message only points at them. */
export interface MessageMedia {
  path: string;
  content_type: string;
  size: number;
}

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
}

export interface LineMessage {
  id: string;
  direction: MessageDirection;
  kind: MessageKind;
  text: string;
  at: string;
  /** For outgoing messages: who sent it (display name). */
  by: string | null;
  /** Present for stored photos / voice messages. */
  media?: MessageMedia;
}

export const MAX_OUTGOING_CHARS = 1000;
export const MAX_INCOMING_CHARS = 2000;
