import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createClientMessageId } from '../ids';
import type {
  PresenceChangedEventPayload,
  PresenceSubscriptionData,
  ReceiptUpdatedEventPayload,
  RealtimeAck,
  TypingStartedEventPayload,
  TypingStoppedEventPayload,
} from '../protocol';
import { errorMessage } from './errors';
import { useRealtime } from './RealtimeProvider';
import { useSession } from './SessionProvider';
import { colors } from './theme';
import type {
  Conversation,
  Message,
  MessageHistoryResponse,
  ReceiptFrontier,
  ReceiptFrontiersResponse,
  ReceiptUpdateResponse,
} from './types';
import { Avatar, Button, ConnectionPill, Notice, ui } from './ui';

interface ChatMessage extends Message {
  localStatus?: 'sending' | 'failed';
  failure?: string;
}

export function ChatScreen({
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const { request, session } = useSession();
  const { socket, status, reconcileVersion } = useRealtime();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<Map<string, ReceiptFrontier>>(
    () => new Map(),
  );
  const [composer, setComposer] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherPresence, setOtherPresence] = useState<'online' | 'offline'>(
    'offline',
  );
  const [otherTyping, setOtherTyping] = useState(false);
  const [appIsActive, setAppIsActive] = useState(
    AppState.currentState === 'active',
  );
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const lastReadMessageIdRef = useRef<string | null>(null);
  const typingExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const userId = session?.user.id ?? '';
  const otherUserId = conversation.otherParticipant.id;
  const conversationId = conversation.id;
  const isComposing = composer.trim().length > 0;

  const showOtherTypingUntil = useCallback((expiresAt: string) => {
    if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
    const delay = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    setOtherTyping(delay > 0);
    typingExpiryRef.current = setTimeout(() => {
      setOtherTyping(false);
      typingExpiryRef.current = null;
    }, delay);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const reconcile = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const [history, receiptResponse] = await Promise.all([
          request<MessageHistoryResponse>({
            path: `/conversations/${conversationId}/messages?limit=100`,
          }),
          request<ReceiptFrontiersResponse>({
            path: `/conversations/${conversationId}/receipts`,
          }),
        ]);
        if (!mountedRef.current) return;
        setMessages((current) => mergeMessages(current, history.items));
        if (showLoading) {
          setNextCursor(history.pageInfo.nextCursor);
          setHasNextPage(history.pageInfo.hasNextPage);
        }
        setReceipts((current) =>
          mergeReceiptFrontiers(current, receiptResponse.items),
        );
        if (showLoading) {
          requestAnimationFrame(() =>
            listRef.current?.scrollToEnd({ animated: false }),
          );
        }
      } catch (requestError) {
        if (mountedRef.current) setError(errorMessage(requestError));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [conversationId, request],
  );

  useEffect(() => {
    mountedRef.current = true;
    void reconcile(true);
    return () => {
      mountedRef.current = false;
    };
  }, [reconcile]);

  useEffect(() => {
    if (reconcileVersion > 1) void reconcile(false);
  }, [reconcile, reconcileVersion]);

  useEffect(() => {
    if (!socket) return;
    let active = true;

    const subscribe = () => {
      socket.emit(
        'presence.subscribe',
        { conversationId },
        (response: RealtimeAck<PresenceSubscriptionData>) => {
          if (!active || !response.ok) return;
          const participant = response.data.participants.find(
            (item) => item.userId === otherUserId,
          );
          setOtherPresence(participant?.status ?? 'offline');
          const typing = response.data.typing.find(
            (item) => item.userId === otherUserId,
          );
          if (typing) showOtherTypingUntil(typing.expiresAt);
          else setOtherTyping(false);
        },
      );
    };

    const onMessage = (message: Message) => {
      if (message.conversationId !== conversationId) return;
      setMessages((current) => mergeMessages(current, [message]));
      requestAnimationFrame(() =>
        listRef.current?.scrollToEnd({ animated: true }),
      );
    };
    const onReceipt = (event: ReceiptUpdatedEventPayload) => {
      if (event.conversationId !== conversationId) return;
      setReceipts((current) => applyReceiptEvent(current, event));
    };
    const onPresence = (event: PresenceChangedEventPayload) => {
      if (
        event.conversationId === conversationId &&
        event.userId === otherUserId
      ) {
        setOtherPresence(event.status);
      }
    };
    const onTypingStarted = (event: TypingStartedEventPayload) => {
      if (
        event.conversationId === conversationId &&
        event.userId === otherUserId
      ) {
        showOtherTypingUntil(event.expiresAt);
      }
    };
    const onTypingStopped = (event: TypingStoppedEventPayload) => {
      if (
        event.conversationId === conversationId &&
        event.userId === otherUserId
      ) {
        if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
        typingExpiryRef.current = null;
        setOtherTyping(false);
      }
    };
    const onDisconnect = () => {
      if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
      typingExpiryRef.current = null;
      setOtherPresence('offline');
      setOtherTyping(false);
    };

    socket.on('connect', subscribe);
    socket.on('message.created', onMessage);
    socket.on('receipt.delivered', onReceipt);
    socket.on('receipt.read', onReceipt);
    socket.on('presence.changed', onPresence);
    socket.on('typing.started', onTypingStarted);
    socket.on('typing.stopped', onTypingStopped);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) subscribe();

    return () => {
      active = false;
      if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
      typingExpiryRef.current = null;
      setOtherPresence('offline');
      setOtherTyping(false);
      socket.off('connect', subscribe);
      socket.off('message.created', onMessage);
      socket.off('receipt.delivered', onReceipt);
      socket.off('receipt.read', onReceipt);
      socket.off('presence.changed', onPresence);
      socket.off('typing.started', onTypingStarted);
      socket.off('typing.stopped', onTypingStopped);
      socket.off('disconnect', onDisconnect);
      if (socket.connected) {
        socket.emit('presence.unsubscribe', { conversationId }, () => undefined);
      }
    };
  }, [conversationId, otherUserId, showOtherTypingUntil, socket]);

  useEffect(() => {
    if (!socket || status !== 'connected' || !isComposing) return;

    const start = () => {
      if (socket.connected) {
        socket.volatile.emit('typing.start', { conversationId }, () => undefined);
      }
    };
    start();
    const timer = setInterval(start, 3_000);
    return () => {
      clearInterval(timer);
      if (socket.connected) {
        socket.volatile.emit('typing.stop', { conversationId }, () => undefined);
      }
    };
  }, [conversationId, isComposing, socket, status]);

  useEffect(() => {
    const latestIncoming = [...messages]
      .reverse()
      .find((message) => message.senderId !== userId && !message.localStatus);
    if (
      !appIsActive ||
      !latestIncoming ||
      lastReadMessageIdRef.current === latestIncoming.id
    ) {
      return;
    }

    lastReadMessageIdRef.current = latestIncoming.id;
    void request<ReceiptUpdateResponse>({
      path: `/conversations/${conversationId}/receipts/read`,
      method: 'PUT',
      body: { throughMessageId: latestIncoming.id },
    })
      .then((response) => {
        setReceipts((current) =>
          mergeReceiptFrontiers(current, [
            {
            userId,
            version: response.version,
            delivered: response.delivered,
            read: response.read,
            },
          ]),
        );
      })
      .catch(() => {
        lastReadMessageIdRef.current = null;
      });
  }, [appIsActive, conversationId, messages, request, userId]);

  const loadOlder = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const response = await request<MessageHistoryResponse>({
        path: `/conversations/${conversationId}/messages?limit=100&cursor=${encodeURIComponent(nextCursor)}`,
      });
      if (!mountedRef.current) return;
      setMessages((current) => mergeMessages(current, response.items));
      setNextCursor(response.pageInfo.nextCursor);
      setHasNextPage(response.pageInfo.hasNextPage);
    } catch (requestError) {
      if (mountedRef.current) setError(errorMessage(requestError));
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  };

  const sendWithId = async (clientMessageId: string, text: string) => {
    setSending(true);
    setError(null);
    setMessages((current) =>
      current.map((message) =>
        message.clientMessageId === clientMessageId && message.localStatus
          ? { ...message, localStatus: 'sending', failure: undefined }
          : message,
      ),
    );
    try {
      const response = await request<Message>({
        path: `/conversations/${conversationId}/messages`,
        method: 'POST',
        body: { clientMessageId, text },
      });
      if (!mountedRef.current) return;
      setMessages((current) => mergeMessages(current, [response]));
    } catch (requestError) {
      if (!mountedRef.current) return;
      const failure = errorMessage(requestError);
      setMessages((current) =>
        current.map((message) =>
          message.clientMessageId === clientMessageId && message.localStatus
            ? { ...message, localStatus: 'failed', failure }
            : message,
        ),
      );
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const send = () => {
    const text = composer.trim();
    if (!text || sending || !userId) return;
    const clientMessageId = createClientMessageId();
    const optimistic: ChatMessage = {
      id: `local-${clientMessageId}`,
      conversationId,
      clientMessageId,
      senderId: userId,
      kind: 'text',
      text,
      createdAt: new Date().toISOString(),
      localStatus: 'sending',
    };
    setComposer('');
    setMessages((current) => mergeMessages(current, [optimistic]));
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    void sendWithId(clientMessageId, text);
  };

  const otherReceipt = receipts.get(otherUserId);
  const latestOutgoingId = useMemo(
    () => [...messages].reverse().find((message) => message.senderId === userId)?.id,
    [messages, userId],
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={ui.flex}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to conversations"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && ui.pressed]}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Avatar
            name={conversation.otherParticipant.displayName}
            size={40}
            uri={conversation.otherParticipant.avatarUrl}
          />
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.headerName}>
              {conversation.otherParticipant.displayName ?? 'Unnamed user'}
            </Text>
            <Text style={styles.presence}>
              {otherTyping
                ? 'typing…'
                : otherPresence === 'online'
                  ? 'online'
                  : 'offline'}
            </Text>
          </View>
          <ConnectionPill status={status} />
        </View>

        {error ? (
          <View style={styles.noticeWrap}>
            <Notice tone="error">{error}</Notice>
          </View>
        ) : null}

        {loading && messages.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading messages…</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            contentContainerStyle={styles.messages}
            data={messages}
            keyExtractor={(item) => item.id}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            renderItem={({ item }) => {
              const outgoing = item.senderId === userId;
              const receipt =
                outgoing && item.id === latestOutgoingId && !item.localStatus
                  ? receiptState(item, messages, otherReceipt)
                  : null;
              return (
                <MessageBubble
                  message={item}
                  outgoing={outgoing}
                  receipt={receipt}
                  onRetry={() => void sendWithId(item.clientMessageId, item.text)}
                />
              );
            }}
            ListHeaderComponent={
              hasNextPage ? (
                <Button
                  busy={loadingOlder}
                  compact
                  label="Load older messages"
                  onPress={() => void loadOlder()}
                  variant="secondary"
                  style={styles.loadOlder}
                />
              ) : messages.length > 0 ? (
                <Text style={styles.conversationStart}>Beginning of conversation</Text>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Say hello</Text>
                <Text style={styles.emptyBody}>
                  Messages are stored through REST and delivered live over Socket.IO.
                </Text>
              </View>
            }
          />
        )}

        <View style={styles.composerRow}>
          <TextInput
            maxLength={4000}
            multiline
            onChangeText={setComposer}
            onSubmitEditing={() => {
              if (Platform.OS !== 'ios') send();
            }}
            placeholder="Message"
            placeholderTextColor={colors.textSubtle}
            selectionColor={colors.primary}
            style={styles.composer}
            value={composer}
          />
          <Pressable
            accessibilityLabel="Send message"
            accessibilityRole="button"
            disabled={!composer.trim() || sending}
            onPress={send}
            style={({ pressed }) => [
              styles.sendButton,
              pressed && ui.pressed,
              (!composer.trim() || sending) && ui.disabled,
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.black} size="small" />
            ) : (
              <Text style={styles.sendText}>↑</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({
  message,
  outgoing,
  receipt,
  onRetry,
}: {
  message: ChatMessage;
  outgoing: boolean;
  receipt: 'Sent' | 'Delivered' | 'Read' | null;
  onRetry: () => void;
}) {
  const failed = message.localStatus === 'failed';
  return (
    <Pressable
      disabled={!failed}
      onPress={onRetry}
      style={[styles.bubbleGroup, outgoing ? styles.outgoingGroup : styles.incomingGroup]}
    >
      <View
        style={[
          styles.bubble,
          outgoing ? styles.outgoingBubble : styles.incomingBubble,
          failed && styles.failedBubble,
        ]}
      >
        <Text style={[styles.messageText, outgoing && styles.outgoingText]}>
          {message.text}
        </Text>
      </View>
      <Text style={[styles.messageMeta, outgoing && styles.outgoingMeta]}>
        {shortMessageTime(message.createdAt)}
        {message.localStatus === 'sending' ? ' · Sending…' : ''}
        {failed ? ' · Failed — tap to retry' : ''}
        {receipt ? ` · ${receipt}` : ''}
      </Text>
      {failed && message.failure ? (
        <Text numberOfLines={1} style={styles.failureText}>
          {message.failure}
        </Text>
      ) : null}
    </Pressable>
  );
}

function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byClientId = new Map<string, ChatMessage>();
  for (const message of [...current, ...incoming]) {
    const key = `${message.senderId}:${message.clientMessageId}`;
    const existing = byClientId.get(key);
    if (!existing || (existing.localStatus && !message.localStatus)) {
      byClientId.set(key, message);
    }
  }

  return [...byClientId.values()].sort((left, right) => {
    const timeDifference =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

function mergeReceiptFrontiers(
  current: Map<string, ReceiptFrontier>,
  incoming: ReceiptFrontier[],
): Map<string, ReceiptFrontier> {
  let changed = false;
  const next = new Map(current);
  for (const frontier of incoming) {
    const existing = next.get(frontier.userId);
    if (!existing || frontier.version > existing.version) {
      next.set(frontier.userId, frontier);
      changed = true;
    }
  }
  return changed ? next : current;
}

function applyReceiptEvent(
  current: Map<string, ReceiptFrontier>,
  event: ReceiptUpdatedEventPayload,
): Map<string, ReceiptFrontier> {
  const existing = current.get(event.userId);
  if (existing && existing.version >= event.version) return current;
  const next = new Map(current);
  next.set(event.userId, {
    userId: event.userId,
    version: event.version,
    delivered: event.delivered,
    read: event.read,
  });
  return next;
}

function receiptState(
  message: ChatMessage,
  messages: ChatMessage[],
  frontier: ReceiptFrontier | undefined,
): 'Sent' | 'Delivered' | 'Read' {
  if (!frontier) return 'Sent';
  const messageIndex = messages.findIndex((item) => item.id === message.id);
  const readIndex = messages.findIndex((item) => item.id === frontier.read?.messageId);
  const deliveredIndex = messages.findIndex(
    (item) => item.id === frontier.delivered?.messageId,
  );
  if (readIndex >= messageIndex && readIndex >= 0) return 'Read';
  if (deliveredIndex >= messageIndex && deliveredIndex >= 0) return 'Delivered';
  return 'Sent';
}

function shortMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 65,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 32,
  },
  backText: { color: colors.text, fontSize: 38, fontWeight: '300', lineHeight: 38 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  presence: { color: colors.success, fontSize: 11, marginTop: 3 },
  noticeWrap: { paddingHorizontal: 12, paddingTop: 8 },
  loading: { alignItems: 'center', flex: 1, gap: 11, justifyContent: 'center' },
  loadingText: { color: colors.textMuted, fontSize: 12 },
  messages: { flexGrow: 1, paddingHorizontal: 12, paddingVertical: 16 },
  loadOlder: { alignSelf: 'center', marginBottom: 18 },
  conversationStart: {
    color: colors.textSubtle,
    fontSize: 10,
    marginBottom: 20,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 35 },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  bubbleGroup: { marginBottom: 10, maxWidth: '82%' },
  outgoingGroup: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  incomingGroup: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  outgoingBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  incomingBubble: {
    backgroundColor: colors.surfaceRaised,
    borderBottomLeftRadius: 5,
  },
  failedBubble: { borderColor: colors.danger, borderWidth: 1 },
  messageText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  outgoingText: { color: colors.black },
  messageMeta: { color: colors.textSubtle, fontSize: 9, marginTop: 4 },
  outgoingMeta: { textAlign: 'right' },
  failureText: { color: colors.danger, fontSize: 9, marginTop: 2, maxWidth: 240 },
  composerRow: {
    alignItems: 'flex-end',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  composer: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendText: { color: colors.black, fontSize: 23, fontWeight: '900' },
});
