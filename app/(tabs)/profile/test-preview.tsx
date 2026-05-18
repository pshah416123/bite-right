/**
 * Test Preview — Dev-only screen to preview UI components in edge-case states.
 * Only accessible when Test Mode is ON via Settings.
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';
import { useTestMode } from '~/src/context/TestModeContext';
import { TEST_FEED_LOGS, TEST_DISCOVER_ITEMS, TEST_COMPARE_RESTAURANTS } from '~/src/data/testMockData';
import { FeedCard } from '~/src/components/FeedCard';
import { RestaurantCard } from '~/src/components/RestaurantCard';
import { useCompare } from '~/src/context/CompareContext';

type Section = 'feed' | 'discover' | 'compare';

export default function TestPreviewScreen() {
  const router = useRouter();
  const { isTestMode } = useTestMode();
  const { toggle, clear, openSheet, selected } = useCompare();
  const [activeSection, setActiveSection] = useState<Section>('feed');

  // Guard: only accessible in dev + test mode
  if (!__DEV__ || !isTestMode) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.unavailable}>Test mode is not active.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const loadCompare = () => {
    clear();
    TEST_COMPARE_RESTAURANTS.forEach((r) => toggle(r));
    openSheet();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Test Preview</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>DEV</Text>
        </View>
      </View>

      {/* Section tabs */}
      <View style={styles.tabRow}>
        {(['feed', 'discover', 'compare'] as Section[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, activeSection === s && styles.tabActive]}
            onPress={() => setActiveSection(s)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeSection === s && styles.tabTextActive]}>
              {s === 'feed' ? 'Feed' : s === 'discover' ? 'Discover' : 'Compare'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {activeSection === 'feed' && (
          <>
            <Text style={styles.sectionDesc}>
              Edge-case feed cards: no image, long name, minimal data, return visit, friend post, low score, all vibes
            </Text>
            {TEST_FEED_LOGS.map((log, i) => (
              <View key={log.id} style={styles.cardWrap}>
                <Text style={styles.cardLabel}>
                  {i === 0 && 'No image'}
                  {i === 1 && 'Long name + note'}
                  {i === 2 && 'Minimal data'}
                  {i === 3 && 'Return visit (5th)'}
                  {i === 4 && "Friend's post"}
                  {i === 5 && 'Low score (2.1)'}
                  {i === 6 && 'All vibe tags'}
                </Text>
                <FeedCard log={log} />
              </View>
            ))}
          </>
        )}

        {activeSection === 'discover' && (
          <>
            <Text style={styles.sectionDesc}>
              Edge-case discover cards: no image, long name, 0% match, far distance, social proof, nearby
            </Text>
            {TEST_DISCOVER_ITEMS.map((item, i) => (
              <View key={item.restaurant.id} style={styles.cardWrap}>
                <Text style={styles.cardLabel}>
                  {i === 0 && 'No image'}
                  {i === 1 && 'Long name + 100% match'}
                  {i === 2 && '0% match + empty fields'}
                  {i === 3 && 'Far away (BBQ)'}
                  {i === 4 && 'Friend visits'}
                  {i === 5 && 'Walking distance'}
                </Text>
                <RestaurantCard
                  item={item}
                  userCoords={{ lat: 41.88, lng: -87.63 }}
                />
              </View>
            ))}
          </>
        )}

        {activeSection === 'compare' && (
          <>
            <Text style={styles.sectionDesc}>
              Loads 3 test restaurants into compare and opens the sheet.
            </Text>
            <TouchableOpacity style={styles.compareBtn} onPress={loadCompare} activeOpacity={0.7}>
              <Ionicons name="git-compare-outline" size={18} color="#fff" />
              <Text style={styles.compareBtnText}>
                {selected.length > 0 ? `${selected.length} loaded — Open Sheet` : 'Load Compare Data'}
              </Text>
            </TouchableOpacity>

            <View style={styles.compareInfo}>
              <Text style={styles.compareInfoTitle}>Test restaurants:</Text>
              {TEST_COMPARE_RESTAURANTS.map((r) => (
                <Text key={r.id} style={styles.compareInfoItem}>
                  • {r.name} — {r.cuisine}
                  {r.priceLevel ? ` · ${'$'.repeat(r.priceLevel)}` : ''}
                </Text>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  unavailable: {
    textAlign: 'center',
    marginTop: 100,
    fontSize: 16,
    color: colors.textMuted,
  },
  backLink: {
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: '#fff',
  },

  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 60,
  },
  sectionDesc: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: 12,
    lineHeight: 17,
  },

  cardWrap: {
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  compareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.accent,
    marginBottom: 16,
  },
  compareBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  compareInfo: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  compareInfoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  compareInfoItem: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: 4,
    lineHeight: 18,
  },
});
