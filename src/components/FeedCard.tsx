import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { useSavedRestaurants } from '../context/SavedRestaurantsContext';
import { useFeedContext } from '../context/FeedContext';
import { useFriendVisitsAtRestaurant } from '../hooks/useFriendVisitsAtRestaurant';
import { useCompare } from '../context/CompareContext';
import { RestaurantImage } from './RestaurantImage';

const CURRENT_USER_NAME = 'You';

// ─── Types ──────────────────────────────────────────────────────────────────

export type VibeTag =
  | 'date_night'
  | 'casual'
  | 'solo_dining'
  | 'group'
  | 'celebration'
  | 'quick_bite'
  | 'late_night'
  | 'weekend_brunch';

export interface FeedLog {
  id: string;
  /** Stable user id (Supabase UUID or null for legacy mock data). Lets the
   *  client re-label own logs as "You" by comparing to the auth session,
   *  since the server stores real display names. */
  userId?: string | null;
  userName: string;
  userAvatar?: string;
  restaurantName: string;
  restaurantId: string;
  score: number;
  createdAt?: string;
  cuisine: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  address?: string;
  note?: string;
  photo_url?: string | null;
  food_image_urls?: string[] | null;
  cover_image_url?: string | null;
  previewPhotoUrl?: string;
  dishHighlight?: string;
  standoutDish?: { label: string; name: string };
  standoutDishes?: string[];
  highlight?: 'food' | 'vibe' | 'service' | 'value' | null;
  dishes?: string[];
  vibeTags?: VibeTag[];
  quickTip?: string | null;
  bestTime?: string | null;
  visitNumber?: number;
  visitCount?: number;
  previousRating?: number;
  /** Friends tagged on this log. Drives the social-tagging headline
   *  ("Pooja went to Girl & the Goat with Maya"). Empty/undefined = no tags.
   *  `userId` is populated by the server (`/api/feed`, `/api/users/:id/logs`)
   *  so the client can match the current viewer against tag entries
   *  (e.g. "I was tagged on this log → surface it in my profile"). It's
   *  optional because legacy local-only logs from FeedContext won't have it. */
  taggedUsers?: { userId?: string | null; userName: string; displayName?: string; userAvatar?: string | null }[];
}

interface Props {
  log: FeedLog;
  /** Subtle social context label shown above the card (e.g. "🔥 Trending with friends") */
  socialLabel?: string | null;
  /** Emphasize this card — larger thumbnail, bolder presence */
  isHero?: boolean;
}

// ─── Hook text — ONE short punchy line ──────────────────────────────────────

const DISH_INTROS = [
  (d: string) => `Order the ${d}`,
  (d: string) => `Don't skip the ${d}`,
  (d: string) => `The ${d} is a must`,
  (d: string) => `Known for the ${d}`,
  (d: string) => `Start with the ${d}`,
];

function dishHook(dishes: string[], name: string): string {
  // Pick a deterministic intro based on the restaurant name so it doesn't change on re-render
  const idx = Math.abs([...name].reduce((h, c) => h + c.charCodeAt(0), 0)) % DISH_INTROS.length;
  if (dishes.length === 1) return DISH_INTROS[idx](dishes[0]);
  if (dishes.length === 2) return `${dishes[0]} & ${dishes[1]}`;
  return `${dishes[0]} + ${dishes.length - 1} more`;
}

function generateHookText(log: FeedLog, friendCount: number): string | null {
  const { score, standoutDish, dishHighlight, cuisine, visitCount, previousRating, highlight, dishes } = log;
  const topDishes = [standoutDish?.name, dishHighlight, ...(dishes ?? [])].filter((d): d is string => !!d?.trim());
  // Deduplicate
  const uniqueDishes = [...new Set(topDishes.map((d) => d.trim()))].slice(0, 3);

  if (visitCount && visitCount >= 3) return `${visitCount}x and counting`;
  if (previousRating != null && score > previousRating) return 'Even better this time';
  if (score >= 8.5 && uniqueDishes.length > 0) return dishHook(uniqueDishes, log.restaurantName);
  if (score >= 8.0) return 'Really, really good';
  if (friendCount >= 3) return `${friendCount} friends ate here`;
  if (friendCount >= 1) return 'Your friends have been here';
  if (uniqueDishes.length > 0) return dishHook(uniqueDishes, log.restaurantName);
  if (highlight === 'vibe') return 'The vibe is everything';
  if (highlight === 'value') return 'Great value find';

  const cl = cuisine.toLowerCase();
  if (cl.includes('ramen') || cl.includes('noodle')) return 'Warm bowl energy';
  if (cl.includes('pizza')) return 'Serious pizza';
  if (cl.includes('sushi') || cl.includes('japanese')) return 'Fresh and clean';
  if (cl.includes('taco') || cl.includes('mexican')) return 'The real deal';

  if (score >= 7.5) return 'Worth checking out';
  return null;
}

