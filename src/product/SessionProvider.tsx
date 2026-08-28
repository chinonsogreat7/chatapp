import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';
import {
  apiRequest,
  ApiRequestError,
  type ApiRequestOptions,
} from '../api';
import { API_ORIGIN } from './config';
import type { AuthResponse, Session, User } from './types';

const SESSION_STORAGE_KEY = 'chateo.session.v1';
const MAX_REFRESH_EARLY_MS = 60_000;
const REFRESH_LIFETIME_FRACTION = 0.2;
const REQUEST_EXPIRY_BUFFER_MS = 5_000;
const REFRESH_RETRY_MS = 30_000;

type AuthorizedRequestOptions = Omit<
  ApiRequestOptions,
  'origin' | 'accessToken'
>;

interface SessionContextValue {
  phase: 'loading' | 'signedOut' | 'authenticated';
  session: Session | null;
  installAuthResponse: (response: AuthResponse) => Promise<void>;
  request: <T>(options: AuthorizedRequestOptions) => Promise<T>;
  updateProfile: (input: {
    displayName?: string;
    avatarUrl?: string | null;
  }) => Promise<User>;
  refreshNow: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<SessionContextValue['phase']>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [refreshRetry, setRefreshRetry] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const refreshPromiseRef = useRef<{
    generation: number;
    promise: Promise<Session>;
  } | null>(null);
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionGenerationRef = useRef(0);
  const profileRevisionRef = useRef(0);
  const mountedRef = useRef(true);

  const runStorageOperation = useCallback(
    (operation: () => Promise<void>): Promise<void> => {
      const next = storageQueueRef.current.catch(() => undefined).then(operation);
      storageQueueRef.current = next.catch(() => undefined);
      return next;
    },
    [],
  );

