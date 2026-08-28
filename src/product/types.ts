import type { MessageCreatedEventPayload } from '../protocol';

export interface ApiErrorBody {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
  path?: string;
  timestamp?: string;
}

export interface User {
  id: string;
  phoneNumber: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileComplete: boolean;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OtpChallenge {
  challengeId: string;
  phoneNumberMasked: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  codeLength: number;
}

export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresInSeconds: number;
  user: User;
}

export interface Session {
  accessToken: string;
  accessTokenIssuedAt: number;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  user: User;
}

export interface ConversationLatestMessage {
  id: string;
  senderId: string;
  kind: 'text';
  preview: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  type: 'direct';
  otherParticipant: PublicUser;
  latestMessage: ConversationLatestMessage | null;
  unreadCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  items: Conversation[];
  pageInfo: PageInfo;
}

export interface PageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
}

export type Message = MessageCreatedEventPayload;

export interface MessageHistoryResponse {
  items: Message[];
  pageInfo: PageInfo;
}

export interface ReceiptBoundary {
  messageId: string;
  at: string;
}

export interface ReceiptFrontier {
  userId: string;
  version: number;
  delivered: ReceiptBoundary | null;
  read: ReceiptBoundary | null;
}

export interface ReceiptFrontiersResponse {
  conversationId: string;
  items: ReceiptFrontier[];
}

export interface ReceiptUpdateResponse {
  conversationId: string;
  status: 'delivered' | 'read';
  throughMessageId: string;
  at: string;
  changed: boolean;
  unreadCount: number;
  version: number;
  delivered: ReceiptBoundary;
  read: ReceiptBoundary | null;
}

export interface UserSearchResponse {
  items: PublicUser[];
  nextCursor: string | null;
}

export interface ContactMatch {
  matchedPhoneNumber: string;
  user: PublicUser;
}

export interface ContactMatchesResponse {
  matches: ContactMatch[];
}