// ─── Author line with tagged friends ────────────────────────────────────────
// "You" / "You and Casey" / "You, Casey, and Riley" / "You and 3 friends"
// — keeps both subjects equal in framing per BiteRight's social style.

function formatAuthorLine(authorLabel: string, taggedUsers?: FeedLog['taggedUsers']): string {
  const names = (taggedUsers ?? [])
    .map((t) => t.displayName || t.userName)
    .filter(Boolean);
  if (names.length === 0) return authorLabel;
  if (names.length === 1) return `${authorLabel} and ${names[0]}`;
  if (names.length === 2) return `${authorLabel}, ${names[0]}, and ${names[1]}`;
  return `${authorLabel} and ${names.length} friends`;
}

// ─── Single supporting line (social OR note, never both) ────────────────────

function getSupportingLine(log: FeedLog, friendCount: number): string | null {
  // Short note wins if it exists (capped to ~60 chars)
  if (log.note) {
    const trimmed = log.note.trim();
    return trimmed.length > 60 ? trimmed.slice(0, 57) + '\u2026' : trimmed;
  }
  // Otherwise social proof — counts of friends who have logged this restaurant.
  // Not a "love" action (none exists in-app); use accurate "ate here" copy.
  if (friendCount >= 3) return `\u{1F525} ${friendCount} friends ate here`;
  if (friendCount === 1) return `Your friend has been here`;
  return null;
}

// ─── Card type ──────────────────────────────────────────────────────────────
// Always render the featured layout. We used to switch to a compact card when
// a log had no photo, but image enrichment lands ~2s after first render and
// flipped photoless cards from compact (56px thumb) to featured (120px thumb),
// causing the home feed's "card size changes" glitch on cold start. The
// placeholder inside RestaurantImage handles photoless cards cleanly.

// ─── Avatar ─────────────────────────────────────────────────────────────────

