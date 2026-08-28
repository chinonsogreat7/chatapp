import type { Socket } from 'socket.io-client';

export type RealtimeErrorCode =
  | 'AUTH_ACCESS_TOKEN_INVALID'
  | 'REALTIME_PAYLOAD_INVALID'
  | 'REALTIME_CONVERSATION_NOT_FOUND'
  | 'REALTIME_RATE_LIMITED'
  | 'REALTIME_INTERNAL_ERROR';

export type RealtimeAck<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: RealtimeErrorCode;
        message: string;
      };
    };

export interface ConversationCommandPayload {
  conversationId: string;
}

export interface PresenceParticipantState {
  userId: string;
  status: 'online' | 'offline';
}

export interface PresenceSubscriptionData {
  conversationId: string;
  participants: PresenceParticipantState[];
  typing: Array<{
    userId: string;
    expiresAt: string;
  }>;
}

export interface PresenceUnsubscriptionData {
  conversationId: string;
}

export interface TypingStartedData {
  conversationId: string;
  expiresAt: string;
}

export interface TypingStoppedData {
  conversationId: string;
}

export interface MessageCreatedEventPayload {
  id: string;
  conversationId: string;
  clientMessageId: string;
  senderId: string;
  kind: 'text';
  text: string;
  createdAt: string;
}

export interface ReceiptUpdatedEventPayload {
  conversationId: string;
  userId: string;
  throughMessageId: string;
  at: string;
  version: number;
  delivered: {
    messageId: string;
    at: string;
  };
  read: {
    messageId: string;
    at: string;
  } | null;
}

export interface PresenceChangedEventPayload {
  conversationId: string;
  userId: string;
  status: 'online' | 'offline';
  occurredAt: string;
}

export interface TypingStartedEventPayload {
  conversationId: string;
  userId: string;
  expiresAt: string;
}

export interface TypingStoppedEventPayload {
  conversationId: string;
  userId: string;
  occurredAt: string;
}

export interface ChatServerToClientEvents {
  'message.created': (payload: MessageCreatedEventPayload) => void;
  'receipt.delivered': (payload: ReceiptUpdatedEventPayload) => void;
  'receipt.read': (payload: ReceiptUpdatedEventPayload) => void;
  'presence.changed': (payload: PresenceChangedEventPayload) => void;
  'typing.started': (payload: TypingStartedEventPayload) => void;
  'typing.stopped': (payload: TypingStoppedEventPayload) => void;
}

export interface ChatClientToServerEvents {
  'presence.subscribe': (
    payload: ConversationCommandPayload,
    ack: (response: RealtimeAck<PresenceSubscriptionData>) => void,
  ) => void;
  'presence.unsubscribe': (
    payload: ConversationCommandPayload,
    ack: (response: RealtimeAck<PresenceUnsubscriptionData>) => void,
  ) => void;
  'typing.start': (
    payload: ConversationCommandPayload,
    ack: (response: RealtimeAck<TypingStartedData>) => void,
  ) => void;
  'typing.stop': (
    payload: ConversationCommandPayload,
    ack: (response: RealtimeAck<TypingStoppedData>) => void,
  ) => void;
}

export type ChatSocket = Socket<
  ChatServerToClientEvents,
  ChatClientToServerEvents
>;

export type RealtimeCommand = keyof ChatClientToServerEvents;
