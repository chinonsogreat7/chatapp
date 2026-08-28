import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { errorMessage } from './errors';
import { useSession } from './SessionProvider';
import { colors } from './theme';
import type {
  ContactMatchesResponse,
  Conversation,
  PublicUser,
  UserSearchResponse,
} from './types';
import { Avatar, Button, EmptyState, Field, Notice } from './ui';

interface DiscoveryResult {
  user: PublicUser;
  detail: string;
}

export function DiscoverScreen({
  onOpen,
}: {
  onOpen: (conversation: Conversation) => void;
}) {
  const { request, session } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [mode, setMode] = useState<'idle' | 'search' | 'contacts'>('idle');
  const [busy, setBusy] = useState<'search' | 'contacts' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const search = async () => {
    const normalized = query.trim();
    if (normalized.length < 3) {
      setError('Enter at least 3 characters to search by display name.');
      return;
    }

    setBusy('search');
    setError(null);
    setShowSettings(false);
    try {
      const response = await request<UserSearchResponse>({
        path: `/users/search?q=${encodeURIComponent(normalized)}&limit=25`,
      });
      setResults(
        response.items.map((user) => ({ user, detail: 'Found by display name' })),
      );
      setMode('search');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const matchContacts = async () => {
    if (Platform.OS === 'web') {
      setError('Contact matching is available in the iOS and Android app.');
      return;
    }

    setBusy('contacts');
    setError(null);
    setShowSettings(false);
    try {
      const permission = await requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setShowSettings(permission.canAskAgain === false);
        setError(
          permission.canAskAgain === false
            ? 'Contact access is disabled. Open system settings to allow it.'
            : 'Contact permission is required to match people you already know.',
        );
        return;
      }

      const defaultCountry = readCountry(session?.user.phoneNumber);
      const phoneNumbers = await readContactNumbers(defaultCountry);
      if (phoneNumbers.length === 0) {
        setResults([]);
        setMode('contacts');
        setError(
          'No valid phone numbers were found. Save contacts with a country code or check their number format.',
        );
        return;
      }

      const response = await request<ContactMatchesResponse>({
        path: '/contacts/match',
        method: 'POST',
        body: { phoneNumbers },
      });
      setResults(
        response.matches.map((match) => ({
          user: match.user,
          detail: match.matchedPhoneNumber,
        })),
      );
      setMode('contacts');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const startConversation = async (user: PublicUser) => {
    setBusy(user.id);
    setError(null);
    try {
      const conversation = await request<Conversation>({
        path: '/conversations/direct',
        method: 'POST',
        body: { participantId: user.id },
      });
      onOpen(conversation);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Find people</Text>
        <Text style={styles.subtitle}>
          Search completed profiles or privately match up to 100 numbers from your
          address book.
        </Text>
      </View>

      <View style={styles.controls}>
        <Field
          autoCapitalize="words"
          autoCorrect={false}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          placeholder="Search display names"
          returnKeyType="search"
          value={query}
        />
        <View style={styles.buttonRow}>
          <Button
            busy={busy === 'search'}
            disabled={busy !== null || query.trim().length < 3}
            label="Search"
            onPress={() => void search()}
            compact
            style={styles.button}
          />
          <Button
            busy={busy === 'contacts'}
            disabled={busy !== null}
            label="Match contacts"
            onPress={() => void matchContacts()}
            variant="secondary"
            compact
            style={styles.button}
          />
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {showSettings ? (
          <Button
            compact
            label="Open system settings"
            onPress={() => void Linking.openSettings()}
            variant="secondary"
          />
        ) : null}
      </View>

      {busy && busy !== 'search' && busy !== 'contacts' && results.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : null}

      <FlatList
        contentContainerStyle={
          results.length === 0 ? styles.emptyList : styles.resultList
        }
        data={results}
        keyExtractor={(item) => item.user.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.personRow}>
            <Avatar
              name={item.user.displayName}
              uri={item.user.avatarUrl}
              size={46}
            />
            <View style={styles.personCopy}>
              <Text numberOfLines={1} style={styles.personName}>
                {item.user.displayName ?? 'Unnamed contact'}
              </Text>
              <Text numberOfLines={1} style={styles.personDetail}>
                {item.detail}
              </Text>
            </View>
            <Button
              busy={busy === item.user.id}
              disabled={busy !== null}
              label="Chat"
              onPress={() => void startConversation(item.user)}
              compact
            />
          </View>
        )}
        ListEmptyComponent={
          mode === 'idle' ? (
            <EmptyState
              body="Type a name above, or match contacts when you’re ready. Up to 100 normalized numbers are sent to the API for matching and are not persisted by this app."
              title="Find your test partner"
            />
          ) : (
            <EmptyState
              body={
                mode === 'contacts'
                  ? 'None of the valid numbers in this batch belong to another Chateo user.'
                  : 'No completed profile matched that display name.'
              }
              title="No matches"
            />
          )
        }
      />
    </View>
  );
}

async function readContactNumbers(
  defaultCountry: CountryCode | undefined,
): Promise<string[]> {
  const unique = new Set<string>();
  const pageSize = 250;

  for (let offset = 0; unique.size < 100; offset += pageSize) {
    const contacts = await Contact.getAllDetails([ContactField.PHONES], {
      limit: pageSize,
      offset,
    });

    for (const contact of contacts) {
      for (const phone of contact.phones ?? []) {
        const raw = phone.number?.trim();
        if (!raw) continue;
        const parsed = parsePhoneNumberFromString(raw, defaultCountry);
        if (parsed?.isValid()) unique.add(parsed.number);
        if (unique.size === 100) break;
      }
      if (unique.size === 100) break;
    }

    if (contacts.length < pageSize) break;
  }

  return [...unique];
}

function readCountry(phoneNumber: string | undefined): CountryCode | undefined {
  if (!phoneNumber) return undefined;
  return parsePhoneNumberFromString(phoneNumber)?.country;
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  controls: { gap: 11, padding: 18 },
  buttonRow: { flexDirection: 'row', gap: 9 },
  button: { flex: 1 },
  loader: { marginTop: 24 },
  resultList: { paddingBottom: 24, paddingHorizontal: 10 },
  emptyList: { flexGrow: 1 },
  personRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 13,
  },
  personCopy: { flex: 1, minWidth: 0 },
  personName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  personDetail: { color: colors.textSubtle, fontSize: 11, marginTop: 4 },
});
