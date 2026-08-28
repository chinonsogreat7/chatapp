import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import { apiRequest, ApiRequestError, getSocketUrl } from './src/api';
import { createClientMessageId } from './src/ids';
import type {
  ChatSocket,
  RealtimeAck,
  RealtimeCommand,
} from './src/protocol';
import { styles } from './src/styles';

type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

type LogKind = 'system' | 'command' | 'event' | 'rest' | 'error';

interface LogEntry {
  id: number;
  kind: LogKind;
  label: string;
  payload?: unknown;
  timestamp: Date;
}

const DEFAULT_API_ORIGIN = 'https://chateo-lhuw.onrender.com';
const MAX_LOG_ENTRIES = 80;
const ACK_TIMEOUT_MS = 10_000;
const REST_TIMEOUT_MS = 30_000;

export default function App() {
  const [apiOrigin, setApiOrigin] = useState(DEFAULT_API_ORIGIN);
  const [accessToken, setAccessToken] = useState('');
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [messageText, setMessageText] = useState('Hello from Socket Lab');
  const [throughMessageId, setThroughMessageId] = useState('');
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected');
  const [socketId, setSocketId] = useState<string | null>(null);
  const [subscribedConversationId, setSubscribedConversationId] = useState<
    string | null
  >(null);
  const [isTyping, setIsTyping] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const socketRef = useRef<ChatSocket | null>(null);
  const logIdRef = useRef(0);
  const busyActionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const restAbortControllerRef = useRef<AbortController | null>(null);
  const restAbortReasonRef = useRef<'cancelled' | 'timeout' | null>(null);
  const conversationIdRef = useRef('');
  const connectedUserIdRef = useRef<string | null>(null);
  const acknowledgementTimersRef = useRef<
    Set<ReturnType<typeof setTimeout>>
  >(new Set());
  const typingExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const addLog = useCallback(
    (kind: LogKind, label: string, payload?: unknown) => {
      const entry: LogEntry = {
        id: ++logIdRef.current,
        kind,
        label,
        payload,
        timestamp: new Date(),
      };

      setLogs((current) => [entry, ...current].slice(0, MAX_LOG_ENTRIES));
    },
    [],
  );

  const releaseSocket = useCallback((socket: ChatSocket) => {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
  }, []);

  const clearTypingExpiry = useCallback(() => {
    if (typingExpiryTimerRef.current) {
      clearTimeout(typingExpiryTimerRef.current);
      typingExpiryTimerRef.current = null;
    }
  }, []);

  const clearAcknowledgementTimers = useCallback(() => {
    for (const timer of acknowledgementTimersRef.current) clearTimeout(timer);
    acknowledgementTimersRef.current.clear();
  }, []);

  const clearRealtimeBusyAction = useCallback(() => {
    if (!isRealtimeCommand(busyActionRef.current)) return;
    busyActionRef.current = null;
    setBusyAction(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    busyActionRef.current = null;
    connectedUserIdRef.current = null;
    setBusyAction(null);
    setConnectionState('disconnected');
    setSocketId(null);
    setSubscribedConversationId(null);
    setIsTyping(false);
    return () => {
      mountedRef.current = false;
      restAbortReasonRef.current = 'cancelled';
      restAbortControllerRef.current?.abort();
      restAbortControllerRef.current = null;
      clearAcknowledgementTimers();
      clearTypingExpiry();
      if (socketRef.current) releaseSocket(socketRef.current);
      socketRef.current = null;
    };
  }, [clearAcknowledgementTimers, clearTypingExpiry, releaseSocket]);

  function connectSocket() {
    if (busyActionRef.current) {
      addLog('error', 'Connection blocked', {
        message: `${busyActionRef.current} is still in progress.`,
      });
      return;
    }

    const token = accessToken.trim();
    if (!token) {
      addLog('error', 'Connection blocked', {
        message: 'Paste a current access token before connecting.',
      });
      return;
    }

    let socketUrl: string;
    try {
      socketUrl = getSocketUrl(apiOrigin);
    } catch (error) {
      addLog('error', 'Connection blocked', describeError(error));
      return;
    }

    clearAcknowledgementTimers();
    clearTypingExpiry();
    if (socketRef.current) releaseSocket(socketRef.current);

    setConnectionState('connecting');
    setSocketId(null);
    setSubscribedConversationId(null);
    setIsTyping(false);
    connectedUserIdRef.current = readJwtSubject(token);
    addLog('system', 'Connecting', { socketUrl });

    const socket: ChatSocket = io(socketUrl, {
      auth: { token },
      autoConnect: false,
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 20_000,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      setSocketId(socket.id ?? null);
      addLog('system', 'Socket connected', { socketId: socket.id });
    });

    socket.on('disconnect', (reason, details) => {
      setConnectionState(socket.active ? 'reconnecting' : 'disconnected');
      setSocketId(null);
      setSubscribedConversationId(null);
      setIsTyping(false);
      clearRealtimeBusyAction();
      clearAcknowledgementTimers();
      clearTypingExpiry();
      addLog('system', 'Socket disconnected', {
        reason,
        details: describeError(details),
      });
    });

    socket.on('connect_error', (error) => {
      setConnectionState(socket.active ? 'reconnecting' : 'disconnected');
      addLog('error', 'Socket connection error', describeError(error));
    });

    socket.on('message.created', (payload) => {
      const selectedConversationId = conversationIdRef.current;
      const connectedUserId = connectedUserIdRef.current;
      const isSelectedConversation =
        selectedConversationId.length > 0 &&
        payload.conversationId.toLowerCase() === selectedConversationId;
      const isIncoming =
        connectedUserId === null || payload.senderId !== connectedUserId;

      if (isSelectedConversation && isIncoming) {
        setThroughMessageId(payload.id);
      }
      addLog('event', 'message.created', payload);
    });
    socket.on('receipt.delivered', (payload) => {
      addLog('event', 'receipt.delivered', payload);
    });
    socket.on('receipt.read', (payload) => {
      addLog('event', 'receipt.read', payload);
    });
    socket.on('presence.changed', (payload) => {
      addLog('event', 'presence.changed', payload);
    });
    socket.on('typing.started', (payload) => {
      addLog('event', 'typing.started', payload);
    });
    socket.on('typing.stopped', (payload) => {
      addLog('event', 'typing.stopped', payload);
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setConnectionState('reconnecting');
      addLog('system', 'Reconnect attempt', { attempt });
    });
    socket.io.on('reconnect', (attempt) => {
      addLog('system', 'Socket reconnected', { attempt });
    });
    socket.io.on('reconnect_failed', () => {
      setConnectionState('disconnected');
      addLog('error', 'Socket reconnection failed');
    });

    socket.connect();
  }

  function disconnectSocket() {
    const socket = socketRef.current;
    if (!socket) return;

    addLog('system', 'Manual disconnect', { socketId: socket.id });
    clearAcknowledgementTimers();
    clearTypingExpiry();
    releaseSocket(socket);
    socketRef.current = null;
    setConnectionState('disconnected');
    setSocketId(null);
    setSubscribedConversationId(null);
    setIsTyping(false);
    clearRealtimeBusyAction();
    connectedUserIdRef.current = null;
  }

  function emitCommand(command: RealtimeCommand) {
    const socket = socketRef.current;
    const id =
      command === 'presence.subscribe'
        ? conversationId.trim()
        : (subscribedConversationId ?? conversationId.trim());

    if (!socket?.connected) {
      addLog('error', `${command} blocked`, {
        message: 'Connect the socket first.',
      });
      return;
    }
    if (!id) {
      addLog('error', `${command} blocked`, {
        message: 'Enter a conversation ID first.',
      });
      return;
    }
    if (busyActionRef.current) {
      addLog('error', `${command} blocked`, {
        message: `${busyActionRef.current} is still in progress.`,
      });
      return;
    }

    const payload = { conversationId: id };
    const emittedSocketId = socket.id;
    let settled = false;
    busyActionRef.current = command;
    setBusyAction(command);
    addLog('command', command, payload);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      acknowledgementTimersRef.current.delete(timeout);
      if (busyActionRef.current === command) busyActionRef.current = null;
      setBusyAction((current) => (current === command ? null : current));
      addLog('error', `${command} acknowledgement timed out`, {
        timeoutMs: ACK_TIMEOUT_MS,
      });
    }, ACK_TIMEOUT_MS);
    acknowledgementTimersRef.current.add(timeout);

    const finish = (ack: RealtimeAck<unknown>) => {
      if (
        settled ||
        socketRef.current !== socket ||
        socket.id !== emittedSocketId
      ) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      acknowledgementTimersRef.current.delete(timeout);
      if (busyActionRef.current === command) busyActionRef.current = null;
      setBusyAction((current) => (current === command ? null : current));
      addLog(ack.ok ? 'event' : 'error', `${command} acknowledgement`, ack);

      if (!ack.ok) return;
      if (command === 'presence.subscribe') {
        const canonicalId = readConversationId(ack.data) ?? id.toLowerCase();
        conversationIdRef.current = canonicalId;
        setConversationId(canonicalId);
        setSubscribedConversationId(canonicalId);
      }
      if (command === 'presence.unsubscribe') {
        setSubscribedConversationId(null);
        setIsTyping(false);
        clearTypingExpiry();
      }
      if (command === 'typing.start') {
        const expiresAt = readExpiresAt(ack.data);
        const parsedExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
        const delay = Number.isFinite(parsedExpiry)
          ? Math.max(0, parsedExpiry - Date.now())
          : 5_000;

        clearTypingExpiry();
        setIsTyping(true);
        typingExpiryTimerRef.current = setTimeout(() => {
          typingExpiryTimerRef.current = null;
          setIsTyping(false);
          addLog('system', 'Local typing badge expired', { expiresAt });
        }, delay + 100);
      }
      if (command === 'typing.stop') {
        clearTypingExpiry();
        setIsTyping(false);
      }
    };

    switch (command) {
      case 'presence.subscribe':
        socket.emit(command, payload, (ack) => finish(ack));
        break;
      case 'presence.unsubscribe':
        socket.emit(command, payload, (ack) => finish(ack));
        break;
      case 'typing.start':
        socket.emit(command, payload, (ack) => finish(ack));
        break;
      case 'typing.stop':
        socket.emit(command, payload, (ack) => finish(ack));
        break;
    }
  }

  async function runRestAction(
    action: string,
    request: {
      path: string;
      method?: 'GET' | 'POST' | 'PUT';
      body?: unknown;
    },
  ) {
    if (!accessToken.trim()) {
      addLog('error', `${action} blocked`, {
        message: 'Paste a current access token first.',
      });
      return;
    }
    if (busyActionRef.current) {
      addLog('error', `${action} blocked`, {
        message: `${busyActionRef.current} is still in progress.`,
      });
      return;
    }

    busyActionRef.current = action;
    setBusyAction(action);
    const abortController = new AbortController();
    restAbortControllerRef.current = abortController;
    restAbortReasonRef.current = null;
    const timeout = setTimeout(() => {
      if (restAbortControllerRef.current !== abortController) return;
      restAbortReasonRef.current = 'timeout';
      abortController.abort();
    }, REST_TIMEOUT_MS);
    addLog('rest', `${action} request`, {
      method: request.method ?? 'GET',
      path: `/v1${request.path}`,
      body: request.body,
    });

    try {
      const response = await apiRequest<unknown>({
        origin: apiOrigin,
        accessToken,
        signal: abortController.signal,
        ...request,
      });
      if (mountedRef.current) addLog('rest', `${action} response`, response);
    } catch (error) {
      if (mountedRef.current) {
        const abortReason = restAbortReasonRef.current;
        addLog(
          'error',
          abortReason === 'timeout'
            ? `${action} timed out`
            : abortReason === 'cancelled'
              ? `${action} cancelled`
              : `${action} failed`,
          abortReason
            ? abortReason === 'timeout'
              ? { timeoutMs: REST_TIMEOUT_MS }
              : { message: 'Cancelled by user.' }
            : describeError(error),
        );
      }
    } finally {
      clearTimeout(timeout);
      if (restAbortControllerRef.current === abortController) {
        restAbortControllerRef.current = null;
        restAbortReasonRef.current = null;
      }
      if (busyActionRef.current === action) busyActionRef.current = null;
      if (mountedRef.current) {
        setBusyAction((current) => (current === action ? null : current));
      }
    }
  }

  function cancelRestRequest() {
    const abortController = restAbortControllerRef.current;
    if (!abortController) return;
    restAbortReasonRef.current = 'cancelled';
    abortController.abort();
  }

  function requireConversationId(action: string): string | null {
    const id = conversationId.trim();
    if (id) return encodeURIComponent(id);

    addLog('error', `${action} blocked`, {
      message: 'Enter a conversation ID first.',
    });
    return null;
  }

  async function sendMessage() {
    const id = requireConversationId('Send message');
    const text = messageText.trim();
    if (!id) return;
    if (!text) {
      addLog('error', 'Send message blocked', {
        message: 'Enter message text first.',
      });
      return;
    }

    await runRestAction('Send message', {
      path: `/conversations/${id}/messages`,
      method: 'POST',
      body: {
        clientMessageId: createClientMessageId(),
        text,
      },
    });
  }

  async function loadHistory() {
    const id = requireConversationId('Load history');
    if (!id) return;
    await runRestAction('Load history', {
      path: `/conversations/${id}/messages?limit=20`,
    });
  }

  async function loadReceipts() {
    const id = requireConversationId('Load receipts');
    if (!id) return;
    await runRestAction('Load receipts', {
      path: `/conversations/${id}/receipts`,
    });
  }

  async function updateReceipt(kind: 'delivered' | 'read') {
    const action = kind === 'delivered' ? 'Mark delivered' : 'Mark read';
    const id = requireConversationId(action);
    const messageId = throughMessageId.trim();
    if (!id) return;
    if (!messageId) {
      addLog('error', `${action} blocked`, {
        message: 'Enter an incoming server message ID first.',
      });
      return;
    }

    await runRestAction(action, {
      path: `/conversations/${id}/receipts/${kind}`,
      method: 'PUT',
      body: { throughMessageId: messageId },
    });
  }

  const connected = connectionState === 'connected';
  const isSubscribed = subscribedConversationId !== null;
  const hasConversation = conversationId.trim().length > 0;
  const socketControlsDisabled = !connected || !hasConversation;
  const actionPending = busyAction !== null;

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <ExpoStatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>CHATEO DEVTOOLS</Text>
            <Text style={styles.title}>Socket Lab</Text>
            <Text style={styles.subtitle}>
              One screen for authenticated Socket.IO commands, realtime events,
              and the REST writes that trigger them.
            </Text>
          </View>

          <View style={styles.statusBar}>
            <View style={styles.statusIdentity}>
              <View
                style={[
                  styles.statusDot,
                  styles[`statusDot_${connectionState}`],
                ]}
              />
              <View style={styles.flex}>
                <Text style={styles.statusLabel}>
                  {connectionStateLabel(connectionState)}
                </Text>
                <Text numberOfLines={1} style={styles.statusDetail}>
                  {socketId ? `Socket ${socketId}` : 'No active socket'}
                </Text>
              </View>
            </View>
            <View style={styles.pillGroup}>
              <Pill active={isSubscribed} label="Presence" />
              <Pill active={isTyping} label="Typing" />
            </View>
          </View>

          <Section
            description="The access token is kept in memory only. Reconnect after replacing an expired token."
            number="01"
            title="Connection"
          >
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              editable={
                connectionState === 'disconnected' && !actionPending
              }
              hint={originHint(apiOrigin)}
              keyboardType="url"
              label="API origin"
              onChangeText={setApiOrigin}
              placeholder="http://localhost:3000"
              value={apiOrigin}
            />
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              editable={
                connectionState === 'disconnected' && !actionPending
              }
              label="Access token"
              onChangeText={setAccessToken}
              placeholder="Paste JWT access token"
              secureTextEntry={!showAccessToken}
              value={accessToken}
            />
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setShowAccessToken((current) => !current)}
              style={styles.inlineControl}
            >
              <Text style={styles.inlineControlText}>
                {showAccessToken ? 'Hide token' : 'Show token'}
              </Text>
            </Pressable>
            <ButtonRow>
              <ActionButton
                busy={
                  connectionState === 'connecting' ||
                  connectionState === 'reconnecting'
                }
                disabled={connected || !accessToken.trim() || actionPending}
                label="Connect"
                onPress={connectSocket}
              />
              <ActionButton
                disabled={!socketRef.current}
                label="Disconnect"
                onPress={disconnectSocket}
                tone="secondary"
              />
            </ButtonRow>
          </Section>

          <Section
            description="Presence and typing are socket commands. Every command below records the server acknowledgement."
            number="02"
            title="Realtime commands"
          >
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              editable={
                !isSubscribed && !actionPending
              }
              label="Conversation ID"
              onChangeText={(value) => {
                const normalizedValue = value.trim().toLowerCase();
                if (normalizedValue !== conversationIdRef.current) {
                  setThroughMessageId('');
                }
                conversationIdRef.current = normalizedValue;
                setConversationId(value);
              }}
              placeholder="550e8400-e29b-41d4-a716-446655440000"
              value={conversationId}
            />
            <ButtonRow>
              <ActionButton
                busy={busyAction === 'presence.subscribe'}
                disabled={socketControlsDisabled || isSubscribed || actionPending}
                label="Subscribe"
                onPress={() => emitCommand('presence.subscribe')}
              />
              <ActionButton
                busy={busyAction === 'presence.unsubscribe'}
                disabled={socketControlsDisabled || !isSubscribed || actionPending}
                label="Unsubscribe"
                onPress={() => emitCommand('presence.unsubscribe')}
                tone="secondary"
              />
            </ButtonRow>
            <ButtonRow>
              <ActionButton
                busy={busyAction === 'typing.start'}
                disabled={socketControlsDisabled || !isSubscribed || actionPending}
                label="Start typing"
                onPress={() => emitCommand('typing.start')}
                tone="quiet"
              />
              <ActionButton
                busy={busyAction === 'typing.stop'}
                disabled={socketControlsDisabled || !isTyping || actionPending}
                label="Stop typing"
                onPress={() => emitCommand('typing.stop')}
                tone="quiet"
              />
            </ButtonRow>
            <Text style={styles.note}>
              Typing expires after 5 seconds. Tap Start typing again to test a
              refresh, or Stop typing to end it explicitly.
            </Text>
          </Section>

          <Section
            description="Messages and durable receipts are REST-authoritative. Their successful writes should appear as socket events on both users."
            number="03"
            title="REST triggers"
          >
            <Field
              label="Message text"
              multiline
              onChangeText={setMessageText}
              placeholder="Write a test message"
              value={messageText}
            />
            <ActionButton
              busy={busyAction === 'Send message'}
              disabled={!hasConversation || !messageText.trim() || actionPending}
              label="Send message via REST"
              onPress={() => void sendMessage()}
            />
            <ButtonRow>
              <ActionButton
                busy={busyAction === 'Load history'}
                disabled={!hasConversation || actionPending}
                label="Load history"
                onPress={() => void loadHistory()}
                tone="quiet"
              />
              <ActionButton
                busy={busyAction === 'Load receipts'}
                disabled={!hasConversation || actionPending}
                label="Load receipts"
                onPress={() => void loadReceipts()}
                tone="quiet"
              />
            </ButtonRow>
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              hint="Auto-filled with the latest observed message.created ID. Receipt writes must target an incoming message."
              label="Through message ID"
              onChangeText={setThroughMessageId}
              placeholder="Incoming server message ID"
              value={throughMessageId}
            />
            <ButtonRow>
              <ActionButton
                busy={busyAction === 'Mark delivered'}
                disabled={
                  !hasConversation || !throughMessageId.trim() || actionPending
                }
                label="Mark delivered"
                onPress={() => void updateReceipt('delivered')}
                tone="secondary"
              />
              <ActionButton
                busy={busyAction === 'Mark read'}
                disabled={
                  !hasConversation || !throughMessageId.trim() || actionPending
                }
                label="Mark read"
                onPress={() => void updateReceipt('read')}
                tone="secondary"
              />
            </ButtonRow>
            {busyAction && !isRealtimeCommand(busyAction) ? (
              <ActionButton
                label="Cancel pending REST request"
                onPress={cancelRestRequest}
                tone="quiet"
              />
            ) : null}
          </Section>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.sectionNumber}>04</Text>
                <Text style={styles.sectionTitle}>Event timeline</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={logs.length === 0}
                onPress={() => setLogs([])}
                style={({ pressed }) => [
                  styles.clearButton,
                  pressed && styles.pressed,
                  logs.length === 0 && styles.disabled,
                ]}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </Pressable>
            </View>
            <Text style={styles.sectionDescription}>
              Newest first. Payloads are truncated locally when they become too
              large; access tokens are never logged.
            </Text>
            {logs.length === 0 ? (
              <View style={styles.emptyLog}>
                <Text style={styles.emptyLogTitle}>Nothing received yet</Text>
                <Text style={styles.emptyLogText}>
                  Connect a socket or run a REST action to start the timeline.
                </Text>
              </View>
            ) : (
              <View style={styles.logList}>
                {logs.map((entry) => (
                  <LogItem entry={entry} key={entry.id} />
                ))}
              </View>
            )}
          </View>

          <Text style={styles.footer}>
            Tip: run this app as user A and user B on separate devices to verify
            peer-only typing plus shared message and receipt events.
          </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Section({
  children,
  description,
  number,
  title,
}: {
  children: ReactNode;
  description: string;
  number: string;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingCopy}>
        <Text style={styles.sectionNumber}>{number}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <Text style={styles.sectionDescription}>{description}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ hint, label, multiline, style, ...props }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        multiline={multiline}
        placeholderTextColor="#67708A"
        selectionColor="#7C8CFF"
        style={[styles.input, multiline && styles.inputMultiline, style]}
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