  const exposeSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    if (!mountedRef.current) return;
    setSession(next);
    setPhase(next ? 'authenticated' : 'signedOut');
  }, []);

  const clearSession = useCallback(async () => {
    sessionGenerationRef.current += 1;
    profileRevisionRef.current = 0;
    exposeSession(null);
    await runStorageOperation(deleteStoredSession);
  }, [exposeSession, runStorageOperation]);

  const commitSession = useCallback(
    async (
      expectedGeneration: number,
      build: (current: Session | null) => Session | null,
    ): Promise<Session | null> => {
      let committed: Session | null = null;
      await runStorageOperation(async () => {
        if (sessionGenerationRef.current !== expectedGeneration) return;
        const next = build(sessionRef.current);
        if (!next) return;
        await writeStoredSession(next);
        if (sessionGenerationRef.current !== expectedGeneration) return;
        committed = next;
        exposeSession(next);
      });
      return committed;
    },
    [exposeSession, runStorageOperation],
  );

  const installAuthResponse = useCallback(
    async (response: AuthResponse) => {
      sessionGenerationRef.current += 1;
      profileRevisionRef.current = 0;
      const generation = sessionGenerationRef.current;
      const next = sessionFromAuthResponse(response);
      let committed: Session | null;
      try {
        committed = await commitSession(generation, () => next);
      } catch (error) {
        void revokeRefreshToken(next.refreshToken);
        throw error;
      }
      if (!committed) {
        void revokeRefreshToken(next.refreshToken);
        throw new Error('Sign-in was cancelled before it could finish.');
      }
    },
    [commitSession],
  );

  const refreshSession = useCallback(async (): Promise<Session> => {
    const current = sessionRef.current;
    const refreshGeneration = sessionGenerationRef.current;
    const refreshProfileRevision = profileRevisionRef.current;
    if (refreshPromiseRef.current?.generation === refreshGeneration) {
      return refreshPromiseRef.current.promise;
    }
    if (!current) throw new Error('Your session has ended. Sign in again.');

    if (current.refreshTokenExpiresAt <= Date.now()) {
      await clearSession();
      throw new Error('Your session expired. Sign in again.');
    }

    const refresh = (async () => {
      try {
        const response = await apiRequest<AuthResponse>({
          origin: API_ORIGIN,
          path: '/auth/refresh',
          method: 'POST',
          body: { refreshToken: current.refreshToken },
        });
        const next = sessionFromAuthResponse(response);
        if (sessionGenerationRef.current !== refreshGeneration) {
          void apiRequest<void>({
            origin: API_ORIGIN,
            path: '/auth/logout',
            method: 'POST',
            body: { refreshToken: next.refreshToken },
          }).catch(() => undefined);
          throw new Error('This session has already ended.');
        }
        let committed: Session | null;
        try {
          committed = await commitSession(refreshGeneration, (latest) => ({
            ...next,
            user:
              latest?.user.id === next.user.id &&
              profileRevisionRef.current !== refreshProfileRevision
                ? latest.user
                : next.user,
          }));
        } catch (storageError) {
          void revokeRefreshToken(next.refreshToken);
          await clearSession();
          throw storageError;
        }
        if (!committed) {
          void revokeRefreshToken(next.refreshToken);
          throw new Error('This session has already ended.');
        }
        return committed;
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          error.status === 401 &&
          sessionGenerationRef.current === refreshGeneration
        ) {
          await clearSession();
        }
        throw error;
      }
    })();

    refreshPromiseRef.current = {
      generation: refreshGeneration,
      promise: refresh,
    };
    void refresh.then(
      () => {
        if (refreshPromiseRef.current?.promise === refresh) {
          refreshPromiseRef.current = null;
        }
      },
      () => {
        if (refreshPromiseRef.current?.promise === refresh) {
          refreshPromiseRef.current = null;
        }
      },
    );
    return refresh;
  }, [clearSession, commitSession]);

  const request = useCallback(
    async <T,>(options: AuthorizedRequestOptions): Promise<T> => {
      let active = sessionRef.current;
      if (!active) throw new Error('Sign in to continue.');

      if (active.accessTokenExpiresAt <= Date.now() + REQUEST_EXPIRY_BUFFER_MS) {
        active = await refreshSession();
      }

      const attemptedAccessToken = active.accessToken;
      try {
        return await apiRequest<T>({
          ...options,
          origin: API_ORIGIN,
          accessToken: active.accessToken,
        });
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 401) {
          throw error;
        }

        const latest = sessionRef.current;
        const refreshed =
          latest && latest.accessToken !== attemptedAccessToken
            ? latest.accessTokenExpiresAt > Date.now() + REQUEST_EXPIRY_BUFFER_MS
              ? latest
              : await refreshSession()
            : await refreshSession();
        return apiRequest<T>({
          ...options,
          origin: API_ORIGIN,
          accessToken: refreshed.accessToken,
        });
      }
    },
    [refreshSession],
  );

  const updateProfile = useCallback(
    async (input: {
      displayName?: string;
      avatarUrl?: string | null;
    }): Promise<User> => {
      const updateGeneration = sessionGenerationRef.current;
      const updateUserId = sessionRef.current?.user.id;
      const user = await request<User>({
        path: '/me',
        method: 'PATCH',
        body: input,
      });
      if (
        updateUserId === user.id &&
        sessionGenerationRef.current === updateGeneration
      ) {
        profileRevisionRef.current += 1;
        await commitSession(updateGeneration, (current) =>
          current?.user.id === user.id ? { ...current, user } : null,
        );
      }
      return user;
    },
    [commitSession, request],
  );

  const logout = useCallback(async () => {
    const refreshToken = sessionRef.current?.refreshToken;
    let localError: unknown;
    try {
      await clearSession();
    } catch (error) {
      localError = error;
    }

    let remoteError: unknown;
    if (refreshToken) {
      try {
        await apiRequest<void>({
          origin: API_ORIGIN,
          path: '/auth/logout',
          method: 'POST',
          body: { refreshToken },
        });
      } catch (error) {
        remoteError = error;
      }
    }

    if (localError) {
      throw new Error('Chateo could not remove the secure session from this device.');
    }
    if (remoteError) throw remoteError;
  }, [clearSession]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void (async () => {
      const stored = await readStoredSession();
      if (cancelled) return;

      if (!stored || stored.refreshTokenExpiresAt <= Date.now()) {
        try {
          await deleteStoredSession();
        } catch {
          // The invalid/expired value is ignored for this launch.
        }
        if (!cancelled) exposeSession(null);
        return;
      }

      sessionRef.current = stored;
      if (stored.accessTokenExpiresAt > Date.now() + REQUEST_EXPIRY_BUFFER_MS) {
        exposeSession(stored);
        return;
      }

      try {
        await refreshSession();
      } catch {
        // A network failure should not discard a still-valid refresh token.
        if (!cancelled && sessionRef.current) exposeSession(sessionRef.current);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [exposeSession, refreshSession]);

  useEffect(() => {
    if (!session) return;

    const tokenLifetime = Math.max(
      1,
      session.accessTokenExpiresAt - session.accessTokenIssuedAt,
    );
    const refreshEarly = Math.min(
      MAX_REFRESH_EARLY_MS,
      tokenLifetime * REFRESH_LIFETIME_FRACTION,
    );
    const delay = Math.max(
      0,
      session.accessTokenExpiresAt - Date.now() - refreshEarly,
    );
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      void refreshSession().catch(() => {
        retryTimer = setTimeout(
          () => setRefreshRetry((value) => value + 1),
          REFRESH_RETRY_MS,
        );
      });
    }, delay);

    return () => {
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [refreshRetry, refreshSession, session]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = sessionRef.current;
      if (
        state === 'active' &&
        active &&
        active.accessTokenExpiresAt <=
          Date.now() +
            Math.min(
              MAX_REFRESH_EARLY_MS,
              (active.accessTokenExpiresAt - active.accessTokenIssuedAt) *
                REFRESH_LIFETIME_FRACTION,
            )
      ) {
        void refreshSession().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [refreshSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      phase,
      session,
      installAuthResponse,
      request,
      updateProfile,
      refreshNow: async () => {
        await refreshSession();
      },
      logout,
    }),
    [
      installAuthResponse,
      logout,
      phase,
      refreshSession,
      request,
      session,
      updateProfile,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}

function sessionFromAuthResponse(response: AuthResponse): Session {
  const now = Date.now();
  return {
    accessToken: response.accessToken,
    accessTokenIssuedAt: now,
    accessTokenExpiresAt: now + response.accessTokenExpiresInSeconds * 1000,
    refreshToken: response.refreshToken,
    refreshTokenExpiresAt: now + response.refreshTokenExpiresInSeconds * 1000,
    user: response.user,
  };
}

async function secureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function readStoredSession(): Promise<Session | null> {
  if (!(await secureStoreAvailable())) return null;
  try {
    const value = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as unknown;
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeStoredSession(session: Session): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await secureStoreAvailable())) {
    throw new Error('Secure session storage is unavailable on this device.');
  }
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteStoredSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await secureStoreAvailable())) {
    throw new Error('Secure session storage is unavailable on this device.');
  }
  try {
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  } catch (deletionError) {
    try {
      // An invalid tombstone is safer than reviving valid credentials next launch.
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, '{"loggedOut":true}', {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      throw deletionError;
    }
  }
}

async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await apiRequest<void>({
      origin: API_ORIGIN,
      path: '/auth/logout',
      method: 'POST',
      body: { refreshToken },
    });
  } catch {
    // Best effort: this is cleanup for a session the UI no longer owns.
  }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Session>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.accessTokenIssuedAt === 'number' &&
    typeof candidate.accessTokenExpiresAt === 'number' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.refreshTokenExpiresAt === 'number' &&
    typeof candidate.user === 'object' &&
    candidate.user !== null &&
    typeof candidate.user.id === 'string' &&
    typeof candidate.user.phoneNumber === 'string' &&
    typeof candidate.user.profileComplete === 'boolean'
  );
}
