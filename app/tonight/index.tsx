import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Swiper from 'react-native-deck-swiper';
import { TonightCard } from '../../src/components/TonightCard';
import { useTonightDeck } from '../../src/hooks/useTonightDeck';
import { createTonightSession } from '../../src/api/tonight';
import { useTonightSession } from '../../src/context/TonightContext';
import { colors } from '../../src/theme/colors';

export default function TonightScreen() {
  const { cards, loadDeck, swipe, loading } = useTonightDeck();
  const { session, setSession, clearSession } = useTonightSession();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const handleCreateGroup = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createTonightSession({});
      setSession({
        sessionId: res.sessionId,
        code: res.code,
        participantId: res.participantId,
      });
      const message = `Join my BiteRight group to pick where we eat! Swipe on restaurants and we’ll see our matches.\n${res.shareUrl}`;
      await Share.share({
        message,
        url: res.shareUrl,
        title: 'Join Tonight’s group',
      });
      router.replace('/tonight/swipe');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      setCreateError(msg || (err instanceof Error ? err.message : 'Failed to create session'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Group option at top */}
      <View style={styles.groupSection}>
        <Text style={styles.sectionLabel}>Swipe with friends</Text>
        {creating ? (
          <View style={styles.groupRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.creatingText}>Creating…</Text>
          </View>
        ) : session ? (
          <View style={styles.sessionRow}>
            <TouchableOpacity
              style={styles.groupButton}
              onPress={() => router.replace('/tonight/swipe')}
            >
              <Text style={styles.groupButtonText}>Continue to swipe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.groupButtonOutlined}
              onPress={() => router.replace('/tonight/matches')}
            >
              <Text style={styles.groupButtonOutlinedText}>See matches</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearSession}>
              <Text style={styles.leaveText}>Leave session</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.groupButton} onPress={handleCreateGroup} activeOpacity={0.8}>
            <Text style={styles.groupButtonText}>Create Group</Text>
          </TouchableOpacity>
        )}
        {createError ? (
          <Text style={styles.errorText}>{createError}</Text>
        ) : null}
      </View>

      {/* Solo swipe below — no group needed */}
      <Text style={styles.sectionLabel}>Tonight’s picks for you</Text>
      {loading ? (
        <View style={styles.deckPlaceholder}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.helper}>Curating picks…</Text>
        </View>
      ) : !cards.length ? (
        <View style={styles.deckPlaceholder}>
          <Text style={styles.emptyTitle}>No picks yet</Text>
          <Text style={styles.helper}>Once your taste profile warms up, Tonight will feel magical.</Text>
        </View>
      ) : (
        <View style={styles.deckContainer}>
          <Swiper
            key={cards[0]?.restaurant?.id ?? 'empty'}
            cards={cards}
            renderCard={(card) => <TonightCard card={card} />}
            backgroundColor={colors.bg}
            stackSize={3}
            onSwipedRight={(index) => swipe(cards[index], 'like')}
            onSwipedLeft={(index) => swipe(cards[index], 'pass')}
            onSwipedTop={(index) => swipe(cards[index], 'super_like')}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  groupSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  creatingText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  sessionRow: {
    gap: 10,
  },
  groupButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: colors.accent,
    borderRadius: 14,
    alignSelf: 'flex-start',
  },
  groupButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  groupButtonOutlined: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  groupButtonOutlinedText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  leaveText: {
    marginTop: 6,
    fontSize: 14,
    color: colors.textMuted,
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#b91c1c',
  },
  deckPlaceholder: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  deckContainer: {
    flex: 1,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 24,
  },
  helper: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
});