interface FieldProps extends TextInputProps {
  hint?: string;
  label: string;
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>;
}

function ActionButton({
  busy = false,
  disabled = false,
  label,
  onPress,
  tone = 'primary',
}: {
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'quiet';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        styles[`actionButton_${tone}`],
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone === 'primary' ? '#07101B' : '#DDE3FF'} />
      ) : (
        <Text
          style={[
            styles.actionButtonText,
            tone === 'primary' && styles.actionButtonTextPrimary,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function Pill({ active, label }: { active: boolean; label: string }) {
  return (
    <View style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </View>
  );
}

function LogItem({ entry }: { entry: LogEntry }) {
  const payload = formatPayload(entry.payload);

  return (
    <View style={styles.logItem}>
      <View style={styles.logHeader}>
        <View style={[styles.logKind, styles[`logKind_${entry.kind}`]]}>
          <Text style={styles.logKindText}>{entry.kind.toUpperCase()}</Text>
        </View>
        <Text style={styles.logTime}>{formatTime(entry.timestamp)}</Text>
      </View>
      <Text selectable style={styles.logLabel}>
        {entry.label}
      </Text>
      {payload ? (
        <Text selectable style={styles.logPayload}>
          {payload}
        </Text>
      ) : null}
    </View>
  );
}

function describeError(error: unknown): unknown {
  if (error instanceof ApiRequestError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      response: error.payload,
    };
  }

  if (error instanceof Error) {
    const socketError = error as Error & { data?: unknown; description?: unknown };
    return {
      name: error.name,
      message: error.message,
      data: socketError.data,
      description: socketError.description,
    };
  }

  return error;
}

function readExpiresAt(data: unknown): string | null {
  if (
    typeof data === 'object' &&
    data !== null &&
    'expiresAt' in data &&
    typeof data.expiresAt === 'string'
  ) {
    return data.expiresAt;
  }

  return null;
}

function readConversationId(data: unknown): string | null {
  if (
    typeof data === 'object' &&
    data !== null &&
    'conversationId' in data &&
    typeof data.conversationId === 'string'
  ) {
    return data.conversationId.toLowerCase();
  }

  return null;
}

function readJwtSubject(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment || typeof globalThis.atob !== 'function') return null;

  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (base64.length % 4)) % 4;

  try {
    const payload = JSON.parse(
      globalThis.atob(`${base64}${'='.repeat(paddingLength)}`),
    ) as unknown;

    if (
      typeof payload === 'object' &&
      payload !== null &&
      'sub' in payload &&
      typeof payload.sub === 'string'
    ) {
      return payload.sub;
    }
  } catch {
    // The server remains authoritative for token validation. Decoding here is
    // only used to avoid selecting the current user's own message for receipts.
  }

  return null;
}

function isRealtimeCommand(value: string | null): value is RealtimeCommand {
  return (
    value === 'presence.subscribe' ||
    value === 'presence.unsubscribe' ||
    value === 'typing.start' ||
    value === 'typing.stop'
  );
}

function formatPayload(payload: unknown): string | null {
  if (payload === undefined) return null;
  if (typeof payload === 'string') return payload;

  let value: string;
  try {
    value = JSON.stringify(payload, null, 2);
  } catch {
    value = String(payload);
  }

  return value.length > 4_000 ? `${value.slice(0, 4_000)}\n… truncated` : value;
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'disconnected':
      return 'Disconnected';
  }
}

function originHint(apiOrigin: string): string {
  if (apiOrigin.trim() === DEFAULT_API_ORIGIN) {
    return 'Live Render API. Socket Lab connects to its /chat namespace over WSS.';
  }
  if (Platform.OS === 'android') {
    return '10.0.2.2 reaches your Mac from the Android emulator. Use your Mac LAN IP on a physical device.';
  }
  if (Platform.OS === 'ios') {
    return 'localhost works in the iOS Simulator. Use your Mac LAN IP on a physical device.';
  }
  return 'Use the backend origin without /v1 or /chat.';
}
