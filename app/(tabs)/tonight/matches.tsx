import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTonightMatches } from '~/src/api/tonight';
import { useTonightSession } from '~/src/context/TonightContext';
import { colors } from '~/src/theme/colors';
import type { MatchItem } from '~/src/api/tonight';

const POLL_INTERVAL_MS = 5000;

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
      router.replace('/(tabs)/tonight');
      return;
    }
    fetchMatches();
    const id = setInterval(fetchMatches, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [session?.code, fetchMatches, router]);

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
        <TouchableOpacity onPress={() => router.replace('/(tabs)/tonight')}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Group matches</Text>
        <Text style={styles.subtitle}>
          Restaurants everyone liked ({totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}, need {likesRequired} like{likesRequired !== 1 ? 's' : ''})
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
        <FlatList
          data={matches}
          keyExtractor={(item) => item.restaurantId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              {item.previewPhotoUrl ? (
                <Image source={{ uri: item.previewPhotoUrl }} style={styles.photo} />
              ) : (
                <View style={styles.photoPlaceholder} />
              )}
              <View style={styles.cardMeta}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardAddress}>{item.address}</Text>
                <Text style={styles.percent}>{item.percentMatch}% match</Text>
              </View>
            </View>
          )}
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
    fontWeight: '700',
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
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: {
    width: 80,
    height: 80,
    backgroundColor: colors.surfaceSoft,
  },
  photoPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: colors.surfaceSoft,
  },
  cardMeta: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardAddress: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
  },
  percent: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
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
