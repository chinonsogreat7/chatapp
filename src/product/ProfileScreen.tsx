import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_LABEL } from './config';
import { errorMessage } from './errors';
import { useSession } from './SessionProvider';
import { colors } from './theme';
import { Avatar, Button, Field, Notice, ui } from './ui';

export function ProfileScreen({ onboarding = false }: { onboarding?: boolean }) {
  const { session, updateProfile, logout } = useSession();
  const user = session?.user;
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [busy, setBusy] = useState<'save' | 'logout' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  const save = async () => {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 80) {
      setError('Display name must contain 2 to 80 characters.');
      return;
    }

    setBusy('save');
    setError(null);
    setSaved(false);
    try {
      await updateProfile({
        displayName: name,
        avatarUrl: avatarUrl.trim() || null,
      });
      setSaved(true);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const performLogout = async () => {
    setBusy('logout');
    setError(null);
    try {
      await logout();
    } catch (requestError) {
      // Local credentials are cleared even if the network logout fails.
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const confirmLogout = () => {
    if (onboarding) {
      void performLogout();
      return;
    }
    Alert.alert('Log out of Chateo?', 'This removes the secure session from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void performLogout() },
    ]);
  };

  return (
    <SafeAreaView edges={onboarding ? ['top', 'bottom'] : []} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={ui.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {onboarding ? (
            <View style={styles.onboardingHero}>
              <Text style={styles.eyebrow}>ONE LAST STEP</Text>
              <Text style={styles.title}>Make it yours.</Text>
              <Text style={styles.subtitle}>
                Add the name people will use to find you. This unlocks the test
                client’s chat experience.
              </Text>
            </View>
          ) : (
            <View style={styles.profileHero}>
              <Avatar name={user.displayName} size={72} uri={user.avatarUrl} />
              <View style={styles.profileHeroCopy}>
                <Text style={styles.profileName}>{user.displayName ?? 'Profile'}</Text>
                <Text style={styles.phone}>{user.phoneNumber}</Text>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {onboarding ? 'Set up profile' : 'Edit profile'}
            </Text>
            <Field
              autoCapitalize="words"
              autoComplete="name"
              label="Display name"
              maxLength={80}
              onChangeText={(value) => {
                setDisplayName(value);
                setSaved(false);
              }}
              placeholder="Great Ichoku"
              returnKeyType="next"
              textContentType="name"
              value={displayName}
            />
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              label="Avatar URL (optional)"
              onChangeText={(value) => {
                setAvatarUrl(value);
                setSaved(false);
              }}
              placeholder="https://example.com/avatar.jpg"
              returnKeyType="done"
              value={avatarUrl}
              hint="The backend accepts an existing image URL; uploads are not available yet."
            />
            {error ? <Notice tone="error">{error}</Notice> : null}
            {saved ? <Notice tone="success">Profile saved.</Notice> : null}
            <Button
              busy={busy === 'save'}
              disabled={busy !== null || displayName.trim().length < 2}
              label={onboarding ? 'Finish setup' : 'Save changes'}
              onPress={() => void save()}
            />
          </View>

          {!onboarding ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Session</Text>
              <InfoRow label="User ID" value={user.id} />
              <InfoRow label="API" value={API_LABEL} />
              <InfoRow label="Storage" value="Encrypted on this device" />
            </View>
          ) : null}

          <Button
            busy={busy === 'logout'}
            disabled={busy !== null}
            label={onboarding ? 'Use another phone number' : 'Log out'}
            onPress={confirmLogout}
            variant="danger"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={1} selectable style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: 16, padding: 18, paddingBottom: 42 },
  onboardingHero: { marginBottom: 12, marginTop: 38 },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 9,
  },
  title: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  profileHero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    marginBottom: 5,
    marginTop: 8,
  },
  profileHeroCopy: { flex: 1 },
  profileName: { color: colors.text, fontSize: 24, fontWeight: '900' },
  phone: { color: colors.textMuted, fontSize: 13, marginTop: 5 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 15,
    padding: 17,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  infoRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingTop: 13,
  },
  infoLabel: { color: colors.textMuted, fontSize: 12 },
  infoValue: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
});
