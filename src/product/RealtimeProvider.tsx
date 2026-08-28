import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { io } from 'socket.io-client';
import { getSocketUrl } from '../api';
import type { ChatSocket } from '../protocol';
import { API_ORIGIN } from './config';
import { useSession } from './SessionProvider';

export type RealtimeStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

interface RealtimeContextValue {
  socket: ChatSocket | null;
  status: RealtimeStatus;
  activityVersion: number;
  reconcileVersion: number;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

interface RealtimeProviderProps extends PropsWithChildren {
  enabled?: boolean;
}

export function RealtimeProvider({
  children,
  enabled = true,
}: RealtimeProviderProps) {
  const { session, refreshNow, request } = useSession();
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [activityVersion, setActivityVersion] = useState(0);
  const [reconcileVersion, setReconcileVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !session) {
      setSocket(null);
      setStatus('disconnected');
      return;
    }

    const next = io(getSocketUrl(API_ORIGIN), {
      auth: { token: session.accessToken },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      timeout: 15_000,
      transports: ['websocket'],
    }) as ChatSocket;

    setSocket(next);
    setStatus('connecting');

    const onConnect = () => {
      setStatus('connected');
      setReconcileVersion((value) => value + 1);
    };
    const onDisconnect = (reason: string) => {
      setStatus('disconnected');
      if (reason === 'io server disconnect') {
        void refreshNow().catch(() => undefined);
      }
    };
    const onReconnectAttempt = () => setStatus('reconnecting');
    const onConnectError = (error: Error & { data?: { code?: string } }) => {
      setStatus('disconnected');
      if (error.data?.code === 'AUTH_ACCESS_TOKEN_INVALID') {
        void refreshNow().catch(() => undefined);
      }
    };
    const bumpActivity = () => setActivityVersion((value) => value + 1);
    const pendingDeliveries = new Map<
      string,
      { conversationId: string; id: string; senderId: string }
    >();
    let deliveryTimer: ReturnType<typeof setTimeout> | null = null;
    const flushDeliveries = () => {
      deliveryTimer = null;
      const deliveries = [...pendingDeliveries.values()];
      pendingDeliveries.clear();
      for (const message of deliveries) {
        void request({
          path: `/conversations/${message.conversationId}/receipts/delivered`,
          method: 'PUT',
          body: { throughMessageId: message.id },
        }).catch(() => undefined);
      }
    };
    const onMessage = (message: {
      conversationId: string;
      id: string;
      senderId: string;
    }) => {
      bumpActivity();
      if (message.senderId !== session.user.id) {
        pendingDeliveries.set(message.conversationId, message);
        if (!deliveryTimer) deliveryTimer = setTimeout(flushDeliveries, 150);
      }
    };

    next.on('connect', onConnect);
    next.on('disconnect', onDisconnect);
    next.on('connect_error', onConnectError);
    next.io.on('reconnect_attempt', onReconnectAttempt);
    next.on('message.created', onMessage);
    next.on('receipt.delivered', bumpActivity);
    next.on('receipt.read', bumpActivity);

    return () => {
      if (deliveryTimer) clearTimeout(deliveryTimer);
      next.removeAllListeners();
      next.io.removeAllListeners();
      next.disconnect();
      setSocket((current) => (current === next ? null : current));
    };
  }, [enabled, refreshNow, request, session]);

  const value = useMemo<RealtimeContextValue>(
    () => ({ socket, status, activityVersion, reconcileVersion }),
    [activityVersion, reconcileVersion, socket, status],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) {
    throw new Error('useRealtime must be used inside RealtimeProvider.');
  }
  return value;
}
