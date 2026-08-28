import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../api';
import { API_ORIGIN } from './config';
import { errorMessage } from './errors';
import { useSession } from './SessionProvider';
import { colors } from './theme';
import type { AuthResponse, OtpChallenge } from './types';
import { Button, Field, Notice, ui } from './ui';

export function AuthScreen() {
  const { installAuthResponse } = useSession();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'request' | 'verify' | 'resend' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const flowEpochRef = useRef(0);

  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [challenge]);

  const resendSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const expirySeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const codeLength = challenge?.codeLength ?? 6;
  const cleanPhone = phoneNumber.trim();
  const canRequest = /^\+[\d\s()-]{7,31}$/.test(cleanPhone);
  const canVerify = code.length === codeLength && expirySeconds > 0;

  const title = useMemo(
    () => (challenge ? 'Check your phone' : 'Your people, right here.'),
    [challenge],
  );

  const applyChallenge = (next: OtpChallenge) => {
    const nextNow = Date.now();
    setChallenge(next);
    setCode('');
    setNow(nextNow);
    setCooldownUntil(nextNow + next.resendInSeconds * 1000);
    setExpiresAt(nextNow + next.expiresInSeconds * 1000);
  };

  const requestOtp = async () => {
    if (!canRequest) return;
    setBusy('request');
    setError(null);
    const epoch = ++flowEpochRef.current;
    try {
      const response = await apiRequest<OtpChallenge>({
        origin: API_ORIGIN,
        path: '/auth/otp/request',
        method: 'POST',
        body: { phoneNumber: cleanPhone },
      });
      if (flowEpochRef.current === epoch) applyChallenge(response);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const resendOtp = async () => {
    if (!challenge || resendSeconds > 0) return;
    setBusy('resend');
    setError(null);
    const epoch = flowEpochRef.current;
    try {
      const response = await apiRequest<OtpChallenge>({
        origin: API_ORIGIN,
        path: '/auth/otp/resend',
        method: 'POST',
        body: { challengeId: challenge.challengeId },
      });
      if (flowEpochRef.current === epoch) applyChallenge(response);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const verifyOtp = async () => {
    if (!challenge || !canVerify) return;
    setBusy('verify');
    setError(null);
    const epoch = flowEpochRef.current;
    try {
      const response = await apiRequest<AuthResponse>({
        origin: API_ORIGIN,
        path: '/auth/otp/verify',
        method: 'POST',
        body: {
          challengeId: challenge.challengeId,
          code,
          device: {
            name: `Chateo ${Platform.OS} app`,
            platform:
              Platform.OS === 'ios' ||
              Platform.OS === 'android' ||
              Platform.OS === 'web'
                ? Platform.OS
                : 'unknown',
          },
        },
      });
      if (flowEpochRef.current === epoch) await installAuthResponse(response);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={ui.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topRow}>
            <View style={ui.brandMark}>
              <Text style={ui.brandMarkText}>C</Text>
            </View>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE API</Text>
            </View>
          </View>

          <View style={styles.hero}>
            <Text style={styles.eyebrow}>CHATEO</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              {challenge
                ? `Enter the ${codeLength}-digit code sent to ${challenge.phoneNumberMasked}.`
                : 'Sign in with your phone number to test real conversations and realtime events.'}
            </Text>
          </View>

          <View style={styles.card}>
            {!challenge ? (
              <>
                <Field
                  autoCapitalize="none"
                  autoComplete="tel"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  label="Phone number"
                  onChangeText={setPhoneNumber}
                  onSubmitEditing={() => void requestOtp()}
                  placeholder="+234 801 234 5678"
                  returnKeyType="send"
                  textContentType="telephoneNumber"
                  value={phoneNumber}
                  hint="Use an E.164 number, starting with + and the country code."
                />
                {error ? <Notice tone="error">{error}</Notice> : null}
                <Button
                  busy={busy === 'request'}
                  disabled={!canRequest || busy !== null}
                  label="Send verification code"
                  onPress={() => void requestOtp()}
                />
              </>
            ) : (
              <>
                <Field
                  autoFocus
                  keyboardType="number-pad"
                  label="Verification code"
                  maxLength={codeLength}
                  onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
                  onSubmitEditing={() => void verifyOtp()}
                  placeholder={'•'.repeat(codeLength)}
                  returnKeyType="done"
                  textContentType="oneTimeCode"
                  value={code}
                  hint={
                    expirySeconds > 0
                      ? `Code expires in ${formatCountdown(expirySeconds)}.`
                      : 'This code has expired. Request a new one.'
                  }
                />
                {error ? <Notice tone="error">{error}</Notice> : null}
                <Button
                  busy={busy === 'verify'}
                  disabled={!canVerify || busy !== null}
                  label="Verify and continue"
                  onPress={() => void verifyOtp()}
                />
                <View style={styles.secondaryActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: resendSeconds > 0 || busy !== null,
                    }}
                    disabled={resendSeconds > 0 || busy !== null}
                    hitSlop={10}
                    onPress={() => void resendOtp()}
                    style={({ pressed }) => pressed && ui.pressed}
                  >
                    <Text
                      style={[
                        styles.link,
                        (resendSeconds > 0 || busy !== null) && ui.disabled,
                      ]}
                    >
                      {busy === 'resend'
                        ? 'Sending…'
                        : resendSeconds > 0
                          ? `Resend in ${resendSeconds}s`
                          : 'Resend code'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy !== null }}
                    disabled={busy !== null}
                    hitSlop={10}
                    onPress={() => {
                      flowEpochRef.current += 1;
                      setChallenge(null);
                      setCode('');
                      setError(null);
                    }}
                    style={({ pressed }) => [
                      pressed && ui.pressed,
                      busy !== null && ui.disabled,
                    ]}
                  >
                    <Text style={styles.linkMuted}>Change number</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          <Text style={styles.footnote}>
            OTP delivery depends on the active server configuration. Never share a
            production verification code.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 40,
    paddingHorizontal: 22,
    paddingTop: 24,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  livePill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  liveDot: {
    backgroundColor: colors.success,
    borderRadius: 5,
    height: 7,
    width: 7,
  },
  liveText: { color: colors.textMuted, fontSize: 10, fontWeight: '900' },
  hero: { marginBottom: 26, marginTop: 42 },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2.2,
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -1.1,
    lineHeight: 43,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 11,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    paddingTop: 2,
  },
  link: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  linkMuted: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  footnote: {
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 18,
    textAlign: 'center',
  },
});
