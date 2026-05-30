/**
 * Settings — Account-focused settings screen with iOS grouped list style.
 * Taste preferences are in a separate sub-screen.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '~/src/theme/colors';
import { useTestMode } from '~/src/context/TestModeContext';
import { useAuthContext } from '~/src/context/AuthContext';
import { getMe, deleteMe, type UserSummary } from '~/src/api/users';

const SUPPORT_EMAIL = 'support@biteright.app';
const PRIVACY_URL = 'https://biteright.app/privacy';

// ── Types ─────────────────────────────────────────────────────────────────────

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface RowItem {
  icon: IoniconsName;
  label: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
}

interface ToggleItem {
  icon: IoniconsName;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}

// ── Row components ────────────────────────────────────────────────────────────

const ICON_COLOR = 'rgba(138, 122, 108, 0.7)'; // textMuted at ~70% opacity

function SettingsRow({ icon, label, value, onPress, chevron = true }: RowItem) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress}
    >
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={18} color={ICON_COLOR} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {chevron && onPress ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function SettingsToggle({ icon, label, value, onValueChange }: ToggleItem) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={18} color={ICON_COLOR} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceSoft, true: colors.accentSoft }}
        thumbColor={value ? colors.accent : '#fff'}
      />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const { isTestMode, toggleTestMode } = useTestMode();
  const { user, signOut } = useAuthContext();
  const email = user?.email ?? null;

  // Pull the user row from the server so Name/Username display the truth,
  // not stale hardcoded "Pooja" / "@pooja". Refreshes whenever the screen
  // mounts (returning from edit-name / edit-username).
  const [me, setMe] = useState<UserSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((u) => { if (!cancelled) setMe(u); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleLogOut = () => {
    Alert.alert('Log out?', 'You’ll need to log back in to keep using ByteRite.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          // AuthContext's protected-route effect picks up the cleared session
          // and redirects to /(auth)/login automatically; no explicit nav here.
        },
      },
    ]);
  };

  const handleChangePassword = () => {
    router.push('/(tabs)/profile/change-password' as never);
  };

  const handleEditName = () => {
    router.push('/(tabs)/profile/edit-name' as never);
  };
  const handleEditUsername = () => {
    router.push('/(tabs)/profile/edit-username' as never);
  };

  const openExternal = (url: string) => async () => {
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (!ok) {
      Alert.alert('Could not open link', url);
      return;
    }
    Linking.openURL(url);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This will erase your profile, logs, saved restaurants, and friendships. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMe();
              await signOut();
            } catch (e: any) {
              Alert.alert(
                'Could not delete account',
                e?.response?.data?.error || e?.message || 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };


  // Notifications
  const [notifRecs, setNotifRecs] = useState(true);
  const [notifFriends, setNotifFriends] = useState(true);
  const [notifTrending, setNotifTrending] = useState(false);

  // Privacy
  const [showRatings, setShowRatings] = useState(true);
  const [showActivity, setShowActivity] = useState(true);

  // Privacy
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);

  // App
  const [distanceUnit, setDistanceUnit] = useState<'mi' | 'km'>('mi');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Account ── */}
        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.group}>
          <SettingsRow icon="person-outline" label="Name" value={me?.displayName ?? '…'} onPress={handleEditName} />
          <View style={styles.separator} />
          <SettingsRow icon="at-outline" label="Username" value={me ? `@${me.username}` : '…'} onPress={handleEditUsername} />
          <View style={styles.separator} />
          <SettingsRow
            icon="mail-outline"
            label="Email"
            value={email ?? 'Not signed in'}
            chevron={false}
          />
          <View style={styles.separator} />
          <SettingsRow
            icon="call-outline"
            label={me?.phone ? 'Phone number' : 'Add phone number'}
            value={me?.phone ?? undefined}
            onPress={() => router.push('/(tabs)/profile/edit-phone' as never)}
          />
          <View style={styles.separator} />
          <SettingsRow icon="lock-closed-outline" label="Change password" onPress={handleChangePassword} />
          <View style={styles.separator} />
          <SettingsRow icon="camera-outline" label="Profile photo" onPress={() => router.push('/(tabs)/profile/profile-photo' as never)} />
        </View>

        {/* ── Privacy & Security ── */}
        <Text style={styles.sectionHeader}>PRIVACY & SECURITY</Text>
        <View style={styles.group}>
          <SettingsRow
            icon="eye-outline"
            label="Who can see my posts"
            value={me?.visibility === 'friends' ? 'Friends only' : me?.visibility === 'private' ? 'Only me' : 'Everyone'}
            onPress={() => router.push('/(tabs)/profile/visibility' as never)}
          />
          <View style={styles.separator} />
          <SettingsToggle
            icon="star-outline"
            label="Show ratings publicly"
            value={showRatings}
            onValueChange={setShowRatings}
          />
          <View style={styles.separator} />
          <SettingsToggle
            icon="pulse-outline"
            label="Show activity to friends"
            value={showActivity}
            onValueChange={setShowActivity}
          />
          <View style={styles.separator} />
          <SettingsRow icon="people-outline" label="Blocked users" onPress={() => router.push('/(tabs)/profile/blocked-users' as never)} />
        </View>

        {/* ── Notifications ── */}
        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
        <View style={styles.group}>
          <SettingsToggle
            icon="restaurant-outline"
            label="New recommendations"
            value={notifRecs}
            onValueChange={setNotifRecs}
          />
          <View style={styles.separator} />
          <SettingsToggle
            icon="people-outline"
            label="Friends activity"
            value={notifFriends}
            onValueChange={setNotifFriends}
          />
          <View style={styles.separator} />
          <SettingsToggle
            icon="trending-up-outline"
            label="Trending spots"
            value={notifTrending}
            onValueChange={setNotifTrending}
          />
        </View>

        {/* ── Taste Preferences ── */}
        <Text style={styles.sectionHeader}>TASTE PREFERENCES</Text>
        <View style={styles.group}>
          <SettingsRow
            icon="nutrition-outline"
            label="Your taste profile"
            onPress={() => router.push('/(tabs)/profile/taste-preferences' as any)}
          />
        </View>

        {/* ── Location ── */}
        <Text style={styles.sectionHeader}>LOCATION</Text>
        <View style={styles.group}>
          <SettingsToggle
            icon="navigate-outline"
            label="Use current location"
            value={useCurrentLocation}
            onValueChange={setUseCurrentLocation}
          />
          <View style={styles.separator} />
          <SettingsRow
            icon="map-outline"
            label="Default area"
            value={useCurrentLocation ? 'Auto' : 'Set area'}
            onPress={useCurrentLocation ? undefined : () => {}}
            chevron={!useCurrentLocation}
          />
        </View>

        {/* ── App ── */}
        <Text style={styles.sectionHeader}>APP</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              setDistanceUnit((u) => (u === 'mi' ? 'km' : 'mi'));
              Haptics.selectionAsync().catch(() => {});
            }}
            activeOpacity={0.6}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="speedometer-outline" size={18} color={ICON_COLOR} />
              <Text style={styles.rowLabel}>Distance unit</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>{distanceUnit === 'mi' ? 'Miles' : 'Kilometers'}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <SettingsRow icon="help-circle-outline" label="Help & Support" onPress={openExternal(`mailto:${SUPPORT_EMAIL}?subject=ByteRite%20feedback`)} />
          <View style={styles.separator} />
          <SettingsRow icon="document-text-outline" label="Terms & Privacy Policy" onPress={openExternal(PRIVACY_URL)} />
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.row}
            onPress={handleLogOut}
            activeOpacity={0.6}
            onLongPress={() => {
              toggleTestMode();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }}
            delayLongPress={800}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="log-out-outline" size={18} color="rgba(192, 57, 43, 0.75)" />
              <Text style={[styles.rowLabel, styles.dangerText]}>Log out</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Test mode indicator (dev only) */}
        {__DEV__ && isTestMode && (
          <View style={styles.testModeIndicator}>
            <Text style={styles.testModeText}>Test Mode ON</Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/profile/test-preview' as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.testModeLink}>Open Preview →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Danger zone ── */}
        <View style={[styles.group, styles.dangerGroup]}>
          <TouchableOpacity style={styles.row} onPress={handleDeleteAccount} activeOpacity={0.6}>
            <View style={styles.rowLeft}>
              <Ionicons name="trash-outline" size={18} color="rgba(192, 57, 43, 0.75)" />
              <Text style={[styles.rowLabel, styles.dangerText]}>Delete account</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: { padding: 4 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },

  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },

  sectionHeader: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textFaint,
    letterSpacing: 0.5,
    marginTop: 26,
    marginBottom: 8,
    marginLeft: 4,
  },

  group: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 46,
  },

  dangerText: {
    color: '#C0392B',
  },
  dangerGroup: {
    marginTop: 28,
    marginBottom: 20,
  },

  testModeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#FFF3E0',
  },
  testModeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  testModeLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
});
