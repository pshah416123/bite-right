import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

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
  cuisine: string;
  neighborhood?: string;
  state?: string;
  address?: string;
  /** Caption shown in feed (optional details) */
  note?: string;
  /** Image URL for the card (from log photo or resolved restaurant photo). Use this single field for display. */
  previewPhotoUrl?: string;
  dishHighlight?: string;
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

/** Neutral placeholder when log has no image (must match server NEUTRAL_PLACEHOLDER_URL). */
const FEED_PLACEHOLDER_URI = 'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo';

export function FeedCard({ log }: Props) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionTruncated, setCaptionTruncated] = useState(false);

  const onLike = () => {
    setLiked((prev) => !prev);
    setLikeCount((c) => (liked ? c - 1 : c + 1));
  };

  const noteText = log.note ? `"${log.note}"` : '';
  const showSeeMore = noteText.length > 0 && captionTruncated && !captionExpanded;

  return (
    <View style={styles.card}>
      <Link href={`/restaurant/${log.restaurantId}?logId=${log.id}`} asChild>
        <TouchableOpacity activeOpacity={1} style={styles.tappableArea}>
          <View style={styles.topRow}>
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{log.userName[0] ?? '·'}</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.userName}>{log.userName}</Text>
              <Text style={styles.restaurantName}>{log.restaurantName}</Text>
            </View>
            <View style={styles.ratingPill}>
              <Text style={styles.ratingValue}>{log.score.toFixed(1)}</Text>
            </View>
          </View>

          {log.dishHighlight ? (
            <Text style={styles.dishHighlight}>{log.dishHighlight}</Text>
          ) : null}

          {(() => {
            const imageUrl =
              log.previewPhotoUrl && (log.previewPhotoUrl.startsWith('http') || log.previewPhotoUrl.startsWith('https'))
                ? log.previewPhotoUrl
                : FEED_PLACEHOLDER_URI;
            return <Image source={{ uri: imageUrl }} style={styles.photo} />;
          })()}

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
        </TouchableOpacity>
      </Link>

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
  dishHighlight: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
    marginTop: 2,
    marginBottom: 8,
    letterSpacing: 0.2,
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

