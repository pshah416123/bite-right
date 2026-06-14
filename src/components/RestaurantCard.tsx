import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActionSheetIOS,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import {
  useFriendVisitsAtRestaurant,
  type FriendVisitAtRestaurant,
} from '../hooks/useFriendVisitsAtRestaurant';
import { useCompare } from '../context/CompareContext';
import { useSavedRestaurants } from '../context/SavedRestaurantsContext';
import { RestaurantImage } from './RestaurantImage';

export interface DiscoverItem {
  restaurant: {
    id: string;
    name: string;
    cuisine: string;
    neighborhood?: string;
    state?: string;
    address?: string | null;
    priceLevel?: number;
    lat?: number | null;
    lng?: number | null;
    placeId?: string | null;
    googlePlaceId?: string | null;
    cuisines?: string[];
    displayImageUrl?: string | null;
    displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
    displayImageLastResolvedAt?: string | null;
    previewPhotoUrl?: string;
    imageUrl?: string;
    /** Must-try dish chips populated by the server. */
    recommendedDishes?: { name: string; price?: string | null; description?: string | null }[] | null;
  };
  matchScore: number;
  reasonTags: string[];
  heroLabel?: string | null;
  cardTags?: string[];
  socialProofBadge?: string | null;
  friendVisits?: FriendVisitAtRestaurant[] | null;
}