function AvatarBadge({ name, avatarUrl, size }: { name: string; avatarUrl?: string; size: number }) {
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <LinearGradient
      colors={['#C4899A', '#8B3A4A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: Math.max(11, size * 0.35), fontWeight: '700', color: '#fff' }}>
        {name[0] ?? '\u00B7'}
      </Text>
    </LinearGradient>
  );
}

// ─── FeedCard ───────────────────────────────────────────────────────────────

export function FeedCard({ log, socialLabel, isHero }: Props) {
  const router = useRouter();
  const { items, deleteLog } = useFeedContext();
  const { saveRestaurant, removeSaved, isSaved } = useSavedRestaurants();
  const allFriendVisits = useFriendVisitsAtRestaurant(log.restaurantId);
  // Exclude the card author from "was here too" social proof
  const friendVisits = useMemo(
    () => allFriendVisits.filter((fv) => fv.userName !== log.userName),
    [allFriendVisits, log.userName],
  );
  const [socialSheetOpen, setSocialSheetOpen] = useState(false);
  const { toggle: toggleCompare, compareMode } = useCompare();
  const saved = isSaved(log.restaurantId);

  const hookText = generateHookText(log, friendVisits.length);
  const supportingLine = getSupportingLine(log, friendVisits.length);

  const isOwn = log.userName === CURRENT_USER_NAME;

  const handleLongPress = () => {
    if (!isOwn) return;
    Alert.alert(
      'Delete this post?',
      'Removes your log from the feed for everyone. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteLog(log.id).catch(() => {});
          },
        },
      ],
    );
  };

  // Tap the author chip → open their public profile.
  // For real users (have a Supabase userId), navigate to /friend/[id].
  // For mock seed posts (no userId — Maya, Alex, etc.), show a friendly
  // explainer instead of doing nothing. Previously the tap was silently
  // disabled, which made the feature feel broken until you happened to
  // tap a real friend.
  const handleAuthorPress = () => {
    if (isOwn) return;
    if (!log.userId) {
      Alert.alert(
        `${log.userName} is a demo profile`,
        'These posts seed your feed so it isn’t empty on day one. Invite real friends to see and tap into their actual profiles.',
        [{ text: 'Got it' }],
      );
      return;
    }
    router.push(`/friend/${encodeURIComponent(log.userId)}` as never);
  };

  // Entrance animation removed: when the feed first loads, every visible card
  // ran its own translateY+fade in parallel, then fetchFeed prepended real
  // logs and those animated in too. The combined effect read as the feed
  // "growing" on cold start. Cards now appear instantly — press scale below
  // still gives tactile feedback when tapping.
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Press scale
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scaleAnim, { toValue: 0.98, damping: 20, stiffness: 300, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1, damping: 15, stiffness: 200, useNativeDriver: true }).start();

  // Social data for sheet
  const currentUserVisit = useMemo(() => {
    return items
      .filter((item) => item.restaurantId === log.restaurantId && item.userName === CURRENT_USER_NAME)
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
  }, [items, log.restaurantId]);

  const socialFriendVisits = currentUserVisit ? friendVisits : [];
  const socialRows = useMemo(() => {
    const rows: typeof friendVisits = [];
    if (currentUserVisit) rows.push({ id: currentUserVisit.id, userName: CURRENT_USER_NAME, userAvatar: currentUserVisit.userAvatar, score: currentUserVisit.score, note: currentUserVisit.note });
    socialFriendVisits.forEach((v) => rows.push(v));
    return rows;
  }, [currentUserVisit, socialFriendVisits]);

  const toggleSave = async () => {
    if (saved) {
      await removeSaved(log.restaurantId);
    } else {
      await saveRestaurant(
        { place_id: log.restaurantId, name: log.restaurantName, photo: log.previewPhotoUrl ?? null, cuisine: log.cuisine ?? null, neighborhood: log.neighborhood ?? null, rating: log.score ?? null },
        'manual',
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const goRestaurant = () => {
    if (compareMode) {
      toggleCompare({
        id: log.restaurantId, name: log.restaurantName, cuisine: log.cuisine,
        neighborhood: log.neighborhood ?? null, score: log.score,
        dishes: log.dishes, standoutDish: log.standoutDish?.name ?? log.dishHighlight ?? null,
        standoutDishes: log.standoutDishes,
        vibeTags: log.vibeTags, note: log.note ?? null,
        imageUrl: log.photo_url ?? log.previewPhotoUrl ?? null,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    router.push(`/restaurant/${log.restaurantId}?logId=${log.id}`);
  };

  // RestaurantImage props (shared). Includes full identity so RestaurantImage's
  // confidence-gated retry can hit /api/restaurants/<id> when the persisted
  // photo is missing (e.g. log saved before image resolution succeeded).
  // Accuracy > coverage: a placeholder is preferred over a wrong photo.
  const imgProps = {
    id: log.restaurantId,
    restaurantId: log.restaurantId,
    googlePlaceId: (log as { googlePlaceId?: string | null }).googlePlaceId ?? null,
    place_id: (log as { place_id?: string | null }).place_id ?? null,
    name: log.restaurantName,
    cuisine: log.cuisine,
    displayImageUrl: log.photo_url ?? log.previewPhotoUrl ?? null,
    displayImageSourceType: (log.photo_url ? 'user' : log.previewPhotoUrl ? 'google' : null) as any,
    imageUrl: log.photo_url ?? null,
    previewPhotoUrl: log.previewPhotoUrl ?? null,
  };

  const thumbSize = isHero ? 140 : 120;

    return (
      <>
        <Animated.View style={[st.outer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale: scaleAnim }] }]}>
          {/* Social context label */}
          {socialLabel && (
            <Text style={st.socialLabel}>{socialLabel}</Text>
          )}
          <Pressable
            style={[st.card, isHero && st.cardHero]}
            onPress={goRestaurant}
            onLongPress={handleLongPress}
            delayLongPress={500}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
          >
            <View style={st.cardRow}>
              {/* Square thumbnail */}
              <View style={[st.thumbWrap, { width: thumbSize, height: thumbSize }]}>
                <RestaurantImage
                  restaurant={imgProps}
                  aspectRatio={1}
                  fallbackType="icon"
                  borderRadius={16}
                  style={{ width: thumbSize, height: thumbSize }}
                />
                <TouchableOpacity style={st.saveBadge} onPress={toggleSave} hitSlop={8} activeOpacity={0.8}>
                  <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={14} color={saved ? colors.accent : '#fff'} />
                </TouchableOpacity>
              </View>

              {/* Right side — info + comment */}
              <View style={st.cardInfo}>
                {/* Name + score row */}
                <View style={st.nameRow}>
                  <Text style={st.cardName} numberOfLines={1}>{log.restaurantName}</Text>
                  <View style={[st.scorePill, log.score >= 8.0 && st.scorePillHigh]}>
                    <Text style={[st.scoreNum, log.score >= 8.0 && st.scoreNumHigh]}>{log.score.toFixed(1)}</Text>
                  </View>
                </View>

                {/* Cuisine · neighborhood */}
                <Text style={st.cardMeta} numberOfLines={1}>
                  {log.cuisine}{log.neighborhood ? ` \u00B7 ${log.neighborhood}` : ''}
                </Text>

                {/* Hook */}
                {hookText && <Text style={st.cardHook} numberOfLines={1}>{hookText}</Text>}

                {/* Divider */}
                <View style={st.divider} />

                {/* Author + note */}
                <View style={st.authorRow}>
                  <TouchableOpacity
                    onPress={handleAuthorPress}
                    disabled={isOwn}
                    activeOpacity={0.7}
                    style={st.authorChip}
                  >
                    <AvatarBadge name={log.userName} avatarUrl={log.userAvatar} size={18} />
                    <Text style={st.authorName} numberOfLines={1}>
                      {formatAuthorLine(
                        log.userName === CURRENT_USER_NAME ? 'You' : log.userName,
                        log.taggedUsers,
                      )}
                    </Text>
                  </TouchableOpacity>
                  {friendVisits.length > 0 && (
                    <TouchableOpacity onPress={() => setSocialSheetOpen(true)} activeOpacity={0.75} style={st.socialDot}>
                      <Text style={st.socialDotText}>
                        {friendVisits.length === 1
                          ? `${friendVisits[0].userName} was here too`
                          : `${friendVisits.length} friends ate here`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {supportingLine && (
                  <Text style={st.noteText} numberOfLines={1}>{supportingLine}</Text>
                )}
              </View>
            </View>
          </Pressable>
        </Animated.View>
        {renderSocialSheet()}
      </>
    );

  // ── Social sheet ──────────────────────────────────────────────────────
  function renderSocialSheet() {
    return (
      <Modal visible={socialSheetOpen} transparent animationType="slide" onRequestClose={() => setSocialSheetOpen(false)}>
        <Pressable style={st.sheetBackdrop} onPress={() => setSocialSheetOpen(false)}>
          <Pressable style={st.sheetCard} onPress={() => {}}>
            <View style={st.sheetHandle} />
            <Text style={st.sheetTitle}>{log.restaurantName}</Text>
            <Text style={st.sheetSubtitle}>What your circle thinks</Text>
            <ScrollView style={st.sheetScroll} contentContainerStyle={st.sheetScrollContent} showsVerticalScrollIndicator={false}>
              {socialRows.map((row) => (
                <View key={row.id} style={st.sheetRow}>
                  <View style={st.sheetRowHeader}>
                    <View style={st.sheetRowUser}>
                      <AvatarBadge name={row.userName} avatarUrl={row.userAvatar} size={32} />
                      <Text style={st.sheetUserName}>{row.userName}</Text>
                    </View>
                    <View style={st.sheetScorePill}>
                      <Text style={st.sheetScoreText}>{row.score.toFixed(1)}</Text>
                    </View>
                  </View>
                  {row.note ? (
                    <Text style={st.sheetNote}>{row.note.trim()}</Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  // ── Shared ──
  outer: {
    marginBottom: 20,
  },

  // ── Social label ──
  socialLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
    paddingLeft: 2,
  },

  // ── Featured (horizontal card) ──
  // Height is fixed at thumbnail (120) + vertical padding (12×2) = 144 so
  // the card never reflows when async data (friend hooks, feed fetch,
  // image enrichment) changes the info column's content. With cardInfo
  // centered, the content shifts within the fixed 144px envelope instead
  // of pushing the card taller. Hero variant adds 20px to accommodate
  // its larger 140-px thumbnail.
  cardHero: {
    height: 164,
    shadowColor: 'rgba(0,0,0,0.14)',
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  card: {
    height: 144,
    borderRadius: 20,
    backgroundColor: colors.surface,
    shadowColor: 'rgba(43,33,24,0.10)',
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    padding: 12,
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    gap: 14,
  },
  thumbWrap: {
    width: 120,
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbImg: {
    width: 120,
    height: 120,
  },
  saveBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Right side info ──
  cardInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  scorePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  scorePillHigh: {
    backgroundColor: colors.accent,
  },
  scoreNum: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  scoreNumHigh: {
    color: '#fff',
  },
  cardMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  cardHook: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  authorName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.text,
  },
  socialDot: {
    marginLeft: 'auto' as any,
    flexShrink: 0,
  },
  socialDotText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
  },
  noteText: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // ── Compact ──
  compactCard: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    padding: 14,
    shadowColor: 'rgba(43,33,24,0.08)',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
  },
  compactThumbImg: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  compactBody: {
    flex: 1,
  },
  compactName: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  compactMeta: {
    marginTop: 1,
    fontSize: 11.5,
    fontWeight: '500',
    color: colors.textMuted,
  },
  compactHook: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  compactRight: {
    alignItems: 'center',
    gap: 8,
  },
  ratingSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  ratingSmallText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },

  // ── Social sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 26,
    maxHeight: '70%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D0CDD4',
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sheetSubtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  sheetScroll: { marginTop: 16 },
  sheetScrollContent: { gap: 10, paddingBottom: 8 },
  sheetRow: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetRowUser: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sheetUserName: { fontSize: 14, fontWeight: '700', color: colors.text },
  sheetScorePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.accentSoft },
  sheetScoreText: { fontSize: 12, fontWeight: '800', color: colors.accent },
  sheetNote: { marginTop: 8, fontSize: 13.5, lineHeight: 20, color: colors.text },
});
