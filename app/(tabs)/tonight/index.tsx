import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Swiper from 'react-native-deck-swiper';
import { Ionicons } from '@expo/vector-icons';
import { TonightCard } from '~/src/components/TonightCard';
import { useTonightDeck } from '~/src/hooks/useTonightDeck';
import { createTonightSession } from '~/src/api/tonight';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { useTonightSession } from '~/src/context/TonightContext';
import { colors } from '~/src/theme/colors';
import * as Clipboard from 'expo-clipboard';

/** Bottom inset so the stacked deck doesn’t clip against the tab bar. */
const BOTTOM_UI_RESERVED = 24;

export default function TonightScreen() {
  const { cards, loadDeck, swipe, loading } = useTonightDeck();
  const { saveRestaurant, isSaved } = useSavedRestaurants();
  const { session, setSession, clearSession } = useTonightSession();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const swiperRef = useRef<Swiper<any> | null>(null);
  const [swipeIntent, setSwipeIntent] = useState<'left' | 'right' | 'up' | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSwiping = () => {
    // Keep swipe feedback minimal: no extra overlays or icon changes while dragging.
    if (swipeIntent !== null) setSwipeIntent(null);
    if (!isDraggingCard) setIsDraggingCard(true);
    if (dragEndTimerRef.current) clearTimeout(dragEndTimerRef.current);
    dragEndTimerRef.current = setTimeout(() => setIsDraggingCard(false), 180);
  };

  const clearSwipeIntent = () => {
    setSwipeIntent(null);
    setIsDraggingCard(false);
    if (dragEndTimerRef.current) {
      clearTimeout(dragEndTimerRef.current);
      dragEndTimerRef.current = null;
    }
  };

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
      const deepLink = `biteright://tonight/join?code=${res.code}`;
      setInviteLink(deepLink);
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
      {/* Compact header: title + small group affordance */}
      <View style={styles.header}>
        <Text style={styles.title}>Tonight</Text>
        {session ? (
          <>
            <View style={styles.groupRow}>
              <TouchableOpacity
                style={styles.groupPillSoft}
                onPress={() => router.replace('/(tabs)/tonight/swipe')}
                activeOpacity={0.8}
              >
                <Ionicons name="people-outline" size={16} color={colors.text} />
                <Text style={styles.groupPillSoftText}>Group active</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.invitePill} onPress={() => setInviteOpen(true)} activeOpacity={0.85}>
                <Ionicons name="share-outline" size={16} color={colors.text} />
                <Text style={styles.invitePillText}>Invite</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.linkRow}>
              <TouchableOpacity onPress={() => router.replace('/(tabs)/tonight/matches')}>
                <Text style={styles.sessionHintLink}>See matches</Text>
              </TouchableOpacity>
              <Text style={styles.sessionHintText}> · </Text>
              <TouchableOpacity onPress={clearSession}>
                <Text style={styles.sessionHintLink}>Leave</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity
            style={styles.createGroupLink}
            onPress={handleCreateGroup}
            activeOpacity={0.7}
            disabled={creating}
          >
            {creating ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                <Text style={styles.createGroupLinkText}>Create group</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
      <Modal
        visible={inviteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteOpen(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setInviteOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Invite friends</Text>
            <Text style={styles.modalCode}>{session?.code ?? ''}</Text>
            <Text style={styles.modalLink} numberOfLines={1}>
              {inviteLink ?? (session?.code ? `biteright://tonight/join?code=${session.code}` : '')}
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButton}
                activeOpacity={0.85}
                onPress={async () => {
                  const link = inviteLink ?? (session?.code ? `biteright://tonight/join?code=${session.code}` : null);
                  if (!link) return;
                  await Clipboard.setStringAsync(link);
                  Alert.alert('Copied', 'Invite link copied.');
                }}
              >
                <Text style={styles.modalButtonText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                activeOpacity={0.85}
                onPress={() => {
                  const link = inviteLink ?? (session?.code ? `biteright://tonight/join?code=${session.code}` : null);
                  if (!link) return;
                  Share.share({ message: link }).catch(() => {});
                }}
              >
                <Text style={styles.modalButtonText}>Share link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                activeOpacity={0.85}
                onPress={() => setInviteOpen(false)}
              >
                <Text style={[styles.modalButtonText, styles.modalButtonSecondaryText]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

      {/* Swipe-first deck */}
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
        <View style={styles.tonightMain}>
          <View style={styles.deckClipZone}>
            <Swiper
              ref={swiperRef}
              key={cards[0]?.restaurant?.id ?? 'empty'}
              cards={cards}
              renderCard={(card) => (
                <TonightCard
                  card={card}
                  saved={isSaved(card.restaurant.id)}
                  swipeIntent={swipeIntent}
                  hideActions={isDraggingCard}
                  onOtherOptions={() => swiperRef.current?.swipeLeft()}
                  onLockIn={() => swiperRef.current?.swipeRight()}
                />
              )}
              backgroundColor={colors.bg}
              containerStyle={styles.swiperContainer}
              cardStyle={styles.swiperCardShell}
              stackSize={3}
              stackScale={4}
              stackSeparation={14}
              cardVerticalMargin={6}
              marginBottom={BOTTOM_UI_RESERVED}
              onSwiping={handleSwiping}
              onSwipedAborted={clearSwipeIntent}
              onSwipedRight={(index) => {
                clearSwipeIntent();
                const card = cards[index];
                swipe(card, 'like');
                saveRestaurant(
                  {
                    place_id: card.restaurant.id,
                    name: card.restaurant.name,
                    photo: card.imageUrl ?? card.heroPhotoUrl ?? undefined,
                    cuisine: card.restaurant.cuisine || undefined,
                    neighborhood: card.restaurant.neighborhood ?? undefined,
                    price_level: card.restaurant.priceLevel ?? undefined,
                  },
                  'swipe',
                );
              }}
              onSwipedLeft={(index) => {
                clearSwipeIntent();
                swipe(cards[index], 'pass');
              }}
              onSwipedTop={(index) => {
                clearSwipeIntent();
                swipe(cards[index], 'super_like');
              }}
            />
          </View>
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
  header: {
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 4,
  },
  groupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  groupPillOutlined: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  groupPillOutlinedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  createGroupLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  createGroupLinkText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  groupPillSoft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupPillSoftText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  groupRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  invitePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  invitePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  linkRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  modalCode: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  modalLink: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 14,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonSecondary: {
    backgroundColor: colors.surface,
  },
  modalButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  modalButtonSecondaryText: {
    color: colors.textMuted,
  },
  sessionHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  sessionHintText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  sessionHintLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  sessionHintSolo: {
    paddingHorizontal: 20,
    marginBottom: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  errorText: {
    marginTop: 4,
    marginHorizontal: 20,
    fontSize: 13,
    color: '#b91c1c',
  },
  deckPlaceholder: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  /** Fills tab body; minHeight 0 so nested flex + overflow hidden clip correctly */
  tonightMain: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bg,
  },
  /** Only the swiper stack — clipped so scaled/stacked cards never reveal footer chrome */
  deckClipZone: {
    flex: 1,
    minHeight: 0,
    zIndex: 2,
    elevation: 4,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  swiperContainer: {
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  /** Solid backdrop in stack gaps (do not set zIndex here — it would override deck-swiper stack order) */
  swiperCardShell: {
    backgroundColor: colors.bg,
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
