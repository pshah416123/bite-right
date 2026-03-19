import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { RESTAURANTS } from '~/src/data/restaurants';
import { getNeutralRestaurantPlaceholderUri } from '~/src/utils/restaurantImage';
import { colors } from '~/src/theme/colors';
import { useFeedContext } from '~/src/context/FeedContext';
import type { VibeTag } from '~/src/components/FeedCard';
import { getRestaurantDetail, type RestaurantDetail } from '~/src/api/restaurants';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { postNegativeFeedback } from '~/src/api/discover';

const VIBE_LABELS: Record<VibeTag, string> = {
  date_night: 'Date night',
  casual: 'Casual',
  solo_dining: 'Solo dining',
  group: 'Group dinner',
  celebration: 'Celebration',
  quick_bite: 'Quick bite',
};

function isOpenableUrl(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'));
}

function formatPriceLevel(level?: number): string {
  if (level == null || level < 1) return '';
  return Array.from({ length: Math.min(4, level) }, () => '$').join('');
}

export default function RestaurantScreen() {
  const params = useLocalSearchParams<{ id: string; logId?: string; payload?: string }>();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : undefined;
  const logId = typeof params.logId === 'string' ? params.logId : Array.isArray(params.logId) ? params.logId[0] : undefined;
  const payloadRaw =
    typeof params.payload === 'string' ? params.payload : Array.isArray(params.payload) ? params.payload[0] : undefined;
  const router = useRouter();
  const { items: feedItems } = useFeedContext();
  const { saveRestaurant, isSaved } = useSavedRestaurants();
  const [detail, setDetail] = useState<RestaurantDetail | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const restaurantFromPayload = useMemo(() => {
    if (!payloadRaw) return null;
    try {
      const parsed = JSON.parse(payloadRaw) as {
        id?: string;
        name?: string;
        cuisine?: string;
        cuisines?: string[];
        neighborhood?: string | null;
        state?: string | null;
        priceLevel?: number | null;
        placeId?: string | null;
        imageUrl?: string | null;
        previewPhotoUrl?: string | null;
        matchScore?: number | null;
      };
      if (!parsed || !parsed.id) return null;
      return {
        id: parsed.id,
        name: parsed.name ?? '',
        cuisine: parsed.cuisine ?? '',
        cuisines: Array.isArray(parsed.cuisines) ? parsed.cuisines : undefined,
        neighborhood: parsed.neighborhood ?? undefined,
        state: parsed.state ?? undefined,
        priceLevel: parsed.priceLevel ?? undefined,
        placeId: parsed.placeId ?? undefined,
        imageUrl: parsed.imageUrl ?? undefined,
        previewPhotoUrl: parsed.previewPhotoUrl ?? undefined,
        matchScore: parsed.matchScore ?? undefined,
      };
    } catch {
      return null;
    }
  }, [payloadRaw]);

  const restaurantFromStatic = id ? RESTAURANTS.find((r) => r.id === id) : null;

  const restaurant = restaurantFromPayload ?? restaurantFromStatic;
  /** Match saved list whether the API keyed by route id (g_…) or Google placeId. */
  const saved =
    (!!id && isSaved(id)) ||
    (!!restaurantFromPayload?.placeId && isSaved(restaurantFromPayload.placeId));
  const logsForRestaurant = useMemo(
    () => (id ? feedItems.filter((l) => l.restaurantId === id) : []),
    [feedItems, id],
  );
  const log = logId
    ? feedItems.find((l) => l.id === logId)
    : logsForRestaurant.length > 0
      ? logsForRestaurant[0]
      : undefined;

  useEffect(() => {
    if (!id) return;
    getRestaurantDetail(id).then(setDetail);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function loadDistance() {
      if (!detail || detail.lat == null || detail.lng == null) return;
      const { status } = await Location.getForegroundPermissionsAsync();
      if (cancelled || status !== 'granted') return;
      try {
        const pos = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        const d = distanceInMiles(
          pos.coords.latitude,
          pos.coords.longitude,
          detail.lat as number,
          detail.lng as number,
        );
        setDistanceMiles(d);
      } catch {
        // ignore
      }
    }
    loadDistance();
    return () => {
      cancelled = true;
    };
  }, [detail?.lat, detail?.lng]);

  const [heroBroken, setHeroBroken] = useState(false);

  const primaryRestaurantImage =
    (restaurantFromPayload?.imageUrl && restaurantFromPayload.imageUrl.startsWith('http')
      ? restaurantFromPayload.imageUrl
      : undefined) ||
    (restaurantFromPayload?.previewPhotoUrl && restaurantFromPayload.previewPhotoUrl.startsWith('http')
      ? restaurantFromPayload.previewPhotoUrl
      : undefined);
  const staticRestaurantImage = id ? getNeutralRestaurantPlaceholderUri() : undefined;

  const heroImageUrl =
    heroBroken
      ? getNeutralRestaurantPlaceholderUri()
      : logsForRestaurant.find((l) => l.previewPhotoUrl)?.previewPhotoUrl ??
        detail?.imageUrl ??
        primaryRestaurantImage ??
        staticRestaurantImage ??
        getNeutralRestaurantPlaceholderUri();

  const cuisineText = (
    restaurantFromPayload?.cuisines?.find(Boolean) ||
    restaurantFromPayload?.cuisine ||
    restaurant?.cuisine ||
    log?.cuisine ||
    ''
  ).trim();
  const areaText = [restaurant?.neighborhood, restaurant?.state].filter(Boolean).join(', ');
  const priceStr = formatPriceLevel((restaurant as any)?.priceLevel);
  const biteRightScorePercent =
    typeof (restaurantFromPayload as any)?.matchScore === 'number'
      ? Math.round(((restaurantFromPayload as any).matchScore as number) * 100)
      : null;

  const recommendedDishes = useMemo(() => {
    const counts = new Map<string, number>();
    logsForRestaurant.forEach((l) => {
      l.dishes?.forEach((d) => {
        const key = d.trim();
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [logsForRestaurant]);

  const recentPosts = logsForRestaurant.slice(0, 5);

  const canReserve =
    (detail?.reservationUrl && isOpenableUrl(detail.reservationUrl)) ||
    (detail?.websiteUrl && isOpenableUrl(detail.websiteUrl)) ||
    (detail?.googleMapsUrl && isOpenableUrl(detail.googleMapsUrl)) ||
    (detail?.phone && detail.phone.trim().length > 0);

  const handleReserve = () => {
    if (!detail) return;
    const url =
      (detail.reservationUrl && isOpenableUrl(detail.reservationUrl) ? detail.reservationUrl : null) ||
      (detail.websiteUrl && isOpenableUrl(detail.websiteUrl) ? detail.websiteUrl : null) ||
      (detail.googleMapsUrl && isOpenableUrl(detail.googleMapsUrl) ? detail.googleMapsUrl : null);
    if (url) {
      Linking.openURL(url).catch(() => {});
      return;
    }
    if (detail.phone && detail.phone.trim()) {
      Alert.alert(
        'Call restaurant',
        `Open phone to call ${detail.phone.trim()}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call', onPress: () => Linking.openURL(`tel:${detail.phone!.trim()}`).catch(() => {}) },
        ],
      );
    }
  };

  const handleDirections = () => {
    if (!detail) return;
    const hasCoords = detail.lat != null && detail.lng != null;
    if (hasCoords) {
      const url = `https://www.google.com/maps/search/?api=1&query=${detail.lat},${detail.lng}`;
      Linking.openURL(url).catch(() => {});
      return;
    }
    if (detail.googleMapsUrl && isOpenableUrl(detail.googleMapsUrl)) {
      Linking.openURL(detail.googleMapsUrl).catch(() => {});
    }
  };

  const handleSave = async () => {
    // Always persist the app's canonical restaurant id (g_… / rest_…) so GET /saved can resolve via findRestaurantById.
    const saveKey = restaurantFromPayload?.id ?? id;
    if (!saveKey || saving) return;
    const name = restaurant?.name ?? log?.restaurantName ?? detail?.name ?? `Restaurant ${saveKey}`;
    const cuisine = restaurant?.cuisine || log?.cuisine || '';
    const neighborhood = restaurant?.neighborhood || restaurant?.state || '';
    const cuisinesList =
      restaurantFromPayload?.cuisines && restaurantFromPayload.cuisines.length > 0
        ? restaurantFromPayload.cuisines
        : undefined;
    if (__DEV__) {
      console.log('[RestaurantDetail] Save onPress', {
        routeId: id,
        saveKey,
        placeId: restaurantFromPayload?.placeId ?? null,
        name,
        image: restaurantFromPayload?.imageUrl ?? restaurantFromPayload?.previewPhotoUrl ?? null,
        cuisines: cuisinesList ?? null,
      });
    }
    try {
      setSaving(true);
      await saveRestaurant(
        {
          place_id: saveKey,
          name,
          photo:
            restaurantFromPayload?.imageUrl ??
            restaurantFromPayload?.previewPhotoUrl ??
            detail?.imageUrl ??
            undefined,
          cuisine: cuisine || undefined,
          neighborhood: neighborhood || undefined,
          address: detail?.address ?? undefined,
          lat: detail?.lat != null ? Number(detail.lat) : undefined,
          lng: detail?.lng != null ? Number(detail.lng) : undefined,
          cuisines: cuisinesList,
          price_level: restaurantFromPayload?.priceLevel ?? (restaurant as any)?.priceLevel ?? undefined,
        },
        'manual',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleNegativeFeedback = () => {
    if (!id) return;
    const userId = 'default';
    const run = (action: 'hide' | 'suggest_less') => {
      postNegativeFeedback(userId, id, action)
        .then(() => {
          if (action === 'hide') {
            Alert.alert('Hidden', 'This restaurant will be hidden from your recommendations.');
            router.back();
          } else {
            Alert.alert('Got it', 'We’ll show you less like this.');
          }
        })
        .catch(() => {
          Alert.alert('Something went wrong', 'We could not update your recommendations. Please try again.');
        });
    };

    const options = ['Hide this restaurant', 'Suggest less like this', 'Cancel'];
    const cancelButtonIndex = 2;

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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          {id ? (
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={handleNegativeFeedback}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Hero: fixed height so overlays cannot spill into action row; gradient + white type for contrast */}
        <View style={styles.heroWrap} collapsable={false}>
          <Image
            source={{ uri: heroImageUrl }}
            style={styles.heroImageFill}
            resizeMode="cover"
            onError={() => setHeroBroken(true)}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.88)']}
            locations={[0, 0.45, 1]}
            style={styles.heroGradient}
          />
          <View style={styles.heroTextBlock} pointerEvents="box-none">
            <Text style={styles.heroTitle} numberOfLines={2}>
              {restaurant?.name ?? log?.restaurantName ?? detail?.name ?? `Restaurant ${id ?? ''}`}
            </Text>
            <Text style={styles.heroSubtitle} numberOfLines={2}>
              {cuisineText || 'Restaurant'}
              {areaText ? ` · ${areaText}` : ''}
            </Text>
            {priceStr ? (
              <View style={styles.pricePillHero}>
                <Text style={styles.pricePillHeroText}>{priceStr}</Text>
              </View>
            ) : null}
            {distanceMiles != null ? (
              <Text style={styles.distanceLabelHero}>{distanceMiles.toFixed(1)} mi away</Text>
            ) : null}
          </View>
        </View>

        {/* Actions sit below the hero — never under an absolute overlay */}
        <View style={styles.actionsStrip} collapsable={false}>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={handleSave}
            disabled={saving || !(restaurantFromPayload?.id ?? id)}
            android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={saved ? colors.accent : '#111827'}
            />
            <Text style={styles.actionText}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, styles.primaryActionBtn, pressed && styles.actionBtnPressed]}
            onPress={() => {
              const payload = {
                id: restaurant?.id ?? (restaurantFromPayload?.id as string | undefined) ?? id,
                name: restaurant?.name ?? restaurantFromPayload?.name ?? detail?.name ?? '',
                cuisine: (restaurant as any)?.cuisine ?? restaurantFromPayload?.cuisine ?? '',
                neighborhood: (restaurant as any)?.neighborhood ?? restaurantFromPayload?.neighborhood ?? null,
                state: (restaurant as any)?.state ?? restaurantFromPayload?.state ?? null,
                placeId: restaurantFromPayload?.placeId ?? null,
                imageUrl: restaurantFromPayload?.imageUrl ?? null,
                priceLevel: (restaurant as any)?.priceLevel ?? restaurantFromPayload?.priceLevel ?? null,
              };
              router.push({
                pathname: '/log-visit',
                params: { payload: encodeURIComponent(JSON.stringify(payload)) },
              });
            }}
            android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text style={[styles.actionText, styles.primaryActionText]}>Log visit</Text>
          </Pressable>
          {canReserve ? (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
              onPress={handleReserve}
              android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Ionicons name="calendar-outline" size={18} color="#111827" />
              <Text style={styles.actionText}>Reserve</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={handleDirections}
            android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="navigate-outline" size={18} color="#111827" />
            <Text style={styles.actionText}>Directions</Text>
          </Pressable>
        </View>

        {restaurant && (restaurant.neighborhood || restaurant.state) ? (
          <View style={styles.locationSection}>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={18} color={colors.accent} />
              <Text style={styles.locationLabel}>Location</Text>
            </View>
            <Text style={styles.locationAddress}>
              {[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}
            </Text>
          </View>
        ) : null}

        {log ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your rating</Text>
              <View style={styles.ratingBreakdown}>
                <View style={styles.ratingRow}>
                  <Text style={styles.ratingLabel}>Overall</Text>
                  <Text style={styles.ratingValue}>{log.score.toFixed(1)}</Text>
                </View>
                {log.foodRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Food</Text>
                    <Text style={styles.ratingValue}>{log.foodRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {log.serviceRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Service</Text>
                    <Text style={styles.ratingValue}>{log.serviceRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {log.ambienceRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Ambience</Text>
                    <Text style={styles.ratingValue}>{log.ambienceRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {log.valueRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Value</Text>
                    <Text style={styles.ratingValue}>{log.valueRating.toFixed(1)}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {log.dishes && log.dishes.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Dishes you tried</Text>
                <View style={styles.dishList}>
                  {log.dishes.map((d, i) => (
                    <Text key={i} style={styles.dishItem}>
                      · {d}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {log.vibeTags && log.vibeTags.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Vibe</Text>
                <View style={styles.vibeWrap}>
                  {log.vibeTags.map((v) => (
                    <View key={v} style={styles.vibePill}>
                      <Text style={styles.vibePillText}>{VIBE_LABELS[v]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : biteRightScorePercent != null ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>BiteRight score</Text>
            <View style={styles.biteRightScorePill}>
              <Ionicons name="sparkles" size={14} color="#fff" />
              <Text style={styles.biteRightScorePillText}>
                {biteRightScorePercent}% match
              </Text>
            </View>
          </View>
        ) : null}

        {recommendedDishes.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recommended dishes</Text>
            <View style={styles.dishList}>
              {recommendedDishes.map((d) => (
                <Text key={d.name} style={styles.dishItem}>
                  · {d.name} ({d.count})
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {recentPosts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent posts</Text>
            {recentPosts.map((p) => (
              <View key={p.id} style={styles.postRow}>
                <View style={styles.postAvatar}>
                  <Text style={styles.postAvatarInitial}>{p.userName[0] ?? '·'}</Text>
                </View>
                <View style={styles.postMeta}>
                  <Text style={styles.postUser}>{p.userName}</Text>
                  {p.note ? <Text style={styles.postNote} numberOfLines={2}>{p.note}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {detail && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location</Text>
            <Text style={styles.locationAddress}>{detail.address || 'Address unavailable'}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  heroWrap: {
    height: 240,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#111827',
    position: 'relative',
    zIndex: 0,
  },
  heroImageFill: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  heroTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 24,
    zIndex: 2,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  distanceLabelHero: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  pricePillHero: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pricePillHeroText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  backText: {
    marginLeft: 2,
    fontSize: 14,
    color: '#111827',
  },
  actionsStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
    paddingVertical: 4,
    zIndex: 10,
    elevation: 10,
    backgroundColor: '#f9fafb',
  },
  actionBtnPressed: {
    opacity: 0.88,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },
  primaryActionBtn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  primaryActionText: {
    color: '#fff',
  },
  locationSection: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  locationAddress: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 26,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  placeholder: {
    fontSize: 14,
    color: '#6b7280',
  },
  biteRightScorePill: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  biteRightScorePillText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  ratingBreakdown: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  ratingLabel: { fontSize: 14, color: colors.text },
  ratingValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  dishList: { marginTop: 6 },
  dishItem: { fontSize: 14, color: colors.text, marginBottom: 4 },
  vibeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  vibePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vibePillText: { fontSize: 13, color: colors.text },
  postRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  postAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  postAvatarInitial: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  postMeta: {
    flex: 1,
  },
  postUser: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  postNote: {
    fontSize: 12,
    color: colors.textMuted,
  },
});

function distanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

