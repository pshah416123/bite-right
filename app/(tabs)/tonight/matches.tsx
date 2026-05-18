import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getTonightMatches } from '~/src/api/tonight';
import { useTonightSession } from '~/src/context/TonightContext';
import { colors } from '~/src/theme/colors';
import type { MatchItem } from '~/src/api/tonight';
import { RestaurantImage } from '~/src/components/RestaurantImage';

const POLL_INTERVAL_MS = 5000;

type MatchSection = {
  title: string;
  icon: string;
  color: string;
  subtitle: string;
  data: MatchItem[];
};

function categorizeMatches(
  matches: MatchItem[],
  totalParticipants: number,
): MatchSection[] {
  const perfect: MatchItem[] = [];
  const strong: MatchItem[] = [];
  const tiebreaker: MatchItem[] = [];

  for (const m of matches) {
    if (m.percentMatch === 100) {
      perfect.push(m);
    } else if (m.percentMatch >= 60) {
      strong.push(m);
    } else {
      tiebreaker.push(m);
    }
  }

  const sections: MatchSection[] = [];
  if (perfect.length > 0) {
    sections.push({
      title: 'Perfect Matches',
      icon: 'star',
      color: '#f59e0b',
      subtitle: 'Everyone swiped right',
      data: perfect,
    });
  }
  if (strong.length > 0) {
    sections.push({
      title: 'Strong Contenders',
      icon: 'flame',
      color: colors.accent,
      subtitle: 'Most of the group liked these',
      data: strong,
    });
  }
  if (tiebreaker.length > 0) {
    sections.push({
      title: 'Tiebreakers',
      icon: 'help-circle',
      color: colors.textMuted,
      subtitle: 'Could go either way — discuss!',
      data: tiebreaker,
    });
  }
  return sections;
}

export default function TonightMatchesScreen() {
  const { session } = useTonightSession();
  const router = useRouter();
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [likesRequired, setLikesRequired] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatches = useCallback(() => {
    if (!session?.code) return;
    getTonightMatches(session.code)
      .then((res) => {
        setMatches(res.matches);
        setTotalParticipants(res.totalParticipants);
        setLikesRequired(res.likesRequired);
        setError(null);
      })
      .catch((err) => {
        setError(err.response?.data?.error || err.message || 'Failed to load matches');
      })
      .finally(() => setLoading(false));
  }, [session?.code]);

  useEffect(() => {
    if (!session?.code) {
      router.navigate('/(tabs)/tonight');
      return;
    }
    fetchMatches();
    const id = setInterval(fetchMatches, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [session?.code, fetchMatches, router]);

  const sections = useMemo(
    () => categorizeMatches(matches, totalParticipants),
    [matches, totalParticipants],
  );

  if (!session) {
    return null;
  }

  if (loading && matches.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.helper}>Loading matches…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.navigate('/(tabs)/tonight')}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Group Results</Text>
        <Text style={styles.subtitle}>
          {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''} · {matches.length} match{matches.length !== 1 ? 'es' : ''}
        </Text>
      </View>
      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={fetchMatches} style={styles.button}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No matches yet</Text>
          <Text style={styles.helper}>
            When everyone has swiped, places everyone liked will show here.
          </Text>
          <TouchableOpacity onPress={fetchMatches} style={styles.button}>
            <Text style={styles.buttonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.restaurantId}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name={section.icon as any} size={18} color={section.color} />
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View style={[styles.countBadge, { backgroundColor: section.color + '20' }]}>
                  <Text style={[styles.countBadgeText, { color: section.color }]}>{section.data.length}</Text>
                </View>
              </View>
              <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
            </View>
          )}
          renderItem={({ item, section }) => (
            <TouchableOpacity
              style={[
                styles.card,
                section.title === 'Perfect Matches' && styles.perfectCard,
              ]}
              activeOpacity={0.85}
              onPress={() => router.push(`/(tabs)/restaurant/${encodeURIComponent(item.restaurantId)}`)}
            >
              <RestaurantImage
                restaurant={{
                  id: item.restaurantId,
                  name: item.name,
                  displayImageUrl: item.displayImageUrl ?? item.previewPhotoUrl ?? null,
                  previewPhotoUrl: item.previewPhotoUrl ?? null,
                }}
                aspectRatio={1}
                fallbackType="icon"
                borderRadius={0}
                style={styles.photo}
              />
              <View style={styles.cardMeta}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardAddress} numberOfLines={1}>{item.address}</Text>
                <View style={styles.matchRow}>
                  <View style={styles.matchBarBg}>
                    <View style={[styles.matchBarFill, { width: `${item.percentMatch}%`, backgroundColor: item.percentMatch === 100 ? '#f59e0b' : colors.accent }]} />
                  </View>
                  <Text style={[styles.percent, item.percentMatch === 100 && { color: '#f59e0b' }]}>
                    {item.percentMatch}%
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          renderSectionFooter={() => <View style={{ height: 12 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backText: {
    fontSize: 16,
    color: colors.accent,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },

  // Section headers
  sectionHeader: {
    marginBottom: 12,
    marginTop: 4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 26,
  },

  // Cards
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  perfectCard: {
    borderColor: '#f59e0b40',
    borderWidth: 1.5,
  },
  photo: {
    width: 80,
    height: 80,
  },
  cardMeta: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  cardAddress: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  matchBarBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  matchBarFill: {
    height: 4,
    borderRadius: 2,
  },
  percent: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
    minWidth: 32,
    textAlign: 'right',
  },
  helper: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  button: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.accent,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
