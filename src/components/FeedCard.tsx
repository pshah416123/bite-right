import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { resolveRestaurantDisplayImage } from '../utils/restaurantImage';
import { NEUTRAL_RESTAURANT_PLACEHOLDER_URI } from '../constants/restaurantMedia';

export type VibeTag =
  | 'date_night'
  | 'casual'
  | 'solo_dining'
  | 'group'
  | 'celebration'
  | 'quick_bite';

export interface FeedLog {
  id: string;
  userName: string;
  userAvatar?: string;
  restaurantName: string;
  restaurantId: string;
  score: number; // 0–10 overall rating
  /** ISO date string for when the log was created. */
  createdAt?: string;
  cuisine: string;
  neighborhood?: string;
  state?: string;
  address?: string;
  /** Caption shown in feed (optional details) */
  note?: string;
  /** Image URL for the card (from log photo or resolved restaurant photo). Use this single field for display. */
  previewPhotoUrl?: string;
  /**
   * Backward-compatible legacy field.
   * Prefer `standoutDish` for structured rendering/filtering.
   */
  dishHighlight?: string;
  /**
   * Structured standout dish for UI and future filtering.
   * Example: { label: 'Standout', name: 'Chicago-style deep dish' }
   */
  standoutDish?: { label: string; name: string };
  // Optional details: shown on restaurant detail only
  foodRating?: number;
  serviceRating?: number;
  ambienceRating?: number;
  valueRating?: number;
  dishes?: string[];
  vibeTags?: VibeTag[];
}

interface Props {
  log: FeedLog;
}

const CAPTION_MAX_LINES = 2;

export function FeedCard({ log }: Props) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionTruncated, setCaptionTruncated] = useState(false);
   const [imageBroken, setImageBroken] = useState(false);

  const onLike = () => {
    setLiked((prev) => !prev);
    setLikeCount((c) => (liked ? c - 1 : c + 1));
  };

  const noteText = log.note ? `"${log.note}"` : '';
  const showSeeMore = noteText.length > 0 && captionTruncated && !captionExpanded;

  const photoUri = (() => {
    if (imageBroken) return NEUTRAL_RESTAURANT_PLACEHOLDER_URI;
    return resolveRestaurantDisplayImage({ userOrLogPhotoUrl: log.previewPhotoUrl }).url;
  })();

  const standout =
    log.standoutDish ??
    (log.dishHighlight
      ? { label: 'Standout', name: log.dishHighlight }
      : undefined);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <TouchableOpacity
          onPress={() => router.push(`/(tabs)/profile?userName=${encodeURIComponent(log.userName)}`)}
          activeOpacity={0.85}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{log.userName[0] ?? '·'}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.meta}>
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/profile?userName=${encodeURIComponent(log.userName)}`)}
            activeOpacity={0.85}
          >
            <Text style={styles.userName}>{log.userName}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push(`/restaurant/${log.restaurantId}?logId=${log.id}`)}
            activeOpacity={0.85}
          >
            <Text style={styles.restaurantName}>{log.restaurantName}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ratingPill}>
          <Text style={styles.ratingValue}>{log.score.toFixed(1)}</Text>
        </View>
      </View>

      <TouchableOpacity
        activeOpacity={1}
        style={styles.tappableArea}
        onPress={() => router.push(`/restaurant/${log.restaurantId}?logId=${log.id}`)}
      >
        {standout?.name ? (
          <View style={styles.standoutRow}>
            <View style={styles.standoutBadge}>
              <Text style={styles.standoutBadgeText}>{standout.label}</Text>
            </View>
            <Text style={styles.standoutName} numberOfLines={1} ellipsizeMode="tail">
              {standout.name}
            </Text>
          </View>
        ) : null}

        <Image
          source={{ uri: photoUri }}
          style={styles.photo}
          onError={() => setImageBroken(true)}
        />
      </TouchableOpacity>

      {log.note ? (
        <View style={styles.captionWrap}>
          <Text
            style={styles.note}
            numberOfLines={captionExpanded ? undefined : CAPTION_MAX_LINES}
            onTextLayout={
              captionExpanded
                ? undefined
                : (e) => {
                    const { lines } = e.nativeEvent;
                    if (lines.length > CAPTION_MAX_LINES) setCaptionTruncated(true);
                  }
            }
          >
            {noteText}
          </Text>
          {showSeeMore ? (
            <TouchableOpacity
              onPress={(e) => {
                e.preventDefault();
                setCaptionExpanded(true);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.seeMoreWrap}
            >
              <Text style={styles.seeMore}>See more</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={onLike} activeOpacity={0.7}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={22}
            color={liked ? colors.accent : colors.textMuted}
          />
          <Text style={[styles.actionLabel, liked && styles.actionLabelActive]}>
            {likeCount > 0 ? likeCount : 'Like'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
          <Text style={styles.actionLabel}>{commentCount > 0 ? commentCount : 'Comment'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 17,
    marginBottom: 14,
    shadowColor: '#c4a574',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2933',
  },
  meta: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  restaurantName: {
    marginTop: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  ratingPill: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  standoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  standoutBadge: {
    backgroundColor: colors.bgSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.accentSoft,
  },
  standoutBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
  },
  standoutName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 18,
  },
  photo: {
    width: '100%',
    height: 230,
    borderRadius: 20,
    marginBottom: 10,
    backgroundColor: colors.surfaceSoft,
  },
  photoPlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 20,
    marginBottom: 10,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  captionWrap: {
    marginTop: 2,
  },
  note: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  seeMoreWrap: {
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  seeMore: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  tappableArea: {
    padding: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionLabel: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  actionLabelActive: {
    color: colors.accent,
  },
});

