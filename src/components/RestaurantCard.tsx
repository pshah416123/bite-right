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
import { colors } from '../theme/colors';
import { resolveRestaurantDisplayImage } from '../utils/restaurantImage';
import {
  useFriendVisitsAtRestaurant,
  type FriendVisitAtRestaurant,
} from '../hooks/useFriendVisitsAtRestaurant';

export interface DiscoverItem {
  restaurant: {
    id: string;
    name: string;
    cuisine: string;
    neighborhood?: string;
    state?: string;
    priceLevel?: number;
    placeId?: string | null;
    /** Derived cuisine categories used for chip filtering/ranking. */
    cuisines?: string[];
    /** Normalized resolved card image field (same chain as Feed backend). */
    previewPhotoUrl?: string;
    /** Backward-compatible alias for resolved image URL. */
    imageUrl?: string;
  };
  matchScore: number;
  reasonTags: string[];
  /** One social proof badge: e.g. "3 friends saved this", "Trending tonight", "People like you loved this". */
  socialProofBadge?: string | null;
  /**
   * When provided (e.g. from API), overrides client-side feed lookup for friend avatars.
   */
  friendVisits?: FriendVisitAtRestaurant[] | null;
}

interface Props {
  item: DiscoverItem;
  /** When true, show a saved/bookmark indicator. */
  saved?: boolean;
}

const AVATAR_SIZE = 22;
const AVATAR_OVERLAP = 7;
const MAX_AVATARS = 3;

/** Prefer a specific cuisine label over generic "Restaurant" / "Takeout". */
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
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function FriendAvatar({
  visit,
  index,
}: {
  visit: FriendVisitAtRestaurant;
  index: number;
}) {
  const uri = visit.userAvatar?.trim();
  const initial = visit.userName?.[0]?.toUpperCase() ?? '?';

  return (
    <View
      style={[
        styles.avatarCircle,
        { marginLeft: index > 0 ? -AVATAR_OVERLAP : 0, zIndex: MAX_AVATARS - index },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.avatarImage} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>{initial}</Text>
        </View>
      )}
    </View>
  );
}

