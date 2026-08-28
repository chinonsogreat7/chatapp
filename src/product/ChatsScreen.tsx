import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { errorMessage } from './errors';
import { useRealtime } from './RealtimeProvider';
import { useSession } from './SessionProvider';
import { colors } from './theme';
import type { Conversation, ConversationListResponse } from './types';
import { Avatar, Button, ConnectionPill, EmptyState, Notice, ui } from './ui';

export function ChatsScreen({
  onOpen,
  onFindPeople,
}: {
  onOpen: (conversation: Conversation) => void;
  onFindPeople: () => void;
}) {
  const { request, session } = useSession();
  const { activityVersion, reconcileVersion, status } = useRealtime();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const deliveredBoundaryRef = useRef(new Map<string, string>());

  const load = useCallback(
    async (kind: 'initial' | 'refresh' | 'background' = 'initial') => {
      const requestId = ++requestIdRef.current;
      if (kind === 'initial') setLoading(true);
      if (kind === 'refresh') setRefreshing(true);
      if (kind !== 'background') setError(null);
      try {
        const response = await request<ConversationListResponse>({
          path: '/conversations?limit=50',
        });
        if (requestId === requestIdRef.current) {
          setItems(response.items);
          setError(null);
        }
        for (const conversation of response.items) {
          const latest = conversation.latestMessage;
          if (
            !latest ||
            latest.senderId === session?.user.id ||
            deliveredBoundaryRef.current.get(conversation.id) === latest.id
          ) {
            continue;
          }
          deliveredBoundaryRef.current.set(conversation.id, latest.id);
          void request({
            path: `/conversations/${conversation.id}/receipts/delivered`,
            method: 'PUT',
            body: { throughMessageId: latest.id },
          }).catch(() => {
            if (deliveredBoundaryRef.current.get(conversation.id) === latest.id) {
              deliveredBoundaryRef.current.delete(conversation.id);
            }
          });
        }
      } catch (requestError) {
        if (requestId === requestIdRef.current && kind !== 'background') {
          setError(errorMessage(requestError));
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [request, session?.user.id],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  useEffect(() => {
    if (loading || (activityVersion === 0 && reconcileVersion === 0)) return;
    const timer = setTimeout(() => void load('background'), 350);
    return () => clearTimeout(timer);
  }, [activityVersion, load, loading, reconcileVersion]);

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>Loading conversations…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.greeting}>
            Hey, {firstName(session?.user.displayName)}
          </Text>
          <Text style={styles.title}>Messages</Text>
        </View>
        <ConnectionPill status={status} />
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <Notice tone="error">{error}</Notice>
          <Button compact label="Retry" onPress={() => void load()} variant="secondary" />
        </View>
      ) : null}

      <FlatList
        contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            onRefresh={() => void load('refresh')}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <ConversationRow conversation={item} onPress={() => onOpen(item)} />
        )}
        ListEmptyComponent={
          error ? null : <EmptyState
            action={
              <Button
                compact
                label="Find someone"
                onPress={onFindPeople}
              />
            }
            body="Search by display name or match your contacts to start a direct conversation."
            title="No conversations yet"
          />
        }
      />
    </View>
  );
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: Conversation;
  onPress: () => void;
}) {
  const participant = conversation.otherParticipant;
  const unread = conversation.unreadCount > 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && ui.pressed]}
    >
      <Avatar name={participant.displayName} uri={participant.avatarUrl} />
      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.name, unread && styles.nameUnread]}>
            {participant.displayName ?? 'Unnamed user'}
          </Text>
          <Text style={[styles.time, unread && styles.timeUnread]}>
            {shortTime(conversation.lastActivityAt)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            numberOfLines={1}
            style={[styles.preview, unread && styles.previewUnread]}
          >
            {conversation.latestMessage?.preview ?? 'Start the conversation'}
          </Text>
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || 'there';
}

function shortTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  center: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  loadingText: { color: colors.textMuted, fontSize: 13 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 18,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 10 },
  greeting: { color: colors.textMuted, fontSize: 12, marginBottom: 3 },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  errorWrap: { gap: 9, paddingHorizontal: 18, paddingBottom: 10 },
  list: { paddingBottom: 24, paddingHorizontal: 10 },
  emptyList: { flexGrow: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 13,
    minHeight: 78,
    paddingHorizontal: 8,
    paddingVertical: 13,
  },
  rowCopy: { flex: 1, gap: 7, minWidth: 0 },
  rowTop: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  rowBottom: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  name: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '700' },
  nameUnread: { fontWeight: '900' },
  time: { color: colors.textSubtle, fontSize: 11 },
  timeUnread: { color: colors.primary, fontWeight: '800' },
  preview: { color: colors.textSubtle, flex: 1, fontSize: 13 },
  previewUnread: { color: colors.textMuted, fontWeight: '700' },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 20,
    minWidth: 20,
    paddingHorizontal: 5,
  },
  badgeText: { color: colors.black, fontSize: 10, fontWeight: '900' },
});
