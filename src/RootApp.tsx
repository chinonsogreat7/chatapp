import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import SocketLab from '../App';
import { AuthScreen } from './product/AuthScreen';
import { ChatsScreen } from './product/ChatsScreen';
import { ChatScreen } from './product/ChatScreen';
import { DiscoverScreen } from './product/DiscoverScreen';
import { ProfileScreen } from './product/ProfileScreen';
import { RealtimeProvider } from './product/RealtimeProvider';
import { SessionProvider, useSession } from './product/SessionProvider';
import { colors } from './product/theme';
import type { Conversation } from './product/types';
import { LoadingScreen, ui } from './product/ui';

type MainTab = 'chats' | 'people' | 'lab' | 'profile';

export default function RootApp() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        <SessionGate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function SessionGate() {
  const { phase, session } = useSession();

  if (phase === 'loading') return <LoadingScreen />;
  if (phase === 'signedOut' || !session) return <AuthScreen />;
  if (!session.user.profileComplete) return <ProfileScreen onboarding />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [tab, setTab] = useState<MainTab>('chats');
  const [conversation, setConversation] = useState<Conversation | null>(null);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (conversation) {
        setConversation(null);
        return true;
      }
      if (tab !== 'chats') {
        setTab('chats');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [conversation, tab]);

  return (
    <RealtimeProvider enabled={tab !== 'lab' || conversation !== null}>
      {conversation ? (
        <ChatScreen conversation={conversation} onBack={() => setConversation(null)} />
      ) : (
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <View style={styles.content}>
            {tab === 'chats' ? (
              <ChatsScreen
                onFindPeople={() => setTab('people')}
                onOpen={setConversation}
              />
            ) : null}
            {tab === 'people' ? (
              <DiscoverScreen onOpen={setConversation} />
            ) : null}
            {tab === 'profile' ? <ProfileScreen /> : null}
            {tab === 'lab' ? <SocketLab /> : null}
          </View>
          <TabBar active={tab} onChange={setTab} />
        </SafeAreaView>
      )}
    </RealtimeProvider>
  );
}

function TabBar({
  active,
  onChange,
}: {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}) {
  return (
    <View style={styles.tabBar}>
      <Tab active={active === 'chats'} label="Chats" onPress={() => onChange('chats')} />
      <Tab
        active={active === 'people'}
        label="People"
        onPress={() => onChange('people')}
      />
      <Tab active={active === 'lab'} label="Lab" onPress={() => onChange('lab')} />
      <Tab
        active={active === 'profile'}
        label="You"
        onPress={() => onChange('profile')}
      />
    </View>
  );
}

function Tab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && ui.pressed]}
    >
      <View style={[styles.tabMarker, active && styles.tabMarkerActive]} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { flex: 1 },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 6,
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tabMarker: {
    backgroundColor: colors.textSubtle,
    borderRadius: 3,
    height: 4,
    opacity: 0.35,
    width: 18,
  },
  tabMarkerActive: { backgroundColor: colors.primary, opacity: 1, width: 26 },
  tabText: { color: colors.textSubtle, fontSize: 11, fontWeight: '700' },
  tabTextActive: { color: colors.text, fontWeight: '900' },
});
