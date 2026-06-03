import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { FeedCard, type FeedLog } from '~/src/components/FeedCard';
import { FirstVisitTip } from '~/src/components/FirstVisitTip';
import { SearchOverlay } from '~/src/components/SearchOverlay';
import { useFeed } from '~/src/hooks/useFeed';
import { useDiscover } from '~/src/hooks/useDiscover';
import { colors } from '~/src/theme/colors';

// ── Dynamic header ──────────────────────────────────────────────────────────

function useDynamicHeader(items: FeedLog[]) {
  const hour = new Date().getHours();
  const friendPosts = items.filter((l) => l.userName !== 'You').length;

  const isEvening = hour >= 17 || hour < 4;
  const isLunch = hour >= 11 && hour < 14;
  const isMorning = hour >= 6 && hour < 11;

  let headline: string;
  let subline: string;

  if (isEvening && friendPosts >= 3) {
    headline = 'Your friends are eating well';
    subline = 'See what they\u2019ve been loving';
  } else if (isEvening) {
    headline = 'Tonight\u2019s feed';
    subline = 'What your circle has been up to';
  } else if (isLunch) {
    headline = 'Lunch hour';
    subline = 'Recent activity from your friends';
  } else if (isMorning) {
    headline = 'Good morning';
    subline = 'Here\u2019s what your circle has been up to';
  } else {
    headline = 'Your feed';
    subline = 'Recent eats from your circle';
  }

  return { headline, subline };
}

// ── Social labels ───────────────────────────────────────────────────────────
// Annotate ~40-60% of cards with lightweight social context.
// Labels are small inline text ABOVE the card — not section headers.

function computeSocialLabels(items: FeedLog[]): Map<string, { label: string; isHero: boolean }> {
  const labels = new Map<string, { label: string; isHero: boolean }>();
  if (items.length === 0) return labels;

  // Count visits per restaurant across all users
  const friendVisitCounts = new Map<string, number>();
  const totalVisitCounts = new Map<string, number>();
  for (const log of items) {
    totalVisitCounts.set(log.restaurantId, (totalVisitCounts.get(log.restaurantId) ?? 0) + 1);
    if (log.userName !== 'You') {
      friendVisitCounts.set(log.restaurantId, (friendVisitCounts.get(log.restaurantId) ?? 0) + 1);
    }
  }

  let heroAssigned = false;
  let labelCount = 0;

  for (let i = 0; i < items.length; i++) {
    const log = items[i];
    const fCount = friendVisitCounts.get(log.restaurantId) ?? 0;
    const tCount = totalVisitCounts.get(log.restaurantId) ?? 0;

    // Cap at ~50% label density — skip some cards for breathing room
    if (labelCount > 0 && labels.size > 0) {
      // After a labeled card, skip the next one to create rhythm
      const prevId = items[i - 1]?.id;
      if (prevId && labels.has(prevId)) continue;
    }

    // Hero: first card with high score + friend activity
    if (!heroAssigned && i < 3 && log.score >= 8.5 && fCount >= 1) {
      labels.set(log.id, { label: '\u2B50 Most loved this week', isHero: true });
      heroAssigned = true;
      labelCount++;
      continue;
    }

    // Trending: multiple friends been here
    if (fCount >= 3 && !labels.has(log.id)) {
      labels.set(log.id, { label: '\uD83D\uDD25 Trending with friends', isHero: false });
      labelCount++;
      continue;
    }

    // Everyone's been here
    if (tCount >= 3 && fCount >= 2 && !labels.has(log.id)) {
      labels.set(log.id, { label: '\uD83D\uDC40 Everyone\u2019s been here lately', isHero: false });
      labelCount++;
      continue;
    }

    // Friend obsessed: friend posted a 9+
    if (log.userName !== 'You' && log.score >= 9.0 && !labels.has(log.id)) {
      labels.set(log.id, { label: `\u2728 ${log.userName} is obsessed`, isHero: false });
      labelCount++;
      continue;
    }

    // Repeat visitor
    if (log.visitCount && log.visitCount >= 3 && !labels.has(log.id)) {
      labels.set(log.id, { label: '\uD83D\uDD01 Keep coming back', isHero: false });
      labelCount++;
      continue;
    }

    // Hero fallback
    if (!heroAssigned && i === 0 && log.score >= 8.0) {
      labels.set(log.id, { label: '\uD83C\uDF7D Your circle\u2019s favorite', isHero: true });
      heroAssigned = true;
      labelCount++;
    }
  }

  return labels;
}