interface Props {
  item: DiscoverItem;
  saved?: boolean;
  userCoords?: { lat: number; lng: number } | null;
  animDelay?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function haversineDistanceMi(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function primaryCuisineLabel(restaurant: DiscoverItem['restaurant']): string {
  const generic = (c: string) => !c || c === 'Restaurant' || c === 'Takeout';
  if (restaurant.cuisines && restaurant.cuisines.length > 0) {
    const first = restaurant.cuisines.find((x) => x && !generic(x));
    if (first) return first;
  }
  if (restaurant.cuisine && !generic(restaurant.cuisine)) return restaurant.cuisine;
  if (restaurant.cuisines?.[0]) return restaurant.cuisines[0];
  return restaurant.cuisine || 'Restaurant';
}

function formatVisitDate(iso?: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Social proof ───────────────────────────────────────────────────────────
// Builds the subtle "Maya, Jay +2 ate here" line below the meta row.
// Returns null when there's no friend signal — caller can skip rendering.

const SOCIAL_PROOF_MAX_NAMES = 2;

function getSocialProofText(visits: FriendVisitAtRestaurant[]): string | null {
  if (!visits || visits.length === 0) return null;
  const names = visits.map((v) => v.userName).filter(Boolean);
  if (names.length === 0) return `${visits.length} friend${visits.length === 1 ? '' : 's'} ate here`;
  // Loved-by language when EVERY visit is a high score (8+); otherwise "ate here"
  const allLoved = visits.every((v) => typeof v.score === 'number' && v.score >= 8);
  const shown = names.slice(0, SOCIAL_PROOF_MAX_NAMES);
  const extra = names.length - shown.length;
  const namePart = extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
  return `${namePart} ${allLoved ? 'loved this' : 'ate here'}`;
}

// ─── RestaurantCard ─────────────────────────────────────────────────────────

export function RestaurantCard({ item, saved, userCoords }: Props) {
  const router = useRouter();
  const { restaurant, matchScore, reasonTags, cardTags, socialProofBadge, friendVisits: friendVisitsProp } = item;
  const fromFeed = useFriendVisitsAtRestaurant(restaurant.id);
  const friendVisits = friendVisitsProp ?? fromFeed;
  const [friendsModalOpen, setFriendsModalOpen] = useState(false);
  const { isSelected: isCompareSelected, toggle: toggleCompare, compareMode } = useCompare();
  const inCompare = isCompareSelected(restaurant.id);
  // Save toggle replaces the per-card compare button (compare still works
  // via the global compare mode + bulk select flow elsewhere). The save
  // key is the placeId when we have one, falling back to restaurant.id so
  // ChIJ-only Discover hits still save reliably.
  const { isSaved, saveRestaurant, removeSaved } = useSavedRestaurants();
  const saveKey = restaurant.placeId ?? restaurant.id;
  const cardIsSaved = saved ?? isSaved(saveKey);
  const [savingThis, setSavingThis] = useState(false);

  const handleToggleSave = async () => {
    if (savingThis) return;
    setSavingThis(true);
    try {
      if (cardIsSaved) {
        await removeSaved(saveKey);
      } else {
        await saveRestaurant(
          {
            place_id: saveKey,
            name: restaurant.name,
            photo: restaurant.displayImageUrl ?? restaurant.imageUrl ?? restaurant.previewPhotoUrl ?? undefined,
            cuisine: cuisine || undefined,
            neighborhood: restaurant.neighborhood || undefined,
            address: restaurant.address ?? undefined,
            lat: typeof restaurant.lat === 'number' ? restaurant.lat : undefined,
            lng: typeof restaurant.lng === 'number' ? restaurant.lng : undefined,
            cuisines: restaurant.cuisines,
            price_level: restaurant.priceLevel,
          },
          'manual',
        );
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } finally {
      setSavingThis(false);
    }
  };

  const cuisine = primaryCuisineLabel(restaurant);

  // Distance
  const hasDistance =
    userCoords && restaurant.lat != null && restaurant.lng != null &&
    isFinite(restaurant.lat!) && isFinite(restaurant.lng!);
  const distanceLabel = hasDistance
    ? `${haversineDistanceMi(userCoords!.lat, userCoords!.lng, restaurant.lat!, restaurant.lng!).toFixed(1)} mi`
    : null;

  const payload = encodeURIComponent(
    JSON.stringify({
      id: restaurant.id,
      name: restaurant.name,
      cuisine,
      cuisines: restaurant.cuisines ?? null,
      neighborhood: restaurant.neighborhood ?? null,
      state: restaurant.state ?? null,
      // Pass the formatted address through so the detail page has a usable
      // address line even if the detail fetch is slow or fails. Without this
      // the address row falls back to just neighborhood ("Chicago"), which
      // looks broken until detail lands.
      address: restaurant.address ?? null,
      priceLevel: restaurant.priceLevel ?? null,
      placeId: restaurant.placeId ?? null,
      googlePlaceId: restaurant.googlePlaceId ?? null,
      displayImageUrl: restaurant.displayImageUrl ?? null,
      displayImageSourceType: restaurant.displayImageSourceType ?? null,
      displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt ?? null,
      previewPhotoUrl: restaurant.previewPhotoUrl ?? null,
      imageUrl: restaurant.imageUrl ?? null,
      matchScore,
      fromLat: userCoords?.lat ?? null,
      fromLng: userCoords?.lng ?? null,
    }),
  );

  const addToCompare = () => {
    toggleCompare({
      id: restaurant.id, name: restaurant.name, cuisine,
      placeId: restaurant.placeId ?? null,
      googlePlaceId: restaurant.googlePlaceId ?? restaurant.placeId ?? null,
      neighborhood: restaurant.neighborhood ?? null,
      priceLevel: restaurant.priceLevel ?? null, matchScore,
      imageUrl: restaurant.displayImageUrl ?? restaurant.imageUrl ?? restaurant.previewPhotoUrl ?? null,
      distanceLabel: distanceLabel ?? null,
      reasonTags: reasonTags ?? [],
      cardTags: cardTags ?? [],
      friendCount: friendVisits.length,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const goRestaurant = () => {
    if (compareMode) {
      addToCompare();
      return;
    }
    router.push(`/restaurant/${encodeURIComponent(restaurant.id)}?payload=${payload}`);
  };

  const handleLongPress = () => {
    const restaurantId = restaurant.id;
    const userId = 'default';
    const options = ['Hide this restaurant', 'Suggest less like this', 'Cancel'];
    const cancelButtonIndex = 2;
    const run = (action: 'hide' | 'suggest_less') => {
      import('../api/discover')
        .then(({ postNegativeFeedback }) => postNegativeFeedback(userId, restaurantId, action))
        .catch(() => {});
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        (buttonIndex) => {
          if (buttonIndex === 0) run('hide');
          else if (buttonIndex === 1) run('suggest_less');
        },
      );
    } else {
      Alert.alert('Adjust recommendations', undefined, [
        { text: 'Hide this restaurant', onPress: () => run('hide') },
        { text: 'Suggest less like this', onPress: () => run('suggest_less') },
        { text: 'Cancel', style: 'cancel' },
      ], { cancelable: true });
    }
  };

  const showFriendStack = friendVisits.length > 0;

  const photoSection = (() => {
    return (
      <View style={styles.photoWrap}>
        <View style={styles.photoTouchable} accessibilityLabel={`${restaurant.name} photo`}>
          <RestaurantImage
            restaurant={{
              id: restaurant.id,
              name: restaurant.name,
              cuisine,
              googlePlaceId: restaurant.googlePlaceId ?? restaurant.placeId ?? null,
              displayImageUrl: restaurant.displayImageUrl ?? restaurant.imageUrl ?? restaurant.previewPhotoUrl ?? null,
              displayImageSourceType: restaurant.displayImageSourceType ?? null,
              displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt ?? null,
              previewPhotoUrl: restaurant.previewPhotoUrl ?? null,
              imageUrl: restaurant.imageUrl ?? null,
            }}
            aspectRatio={1}
            fallbackType="icon"
            borderRadius={18}
            style={styles.photo}
          />
        </View>
      </View>
    );
  })();

  const matchPct = Math.round(matchScore * 100);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.card, inCompare && styles.cardSelected]}
        onPress={goRestaurant}
        onLongPress={handleLongPress}
        delayLongPress={400}
      >
        <View style={styles.row}>
          {photoSection}
          <View style={styles.metaPressable}>
            <View style={styles.meta}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {restaurant.name}
                </Text>
              </View>
              <Text style={styles.secondary} numberOfLines={1}>
                {cuisine}
                {restaurant.neighborhood ? ` \u00B7 ${restaurant.neighborhood}` : ''}
                {distanceLabel ? ` \u00B7 ${distanceLabel}` : ''}
              </Text>
              {/* Social proof row \u2014 subtle, between meta and price.
                  Tappable to open the friend visits modal (same target as the
                  previous photo overlay had). */}
              {showFriendStack ? (
                <Pressable
                  style={styles.socialProofRow}
                  onPress={() => setFriendsModalOpen(true)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`Friends: ${friendVisits.map((f) => f.userName).join(', ')}`}
                >
                  <Ionicons name="people-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.socialProofText} numberOfLines={1}>
                    {getSocialProofText(friendVisits)}
                  </Text>
                </Pressable>
              ) : null}
              {/* Price only for now. "Try the X" was driven by a cuisine-based
                  guess that often didn't match the actual menu; re-enable once
                  dish persistence lands and we can surface the most-favorited
                  dish from real logs. */}
              <Text style={styles.secondary} numberOfLines={1}>
                {Array.from({ length: restaurant.priceLevel ?? 0 }).map(() => '$').join('')}
              </Text>
            </View>
          </View>
          <View style={styles.rightBlock}>
            <View style={styles.rightTop}>
              {matchPct > 0 && (
                <View style={styles.matchPill}>
                  <Text style={styles.matchText}>{matchPct}%</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.compareBtn, cardIsSaved && styles.compareBtnActive]}
                onPress={handleToggleSave}
                disabled={savingThis}
                hitSlop={6}
                activeOpacity={0.7}
                accessibilityLabel={cardIsSaved ? 'Remove from saved' : 'Save restaurant'}
              >
                <Ionicons
                  name={cardIsSaved ? 'bookmark' : 'bookmark-outline'}
                  size={15}
                  color={cardIsSaved ? colors.accent : colors.textFaint}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {/* ── Friends modal ── */}
      <Modal visible={friendsModalOpen} transparent animationType="fade" onRequestClose={() => setFriendsModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFriendsModalOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Friends who ate here</Text>
            <Text style={styles.modalSubtitle}>{restaurant.name}</Text>
            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {friendVisits.map((v) => (
                <View key={v.userName} style={styles.modalRow}>
                  <View style={styles.modalAvatarWrap}>
                    {v.userAvatar ? (
                      <Image source={{ uri: v.userAvatar }} style={styles.modalAvatarImg} />
                    ) : (
                      <View style={styles.modalAvatarFallback}>
                        <Text style={styles.modalAvatarLetter}>{v.userName[0]?.toUpperCase() ?? '?'}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalName}>{v.userName}</Text>
                    <Text style={styles.modalMeta}>{v.score.toFixed(1)} rating \u00B7 {formatVisitDate(v.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setFriendsModalOpen(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  cardSelected: {
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  photoWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    overflow: 'visible',
  },
  photoTouchable: {
    width: 56,
    height: 56,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
  },
  photo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
  },
  // Inline highlight color for the dish name in the "Try: X" line — uses the
  // accentText token (calmer than full CTA orange) so food pops without
  // competing with the match-score pill.
  dishHighlight: {
    color: colors.accentText,
    fontWeight: '600',
  },
  // Subtle social proof row — sits between meta and price. No avatars on the
  // image overlay, no dark bubble, no borders.
  socialProofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  socialProofText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    flexShrink: 1,
  },
  metaPressable: {
    flex: 1,
    marginLeft: 10,
  },
  meta: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  secondary: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  rightBlock: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
  },
  rightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchPill: {
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  compareBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  compareBtnActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSoft,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // ── Modals ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalSubtitle: { marginTop: 4, fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  modalList: { maxHeight: 280 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#fff',
  },
  modalAvatarImg: { width: '100%', height: '100%' },
  modalAvatarFallback: {
    flex: 1,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAvatarLetter: { fontSize: 16, fontWeight: '700', color: colors.text },
  modalName: { fontSize: 16, fontWeight: '600', color: colors.text },
  modalMeta: { marginTop: 2, fontSize: 13, color: colors.textMuted },
  modalClose: { marginTop: 14, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 24 },
  modalCloseText: { fontSize: 16, fontWeight: '600', color: colors.accent },
});