export function RestaurantCard({ item, saved }: Props) {
  const router = useRouter();
  const { restaurant, matchScore, reasonTags, socialProofBadge, friendVisits: friendVisitsProp } = item;
  const fromFeed = useFriendVisitsAtRestaurant(restaurant.id);
  const friendVisits = friendVisitsProp ?? fromFeed;
  const [friendsModalOpen, setFriendsModalOpen] = useState(false);

  const resolvedImageUrl = resolveRestaurantDisplayImage({
    previewPhotoUrl: restaurant.previewPhotoUrl,
    imageUrl: restaurant.imageUrl,
  }).url;
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => {
    setImageBroken(false);
  }, [restaurant.id, restaurant.previewPhotoUrl, restaurant.imageUrl]);

  const badge = socialProofBadge || (reasonTags.length ? reasonTags[0] : null);

  const payload = encodeURIComponent(
    JSON.stringify({
      id: restaurant.id,
      name: restaurant.name,
      cuisine: primaryCuisineLabel(restaurant),
      cuisines: restaurant.cuisines ?? null,
      neighborhood: restaurant.neighborhood ?? null,
      state: restaurant.state ?? null,
      priceLevel: restaurant.priceLevel ?? null,
      placeId: restaurant.placeId ?? null,
      previewPhotoUrl: restaurant.previewPhotoUrl ?? null,
      imageUrl: restaurant.imageUrl ?? null,
      matchScore,
    }),
  );

  const goRestaurant = () => {
    router.push(`/(tabs)/restaurant/${encodeURIComponent(restaurant.id)}?payload=${payload}`);
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
      Alert.alert(
        'Adjust recommendations',
        undefined,
        [
          { text: 'Hide this restaurant', onPress: () => run('hide') },
          { text: 'Suggest less like this', onPress: () => run('suggest_less') },
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true },
      );
    }
  };

  const showFriendStack = friendVisits.length > 0;
  const visibleFriends = friendVisits.slice(0, MAX_AVATARS);
  const extraCount = friendVisits.length - MAX_AVATARS;

  const photoSection = (() => {
    const uri = !imageBroken ? resolvedImageUrl : undefined;

    const imageInner = !uri ? (
      <View style={styles.photoPlaceholder}>
        <View style={styles.photoPlaceholderIconWrap}>
          <Ionicons name="camera-outline" size={16} color={colors.textMuted} />
        </View>
      </View>
    ) : (
      <Image
        source={{ uri }}
        style={styles.photo}
        resizeMode="cover"
        onError={() => setImageBroken(true)}
      />
    );

    return (
      <View style={styles.photoWrap}>
        <View style={styles.photoTouchable} accessibilityLabel={`${restaurant.name} photo`}>
          {imageInner}
        </View>
        {showFriendStack ? (
          <Pressable
            style={styles.friendStackPressable}
            onPress={() => setFriendsModalOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Friends who visited: ${friendVisits.map((f) => f.userName).join(', ')}`}
          >
            <View style={styles.friendStackRow}>
              {visibleFriends.map((v, i) => (
                <FriendAvatar key={v.userName} visit={v} index={i} />
              ))}
              {extraCount > 0 ? (
                <View style={[styles.plusBadge, { marginLeft: visibleFriends.length > 0 ? -AVATAR_OVERLAP : 0 }]}>
                  <Text style={styles.plusBadgeText}>+{extraCount}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ) : null}
      </View>
    );
  })();

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.card}
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
                {saved && (
                  <View style={styles.savedIndicator}>
                    <Ionicons name="bookmark" size={14} color={colors.accent} />
                  </View>
                )}
              </View>
              <Text style={styles.secondary}>
                {primaryCuisineLabel(restaurant)}
                {(restaurant.neighborhood || restaurant.state)
                  ? ` · ${[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}`
                  : ''}
              </Text>
              {restaurant.neighborhood || restaurant.state ? (
                <View style={styles.locationRow}>
                  <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                  <Text style={styles.locationText} numberOfLines={1}>
                    {[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.secondary}>
                {Array.from({ length: restaurant.priceLevel ?? 0 })
                  .map(() => '$')
                  .join('')}
              </Text>
            </View>
          </View>
          <View style={styles.matchBlock}>
            <View style={styles.matchPill}>
              <Text style={styles.matchText}>{Math.round(matchScore * 100)}%</Text>
            </View>
            {badge ? (
              <Text style={styles.socialProofBadge} numberOfLines={1}>
                {badge}
              </Text>
            ) : null}
          </View>
        </View>
        {!badge && reasonTags.length ? (
          <View style={styles.tagsRow}>
            {reasonTags.slice(0, 2).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </TouchableOpacity>

      <Modal
        visible={friendsModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFriendsModalOpen(false)}
      >
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
                  <View style={styles.modalRowText}>
                    <Text style={styles.modalName}>{v.userName}</Text>
                    <Text style={styles.modalMeta}>
                      {v.score.toFixed(1)} rating · {formatVisitDate(v.createdAt)}
                    </Text>
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

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
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
  photoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  friendStackPressable: {
    position: 'absolute',
    left: 2,
    bottom: 2,
    maxWidth: 56,
  },
  friendStackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.text,
  },
  plusBadge: {
    minWidth: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    paddingHorizontal: 5,
    backgroundColor: 'rgba(17,24,39,0.72)',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  plusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
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
    gap: 6,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  savedIndicator: {
    padding: 2,
  },
  secondary: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  locationText: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
  },
  matchBlock: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  matchPill: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  socialProofBadge: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    maxWidth: 120,
    textAlign: 'right',
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 12,
  },
  modalList: {
    maxHeight: 280,
  },
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
  modalAvatarImg: {
    width: '100%',
    height: '100%',
  },
  modalAvatarFallback: {
    flex: 1,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAvatarLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  modalRowText: {
    flex: 1,
  },
  modalName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  modalMeta: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textMuted,
  },
  modalClose: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
});