// ── Feed screen ─────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const { items } = useFeed();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const itemCountRef = useRef(items.length);
  const [searchOpen, setSearchOpen] = useState(false);
  const { headline, subline } = useDynamicHeader(items);
  // Social labels disabled — keeping feed clean
  const socialLabels = useMemo(() => new Map<string, { label: string; isHero: boolean }>(), []);

  // Keep userCoords available for search overlay
  const { userCoords } = useDiscover('you');

  useEffect(() => {
    if (items.length > itemCountRef.current) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
    itemCountRef.current = items.length;
  }, [items.length]);

  // Whenever the Feed tab regains focus (user came back from another tab
  // or from a detail screen), snap the list to the top. Without this, the
  // feed stayed wherever the user left off — confusing for the "home"
  // screen, which should always present the freshest content first.
  useFocusEffect(
    useCallback(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, []),
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedLog }) => {
      const sl = socialLabels.get(item.id);
      return (
        <FeedCard
          log={item}
          socialLabel={sl?.label ?? null}
          isHero={sl?.isHero ?? false}
        />
      );
    },
    [socialLabels],
  );

  const keyExtractor = useCallback((item: FeedLog) => item.id, []);

  return (
    <View style={s.root}>
      <SafeAreaView style={s.safe} edges={['top']}>
        <StatusBar barStyle="dark-content" />

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerTopRow}>
            <View style={s.brandBlock}>
              <Text style={s.brandName}>ByteRite</Text>
              <Text style={s.brandTagline}>Your Taste, Perfected</Text>
            </View>
            <TouchableOpacity
              style={s.searchBtn}
              onPress={() => setSearchOpen(true)}
              activeOpacity={0.7}
              hitSlop={8}
            >
              <Ionicons name="search-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={s.headline}>{headline}</Text>
          <Text style={s.subline}>{subline}</Text>
        </View>

        <FirstVisitTip
          storageKey="byterite_tip_feed_fab"
          icon="add-circle"
          title="Tap + to log a visit"
          body="Rate places you tried, mark standout dishes, add a photo. Your taste profile builds from these — Discover and group swipes use it."
        />

        {/* ── Feed ── */}
        <View style={s.listWrap}>
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 130 }]}
            showsVerticalScrollIndicator={false}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={9}
          />
          <LinearGradient
            colors={[`${colors.bg}00`, `${colors.bg}D9`, colors.bg]}
            style={s.bottomFade}
            pointerEvents="none"
          />
        </View>
      </SafeAreaView>

      {/* ── FAB ── */}
      <Link href="/(tabs)/log-visit" asChild>
        <TouchableOpacity style={s.fab} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </Link>

      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        userCoords={userCoords}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },

  // Header
  header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brandBlock: { flexShrink: 1 },
  brandName: { fontSize: 14, fontWeight: '700', color: colors.textMuted, letterSpacing: -0.2 },
  brandTagline: { fontSize: 11, color: colors.accentText, fontStyle: 'italic', marginTop: 1, letterSpacing: 0.1 },
  searchBtn: { padding: 6, borderRadius: 20, backgroundColor: colors.surfaceSoft },
  headline: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
    lineHeight: 25,
  },
  subline: { marginTop: 2, fontSize: 12, color: colors.textMuted, fontWeight: '500' },

  // Feed
  listWrap: { flex: 1, position: 'relative' },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 54, zIndex: 1 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 90,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(0,0,0,0.18)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
