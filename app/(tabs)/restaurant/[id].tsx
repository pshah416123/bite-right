import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { colors } from '~/src/theme/colors';
import { useFeedContext } from '~/src/context/FeedContext';
import type { VibeTag } from '~/src/components/FeedCard';
import { getRestaurantDetail, getRestaurantMenu, getNearbyAfterSpots, cycleRestaurantPhoto, type RestaurantDetail, type RestaurantMenu, type NearbyAfterSpot, type ReservationLink, type ReservationProvider } from '~/src/api/restaurants';
import { MenuTemplate } from '~/src/components/MenuSection';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { useCompare } from '~/src/context/CompareContext';
import { postNegativeFeedback } from '~/src/api/discover';
import { RestaurantImage } from '~/src/components/RestaurantImage';
import { QuickTipsBlock } from '~/src/components/QuickTipsBlock';
import { SendToFriendSheet } from '~/src/components/SendToFriendSheet';
import { useFriendVisitsAtRestaurant } from '~/src/hooks/useFriendVisitsAtRestaurant';

const VIBE_LABELS: Record<VibeTag, string> = {
  date_night: 'Date night',
  casual: 'Casual',
  solo_dining: 'Solo dining',
  group: 'Group dinner',
  celebration: 'Celebration',
  quick_bite: 'Quick bite',
  late_night: 'Late night',
  weekend_brunch: 'Weekend brunch',
};

function isOpenableUrl(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'));
}

// ─── Reservation link helpers ────────────────────────────────────────────────

const RESERVATION_PROVIDER_PRIORITY: Record<ReservationProvider, number> = {
  opentable:  1,
  resy:       2,
  sevenrooms: 3,
  tock:       4,
  yelp:       5,
  website:    6,
  phone:      7,
};

// Real booking providers should always beat phone in the primary slot, even
// if a phone link is mistakenly marked is_primary=true. Rule:
//   1. Bucket A (real booking: opentable/resy/sevenrooms/yelp) always ranks
//      ahead of Bucket B (website/phone).
//   2. Within a bucket, is_primary wins.
//   3. Then provider priority.
function bookingBucket(p: ReservationProvider): 0 | 1 {
  return (p === 'opentable' || p === 'resy' || p === 'sevenrooms' || p === 'tock' || p === 'yelp') ? 0 : 1;
}

function sortReservationLinks(links: ReservationLink[]): ReservationLink[] {
  return [...links].sort((a, b) => {
    const ba = bookingBucket(a.provider);
    const bb = bookingBucket(b.provider);
    if (ba !== bb) return ba - bb;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (RESERVATION_PROVIDER_PRIORITY[a.provider] ?? 99) -
           (RESERVATION_PROVIDER_PRIORITY[b.provider] ?? 99);
  });
}

function reservationLabel(provider: ReservationProvider): string {
  switch (provider) {
    case 'opentable':  return 'Reserve on OpenTable';
    case 'resy':       return 'Reserve on Resy';
    case 'sevenrooms': return 'Reserve on SevenRooms';
    case 'tock':       return 'Reserve on Tock';
    case 'yelp':       return 'Reserve on Yelp';
    case 'website':    return 'Reserve on website';
    case 'phone':      return 'Call to book';
  }
}

function reservationIcon(provider: ReservationProvider): React.ComponentProps<typeof Ionicons>['name'] {
  switch (provider) {
    case 'phone':   return 'call-outline';
    case 'website': return 'globe-outline';
    default:        return 'calendar-outline';
  }
}

function openReservationLink(link: ReservationLink) {
  if (link.provider === 'phone' && link.phoneNumber) {
    Alert.alert(
      'Call restaurant',
      `Open phone to call ${link.phoneNumber}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: () => Linking.openURL(`tel:${link.phoneNumber!.replace(/[^\d+]/g, '')}`).catch(() => {}) },
      ],
    );
    return;
  }
  if (link.url && isOpenableUrl(link.url)) {
    Linking.openURL(link.url).catch(() => {});
  }
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
  const { isSelected: isCompareSelected, toggle: toggleCompare } = useCompare();
  const [detail, setDetail] = useState<RestaurantDetail | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<RestaurantMenu | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [afterSpots, setAfterSpots] = useState<NearbyAfterSpot[]>([]);
  const [cyclingPhoto, setCyclingPhoto] = useState(false);
  const [photoKey, setPhotoKey] = useState(0); // bump to force image reload
  const [sendSheetOpen, setSendSheetOpen] = useState(false);

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
        googlePlaceId?: string | null;
        displayImageUrl?: string | null;
        displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
        displayImageLastResolvedAt?: string | null;
        imageUrl?: string | null;
        previewPhotoUrl?: string | null;
        matchScore?: number | null;
        fromLat?: number | null;
        fromLng?: number | null;
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
        googlePlaceId: parsed.googlePlaceId ?? parsed.placeId ?? undefined,
        displayImageUrl: parsed.displayImageUrl ?? parsed.imageUrl ?? parsed.previewPhotoUrl ?? undefined,
        displayImageSourceType: parsed.displayImageSourceType ?? undefined,
        displayImageLastResolvedAt: parsed.displayImageLastResolvedAt ?? undefined,
        imageUrl: parsed.imageUrl ?? undefined,
        previewPhotoUrl: parsed.previewPhotoUrl ?? undefined,
        matchScore: parsed.matchScore ?? undefined,
        fromLat: parsed.fromLat ?? undefined,
        fromLng: parsed.fromLng ?? undefined,
      };
    } catch {
      return null;
    }
  }, [payloadRaw]);

  const restaurantFromStatic = id ? RESTAURANTS.find((r) => r.id === id) : null;
  const restaurant = restaurantFromPayload ?? restaurantFromStatic;
  const saved =
    (!!id && isSaved(id)) ||
    (!!restaurantFromPayload?.placeId && isSaved(restaurantFromPayload.placeId));
  const inCompare = !!(id && isCompareSelected(id));

  const handleToggleCompare = () => {
    if (!id) return;
    const name = restaurant?.name ?? log?.restaurantName ?? '';
    toggleCompare({
      id,
      placeId: restaurantFromPayload?.placeId ?? detail?.placeId ?? null,
      googlePlaceId: restaurantFromPayload?.googlePlaceId ?? detail?.googlePlaceId ?? restaurantFromPayload?.placeId ?? detail?.placeId ?? null,
      name,
      cuisine: cuisineText || log?.cuisine || '',
      neighborhood: restaurant?.neighborhood ?? log?.neighborhood ?? null,
      priceLevel: (restaurant as any)?.priceLevel ?? null,
      matchScore: (restaurantFromPayload as any)?.matchScore ?? null,
      score: log?.score ?? null,
      dishes: log?.dishes,
      standoutDish: log?.standoutDish?.name ?? log?.dishHighlight ?? null,
      vibeTags: log?.vibeTags,
      note: log?.note ?? null,
      imageUrl: restaurantFromPayload?.displayImageUrl ?? detail?.displayImageUrl ?? log?.previewPhotoUrl ?? null,
    });
  };
  const logsForRestaurant = useMemo(
    () => (id ? feedItems.filter((l) => l.restaurantId === id) : []),
    [feedItems, id],
  );
  const log = logId
    ? feedItems.find((l) => l.id === logId)
    : logsForRestaurant.length > 0
      ? logsForRestaurant[0]
      : undefined;
  const isOwnLog = log?.userName === 'You';
  const logOwnerName = log?.userName ?? '';
  // Social context: viewing from a friend's post — hide exploration features
  const isFromFriendPost = !!logId;

  // Friend visits for social proof — exclude the log author to avoid redundancy
  const allFriendVisits = useFriendVisitsAtRestaurant(id ?? '');
  const friendVisits = useMemo(
    () => logOwnerName ? allFriendVisits.filter((fv) => fv.userName !== logOwnerName) : allFriendVisits,
    [allFriendVisits, logOwnerName],
  );

  useEffect(() => {
    if (!id) return;
    getRestaurantDetail(id).then((d) => setDetail(d));
  }, [id]);

  // Skip menu + nearby fetches in social context (friend post view)
  useEffect(() => {
    if (!id || isFromFriendPost) return;
    setMenuLoading(true);
    getRestaurantMenu(id)
      .then((m) => setMenu(m))
      .finally(() => setMenuLoading(false));
  }, [id, isFromFriendPost]);

  useEffect(() => {
    if (!detail || isFromFriendPost) return;
    if (detail.lat == null || detail.lng == null) return;
    getNearbyAfterSpots(detail.lat as number, detail.lng as number).then((res) => {
      // Filter out the current restaurant from "Next stop" suggestions
      const currentName = (restaurant?.name ?? detail?.name ?? '').toLowerCase();
      setAfterSpots(res.spots.filter((s) =>
        s.restaurantId !== id && s.name.toLowerCase() !== currentName
      ));
    }).catch(() => {});
  }, [detail, isFromFriendPost]);

  useEffect(() => {
    let cancelled = false;
    async function loadDistance() {
      if (!detail || detail.lat == null || detail.lng == null) return;
      const fromLat = restaurantFromPayload?.fromLat;
      const fromLng = restaurantFromPayload?.fromLng;
      if (fromLat != null && fromLng != null) {
        const d = distanceInMiles(fromLat, fromLng, detail.lat as number, detail.lng as number);
        if (!cancelled) setDistanceMiles(d);
        return;
      }
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
    return () => { cancelled = true; };
  }, [detail?.lat, detail?.lng, restaurantFromPayload?.fromLat, restaurantFromPayload?.fromLng]);

  const cuisineText = (
    restaurantFromPayload?.cuisines?.find(Boolean) ||
    restaurantFromPayload?.cuisine ||
    restaurant?.cuisine ||
    log?.cuisine ||
    ''
  ).trim();
  const priceStr = formatPriceLevel((restaurant as any)?.priceLevel ?? (detail as any)?.priceLevel);
  const matchScorePercent =
    typeof (restaurantFromPayload as any)?.matchScore === 'number'
      ? Math.round(((restaurantFromPayload as any).matchScore as number) * 100)
      : null;

  // Standout dishes: from user logs (dishes array + dishHighlight), then from menu
  const standoutDishes = useMemo(() => {
    // 1. Collect from logs: both the dishes array and the dishHighlight field
    const counts = new Map<string, number>();
    logsForRestaurant.forEach((l) => {
      // Include dishHighlight (the standout dish the user picked)
      const highlight = (l.dishHighlight ?? l.standoutDish?.name ?? '').trim();
      if (highlight) {
        counts.set(highlight, (counts.get(highlight) || 0) + 2); // boost standout
      }
      l.dishes?.forEach((d) => {
        const key = d.trim();
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    if (counts.size > 0) {
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);
    }
    // 2. From menu sections — pick popular/featured items, filtering out
    //    modifiers/options (spice levels, sizes, add-ons) that aren't real dishes.
    if (menu && menu.sections.length > 0) {
      const MODIFIER_RE = /^(half|no|extra|mild|medium|hot|full|less|more|light|double|triple|add|side of)\s/i;
      const MODIFIER_SUFFIX_RE = /\s(spice|spicy|heat|size|style|option|level|topping|add-on|upgrade)$/i;
      const MODIFIER_EXACT = new Set([
        'spice', 'no spice', 'half spice', 'full spice', 'extra spice', 'mild', 'medium', 'hot',
        'small', 'regular', 'large', 'extra large', 'gluten free', 'vegetarian', 'vegan',
      ]);
      // Operational/status text that scrapers sometimes pick up as menu items
      const NOT_A_DISH_RE = /\b(we are closed|we're closed|closed|kitchen open|kitchen closed|open now|currently open|currently closed|opening hours|hours of operation|order online|delivery|takeout|pickup|dine.in|reservations?|book a table|call us|contact|follow us|visit us)\b/i;
      // Time ranges like "06:30 PM-10:30 PM" or "11am - 9pm"
      const TIME_RANGE_RE = /^\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?\s*[-–]\s*\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?$/;
      // Pure numbers, prices, or phone-like strings
      const NON_DISH_RE = /^[\d\s$€£.,+\-()/#]+$/;

      const isModifier = (name: string) => {
        const lower = name.toLowerCase().trim();
        if (MODIFIER_EXACT.has(lower)) return true;
        if (MODIFIER_RE.test(lower)) return true;
        if (MODIFIER_SUFFIX_RE.test(lower)) return true;
        if (lower.includes('spice') && lower.length < 20) return true;
        // Filter out operational text and time ranges
        if (NOT_A_DISH_RE.test(lower)) return true;
        if (TIME_RANGE_RE.test(lower.trim())) return true;
        if (NON_DISH_RE.test(lower.trim())) return true;
        // Extremely short strings (1-2 chars) are unlikely to be dish names
        if (lower.length <= 2) return true;
        return false;
      };
      const items: string[] = [];
      for (const section of menu.sections) {
        for (const item of section.items) {
          if (item.name && !isModifier(item.name) && items.length < 5) items.push(item.name);
        }
        if (items.length >= 5) break;
      }
      return items.slice(0, 5);
    }
    return [];
  }, [logsForRestaurant, menu]);

  // When viewing from someone else's feed post, show their posts; otherwise show all
  const recentPosts = useMemo(() => {
    if (logId && log && !isOwnLog) {
      return logsForRestaurant.filter((p) => p.userName === log.userName).slice(0, 5);
    }
    return logsForRestaurant.slice(0, 5);
  }, [logsForRestaurant, logId, log, isOwnLog]);

  // ── Info line: $$ · Cuisine · 0.3 mi · Open now ──────────────────────────
  const infoLineParts = [priceStr, cuisineText].filter(Boolean);
  if (distanceMiles != null) {
    infoLineParts.push(distanceMiles < 0.1 ? 'Nearby' : `${distanceMiles.toFixed(1)} mi`);
  }
  const isOpenNow = detail?.isOpenNow === true;

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
    const saveKey = restaurantFromPayload?.id ?? id;
    if (!saveKey || saving) return;
    const name = restaurant?.name ?? log?.restaurantName ?? detail?.name ?? `Restaurant ${saveKey}`;
    const cuisine = restaurant?.cuisine || log?.cuisine || '';
    const neighborhood = restaurant?.neighborhood || restaurant?.state || '';
    const cuisinesList =
      restaurantFromPayload?.cuisines && restaurantFromPayload.cuisines.length > 0
        ? restaurantFromPayload.cuisines
        : undefined;
    try {
      setSaving(true);
      await saveRestaurant(
        {
          place_id: saveKey,
          name,
          photo:
            restaurantFromPayload?.displayImageUrl ??
            restaurantFromPayload?.imageUrl ??
            restaurantFromPayload?.previewPhotoUrl ??
            detail?.displayImageUrl ??
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

  const handleCyclePhoto = async () => {
    const rid = restaurantFromPayload?.id ?? id;
    if (!rid || cyclingPhoto) return;
    setCyclingPhoto(true);
    try {
      await cycleRestaurantPhoto(rid);
      setPhotoKey((k) => k + 1);
    } catch {
      // silently fail
    } finally {
      setCyclingPhoto(false);
    }
  };

  const handleNegativeFeedback = () => {
    if (!id) return;
    const userId = 'default';

    const showFollowUp = () => {
      Alert.alert(
        'What didn\'t work?',
        'This helps us improve — optional',
        [
          { text: 'Cuisine', onPress: () => postNegativeFeedback(userId, id, 'suggest_less_cuisine' as any).catch(() => {}) },
          { text: 'Price', onPress: () => postNegativeFeedback(userId, id, 'suggest_less_price' as any).catch(() => {}) },
          { text: 'Location', onPress: () => postNegativeFeedback(userId, id, 'suggest_less_location' as any).catch(() => {}) },
          { text: 'Skip', style: 'cancel' },
        ],
      );
    };

    const run = (action: 'hide' | 'suggest_less') => {
      postNegativeFeedback(userId, id, action)
        .then(() => {
          if (action === 'hide') {
            Alert.alert('Hidden', 'This restaurant won\'t appear in Discover or Tonight.', [
              { text: 'OK', onPress: () => router.back() },
            ]);
          } else {
            Alert.alert(
              'Got it',
              'We\'ll show you fewer places like this.',
              [{ text: 'OK', onPress: showFollowUp }],
            );
          }
        })
        .catch(() => {
          Alert.alert('Something went wrong', 'We could not update your recommendations. Please try again.');
        });
    };

    const options = ['Show me less like this', 'Hide from all feeds', 'Cancel'];
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex, destructiveButtonIndex: 1 },
        (buttonIndex) => {
          if (buttonIndex === 0) run('suggest_less');
          else if (buttonIndex === 1) run('hide');
        },
      );
    } else {
      Alert.alert(
        'Adjust recommendations',
        undefined,
        [
          { text: 'Show me less like this', onPress: () => run('suggest_less') },
          { text: 'Hide from all feeds', style: 'destructive', onPress: () => run('hide') },
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true },
      );
    }
  };

  const restaurantName = restaurant?.name ?? log?.restaurantName ?? detail?.name ?? `Restaurant ${id ?? ''}`;
  const hasVisited = !!log;
  const quotesWithNotes = friendVisits.filter((fv) => fv.note);
  const hasFriendQuotes = quotesWithNotes.length > 0;
  const [quotesExpanded, setQuotesExpanded] = useState(false);

  // ── Shared UI fragments ──────────────────────────────────────────────

  const logVisitPayload = {
    id: restaurant?.id ?? (restaurantFromPayload?.id as string | undefined) ?? id,
    name: restaurant?.name ?? restaurantFromPayload?.name ?? detail?.name ?? '',
    cuisine: (restaurant as any)?.cuisine ?? restaurantFromPayload?.cuisine ?? '',
    neighborhood: (restaurant as any)?.neighborhood ?? restaurantFromPayload?.neighborhood ?? null,
    state: (restaurant as any)?.state ?? restaurantFromPayload?.state ?? null,
    placeId: restaurantFromPayload?.placeId ?? null,
    googlePlaceId: restaurantFromPayload?.googlePlaceId ?? restaurantFromPayload?.placeId ?? null,
    displayImageUrl:
      restaurantFromPayload?.displayImageUrl ??
      detail?.displayImageUrl ??
      restaurantFromPayload?.imageUrl ??
      detail?.imageUrl ??
      null,
    displayImageSourceType:
      restaurantFromPayload?.displayImageSourceType ?? detail?.displayImageSourceType ?? null,
    displayImageLastResolvedAt:
      restaurantFromPayload?.displayImageLastResolvedAt ?? detail?.displayImageLastResolvedAt ?? null,
    imageUrl: restaurantFromPayload?.imageUrl ?? null,
    priceLevel: (restaurant as any)?.priceLevel ?? restaurantFromPayload?.priceLevel ?? null,
  };

  const heroImage = (
    <View style={styles.heroWrap} collapsable={false}>
      <RestaurantImage
        key={`hero-${photoKey}`}
        restaurant={{
          id: id ?? restaurant?.id ?? restaurantFromPayload?.id ?? null,
          name: restaurantName,
          cuisine: cuisineText,
          googlePlaceId:
            detail?.googlePlaceId ?? detail?.placeId ?? restaurantFromPayload?.googlePlaceId ?? restaurantFromPayload?.placeId ?? null,
          displayImageUrl:
            detail?.displayImageUrl ??
            restaurantFromPayload?.displayImageUrl ??
            detail?.imageUrl ??
            restaurantFromPayload?.imageUrl ??
            restaurantFromPayload?.previewPhotoUrl ??
            logsForRestaurant.find((item) => item.photo_url || item.previewPhotoUrl)?.photo_url ??
            logsForRestaurant.find((item) => item.previewPhotoUrl)?.previewPhotoUrl ??
            null,
          displayImageSourceType:
            detail?.displayImageSourceType ?? restaurantFromPayload?.displayImageSourceType ?? null,
          displayImageLastResolvedAt:
            detail?.displayImageLastResolvedAt ?? restaurantFromPayload?.displayImageLastResolvedAt ?? null,
          previewPhotoUrl:
            detail?.displayImageUrl ??
            detail?.imageUrl ??
            restaurantFromPayload?.previewPhotoUrl ??
            logsForRestaurant.find((item) => item.photo_url || item.previewPhotoUrl)?.photo_url ??
            logsForRestaurant.find((item) => item.previewPhotoUrl)?.previewPhotoUrl ??
            null,
          imageUrl:
            restaurantFromPayload?.displayImageUrl ??
            restaurantFromPayload?.imageUrl ??
            detail?.displayImageUrl ??
            detail?.imageUrl ??
            null,
        }}
        aspectRatio={1}
        fallbackType="icon"
        borderRadius={0}
        style={styles.heroImageFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.88)']}
        locations={[0, 0.45, 1]}
        style={styles.heroGradient}
      />
      {saved && (
        <View style={styles.savedBadgeHero}>
          <Ionicons name="bookmark" size={14} color="#fff" />
        </View>
      )}
      <TouchableOpacity
        style={styles.wrongPhotoBtn}
        onPress={handleCyclePhoto}
        activeOpacity={0.7}
        hitSlop={8}
        disabled={cyclingPhoto}
      >
        <Ionicons name="camera-outline" size={13} color="rgba(255,255,255,0.7)" />
        <Text style={styles.wrongPhotoText}>
          {cyclingPhoto ? 'Loading...' : 'Wrong photo?'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const infoLine = (
    <View style={styles.infoLineRow}>
      <Text style={styles.infoLineText} numberOfLines={1}>
        {infoLineParts.join(' \u00B7 ')}
      </Text>
      {isOpenNow && (
        <View style={styles.openBadge}>
          <View style={styles.openDot} />
          <Text style={styles.openText}>Open now</Text>
        </View>
      )}
    </View>
  );

  const friendsBar = friendVisits.length > 0 ? (
    <View style={styles.friendsSection}>
      <View style={styles.friendAvatarsRow}>
        {friendVisits.slice(0, 3).map((fv, i) => (
          <View key={fv.id} style={[styles.friendAvatarRing, { marginLeft: i === 0 ? 0 : -10 }]}>
            {fv.userAvatar ? (
              <Image source={{ uri: fv.userAvatar }} style={styles.friendAvatarImg} />
            ) : (
              <Text style={styles.friendAvatarInitial}>{fv.userName[0]}</Text>
            )}
          </View>
        ))}
      </View>
      <Text style={styles.friendsText}>
        {friendVisits.length === 1
          ? `${friendVisits[0].userName} has been here`
          : friendVisits.length === 2
            ? `${friendVisits[0].userName} + ${friendVisits[1].userName} have been here`
            : `${friendVisits[0].userName} + ${friendVisits.length - 1} friends have been here`}
      </Text>
    </View>
  ) : null;

  const actionButtons = (
    <View style={styles.actionsStrip} collapsable={false}>
      <TouchableOpacity
        style={[styles.iconBtn, saved && styles.iconBtnActive]}
        onPress={handleSave}
        disabled={saving || !(restaurantFromPayload?.id ?? id)}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={saved ? colors.accent : colors.text} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={() => setSendSheetOpen(true)}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Ionicons name="paper-plane-outline" size={22} color={colors.text} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={handleDirections}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Ionicons name="navigate-outline" size={22} color={colors.text} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.iconBtn, inCompare && styles.iconBtnActive]}
        onPress={handleToggleCompare}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Ionicons name={inCompare ? 'git-compare' : 'git-compare-outline'} size={22} color={inCompare ? colors.accent : colors.text} />
      </TouchableOpacity>
    </View>
  );



  const standoutDishesBlock = standoutDishes.length > 0 ? (
    <View style={styles.dishesSection}>
      <Text style={styles.dishesSectionTitle}>{'\u2B50'} Standout dishes</Text>
      <View style={styles.dishChipsRow}>
        {standoutDishes.map((name) => (
          <View key={name} style={styles.dishChip}>
            <Text style={styles.dishChipText}>{name}</Text>
          </View>
        ))}
      </View>
    </View>
  ) : null;

  const visibleQuotes = quotesExpanded ? quotesWithNotes.slice(0, 10) : quotesWithNotes.slice(0, 2);
  const hasMoreQuotes = quotesWithNotes.length > 2;

  const friendQuotesBlock = hasFriendQuotes ? (
    <View style={styles.socialProofSection}>
      <Text style={styles.socialProofTitle}>What others said</Text>
      {visibleQuotes.map((fv) => (
          <View key={fv.id} style={styles.quoteRow}>
            <View style={styles.quoteAvatarSmall}>
              {fv.userAvatar ? (
                <Image source={{ uri: fv.userAvatar }} style={styles.quoteAvatarImg} />
              ) : (
                <Text style={styles.quoteAvatarInitialSmall}>{fv.userName[0]}</Text>
              )}
            </View>
            <View style={styles.quoteBubble}>
              <Text style={styles.quoteText} numberOfLines={3}>"{fv.note}"</Text>
              <Text style={styles.quoteAuthor}>{fv.userName}</Text>
            </View>
          </View>
        ))}
      {hasMoreQuotes && (
        <TouchableOpacity onPress={() => setQuotesExpanded((v) => !v)} activeOpacity={0.7} style={styles.seeAllBtn}>
          <Text style={styles.seeAllText}>
            {quotesExpanded ? 'Show less' : `See all ${quotesWithNotes.length} comments`}
          </Text>
          <Ionicons name={quotesExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  // Clean junk out of scraped menus before rendering. Same logic used for
  // computing popularItems above — modifiers (mild/extra), time ranges,
  // operational text ("Order online"), and pure-number rows get stripped.
  // Server's quality threshold has already run, but defense in depth: if
  // the server's `available` flag is false, treat as no menu.
  const filteredMenu = useMemo(() => {
    if (!menu) return null;
    if (menu.available === false) return null;
    const MODIFIER_RE = /^(half|no|extra|mild|medium|hot|full|less|more|light|double|triple|add|side of)\s/i;
    const MODIFIER_SUFFIX_RE = /\s(spice|spicy|heat|size|style|option|level|topping|add-on|upgrade)$/i;
    const MODIFIER_EXACT = new Set([
      'spice', 'no spice', 'half spice', 'full spice', 'extra spice', 'mild', 'medium', 'hot',
      'small', 'regular', 'large', 'extra large', 'gluten free', 'vegetarian', 'vegan',
    ]);
    const NOT_A_DISH_RE = /\b(we are closed|we're closed|closed|kitchen open|kitchen closed|open now|currently open|currently closed|opening hours|hours of operation|order online|delivery|takeout|pickup|dine.in|reservations?|book a table|call us|contact|follow us|visit us)\b/i;
    const TIME_RANGE_RE = /^\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?\s*[-–]\s*\d{1,2}[:.]\d{2}\s*(am|pm|AM|PM)?$/;
    const NON_DISH_RE = /^[\d\s$€£.,+\-()/#]+$/;
    const isJunk = (name: string) => {
      if (!name) return true;
      const lower = name.toLowerCase().trim();
      if (lower.length <= 2) return true;
      if (MODIFIER_EXACT.has(lower)) return true;
      if (MODIFIER_RE.test(lower)) return true;
      if (MODIFIER_SUFFIX_RE.test(lower)) return true;
      if (lower.includes('spice') && lower.length < 20) return true;
      if (NOT_A_DISH_RE.test(lower)) return true;
      if (TIME_RANGE_RE.test(lower.trim())) return true;
      if (NON_DISH_RE.test(lower.trim())) return true;
      return false;
    };
    const sections = menu.sections
      .map((sec) => ({ ...sec, items: sec.items.filter((it) => !isJunk(it.name)) }))
      .filter((sec) => sec.items.length > 0);
    if (sections.length === 0) return null;
    return { ...menu, sections };
  }, [menu]);

  // Fallback when no menu is available: surface dishes mined from Google
  // reviews. Real signal, no fabrication — beats showing nothing.
  const peopleOrderDishes = (!filteredMenu && detail?.popularDishesFromReviews?.length)
    ? detail.popularDishesFromReviews
    : null;

  // "What people are saying" — descriptor+noun phrases mined from Google
  // reviews ("great pizza", "cozy atmosphere"). Renders as a chip cloud
  // sized roughly by mention count.
  const sayings = detail?.whatPeopleAreSaying ?? [];
  const whatPeopleAreSayingBlock = sayings.length > 0 ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>What people are saying</Text>
      <Text style={styles.sectionSubtitle}>From recent Google reviews</Text>
      <View style={styles.sayingsWrap}>
        {sayings.map((s) => (
          <View
            key={s.phrase}
            style={[
              styles.sayingChip,
              s.mentionCount >= 3 && styles.sayingChipBig,
            ]}
          >
            <Text
              style={[
                styles.sayingText,
                s.mentionCount >= 3 && styles.sayingTextBig,
              ]}
            >
              {s.phrase}
            </Text>
            {s.mentionCount > 1 ? (
              <Text style={styles.sayingCount}> · {s.mentionCount}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  ) : null;

  // Menu block — four possible states:
  //  1. menuLoading                              -> spinner
  //  2. filteredMenu present                     -> full menu
  //  3. no menu but popular-dishes available     -> "What people order" chips
  //  4. no menu, detail still fetching reviews   -> spinner ("hold on")
  //  5. no menu and detail returned no dishes    -> "Menu unavailable" message
  // The detail fetch (which produces popularDishesFromReviews) is independent
  // of the menu fetch and may finish later. Without state 4 there's a
  // visible "section disappears" gap.
  const detailStillLoading = !detail && !!id;
  const menuBlock = menuLoading || (!filteredMenu && detailStillLoading) ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Menu</Text>
      <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 12 }} />
    </View>
  ) : filteredMenu ? (
    <MenuTemplate menu={filteredMenu} restaurantName={restaurantName} />
  ) : peopleOrderDishes ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>What people order</Text>
      <Text style={styles.sectionSubtitle}>From recent Google reviews</Text>
      <View style={styles.peopleOrderRow}>
        {peopleOrderDishes.map((d) => (
          <View key={d.name} style={styles.peopleOrderChip}>
            <Text style={styles.peopleOrderText}>{d.name}</Text>
          </View>
        ))}
      </View>
    </View>
  ) : (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Menu</Text>
      <Text style={styles.sectionSubtitle}>
        Menu unavailable — try the restaurant{'’'}s website or social.
      </Text>
    </View>
  );

  const afterSpotsBlock = afterSpots.length > 0 ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Next stop</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.afterSpotsScroll}>
        {afterSpots.map((spot) => {
          // Next Stop spot.restaurantId is typically a Google place id
          // (ChIJ...) so we thread it through as placeId/googlePlaceId.
          // The detail page uses these as fallbacks before the async
          // /api/restaurants/:id fetch lands, and they let the
          // RestaurantImage resolver chase a photo right away.
          const isChIJ = typeof spot.restaurantId === 'string' && spot.restaurantId.startsWith('ChIJ');
          const placeId = isChIJ ? spot.restaurantId : null;
          return (
          <TouchableOpacity
            key={spot.restaurantId}
            style={styles.afterCard}
            activeOpacity={0.85}
            onPress={() => router.push({
              pathname: '/(tabs)/restaurant/[id]',
              params: {
                id: spot.restaurantId,
                payload: encodeURIComponent(JSON.stringify({
                  id: spot.restaurantId,
                  name: spot.name,
                  cuisine: spot.category || '',
                  neighborhood: spot.address || '',
                  placeId,
                  googlePlaceId: placeId,
                  displayImageUrl: spot.imageUrl,
                  imageUrl: spot.imageUrl,
                  previewPhotoUrl: spot.imageUrl,
                })),
              },
            })}
          >
            {spot.imageUrl ? (
              <RestaurantImage
                restaurant={{
                  id: spot.restaurantId,
                  name: spot.name,
                  displayImageUrl: spot.imageUrl,
                  displayImageSourceType: null,
                  displayImageLastResolvedAt: null,
                }}
                aspectRatio={1.4}
                fallbackType="icon"
                borderRadius={12}
                style={styles.afterCardImage}
              />
            ) : (
              <View style={[styles.afterCardImage, styles.afterCardImageFallback]}>
                <Ionicons name="wine-outline" size={22} color={colors.textMuted} />
              </View>
            )}
            <Text style={styles.afterCardName} numberOfLines={1}>{spot.name}</Text>
            <View style={styles.afterCardMeta}>
              {spot.distanceMi != null && (
                <Text style={styles.afterCardDistance}>{spot.distanceMi} mi</Text>
              )}
              {spot.vibeTag && (
                <View style={styles.afterCardVibe}>
                  <Text style={styles.afterCardVibeText}>{spot.vibeTag}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  ) : null;

  const detailsBlock = (
    <>
      {(detail?.address || restaurant?.neighborhood || restaurant?.state) ? (
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={15} color={colors.textMuted} />
            <Text style={styles.detailText}>
              {detail?.address || [restaurant?.neighborhood, restaurant?.state].filter(Boolean).join(', ')}
            </Text>
          </View>
        </View>
      ) : null}
      {/* Reserve section — only real booking providers (OpenTable / Resy /
          SevenRooms / Tock / Yelp). Phone and website are NOT shown here —
          the phone number is already in the contact card below, and a generic
          website isn't a booking tool. If no real booking link exists, the
          whole Reserve section is hidden. */}
      {(() => {
        const REAL_BOOKING: ReservationProvider[] = ['opentable', 'resy', 'sevenrooms', 'tock', 'yelp'];
        const realLinks = sortReservationLinks(detail?.reservationLinks ?? [])
          .filter((l) => REAL_BOOKING.includes(l.provider));
        if (realLinks.length === 0) return null;
        const [primary, ...rest] = realLinks;
        return (
          <View style={styles.reserveCard}>
            <Text style={styles.reserveLabel}>Reserve</Text>
            <TouchableOpacity
              style={styles.reservePrimaryBtn}
              onPress={() => openReservationLink(primary)}
              activeOpacity={0.85}
              accessibilityLabel={reservationLabel(primary.provider)}
            >
              <Ionicons name={reservationIcon(primary.provider)} size={16} color="#fff" />
              <Text style={styles.reservePrimaryText}>{reservationLabel(primary.provider)}</Text>
            </TouchableOpacity>
            {/* Secondaries: only show OTHER real booking providers. */}
            {(() => {
              const secondaries = rest
                .filter((l) => REAL_BOOKING.includes(l.provider))
                .slice(0, 2);
              if (secondaries.length === 0) return null;
              return (
                <View style={styles.reserveSecondaryRow}>
                  {secondaries.map((link) => (
                    <TouchableOpacity
                      key={link.id}
                      style={styles.reserveSecondaryBtn}
                      onPress={() => openReservationLink(link)}
                      activeOpacity={0.8}
                      accessibilityLabel={reservationLabel(link.provider)}
                    >
                      <Ionicons name={reservationIcon(link.provider)} size={14} color={colors.accent} />
                      <Text style={styles.reserveSecondaryText} numberOfLines={1}>
                        {reservationLabel(link.provider)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>
        );
      })()}

      {(detail?.hours || detail?.phone || detail?.websiteUrl) ? (
        <View style={styles.detailsCard}>
          {detail?.phone ? (
            <TouchableOpacity
              style={styles.detailRow}
              onPress={() => Linking.openURL(`tel:${detail.phone!.trim()}`).catch(() => {})}
            >
              <Ionicons name="call-outline" size={15} color={colors.textMuted} />
              <Text style={styles.detailText}>{detail.phone}</Text>
            </TouchableOpacity>
          ) : null}
          {detail?.hours && detail.hours.length > 0 ? (
            <View>
              <TouchableOpacity
                style={styles.detailRow}
                onPress={() => setHoursExpanded((v) => !v)}
              >
                <Ionicons name="time-outline" size={15} color={colors.textMuted} />
                <Text style={styles.detailText}>
                  {detail.isOpenNow != null
                    ? detail.isOpenNow ? 'Open now' : 'Closed'
                    : 'Hours'}
                </Text>
                <Ionicons
                  name={hoursExpanded ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color={colors.textMuted}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
              {hoursExpanded ? (
                <View style={styles.hoursList}>
                  {detail.hours.map((line, i) => (
                    <Text key={i} style={styles.hoursLine}>{line}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {detail?.websiteUrl ? (
            <TouchableOpacity
              style={styles.detailRow}
              onPress={() => Linking.openURL(detail.websiteUrl!).catch(() => {})}
            >
              <Ionicons name="globe-outline" size={15} color={colors.textMuted} />
              <Text style={styles.detailText} numberOfLines={1}>
                {detail.websiteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Back + overflow menu */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              style={styles.logFab}
              onPress={() => {
                router.push({
                  pathname: '/log-visit',
                  params: { payload: encodeURIComponent(JSON.stringify(logVisitPayload)) },
                });
              }}
              activeOpacity={0.8}
              hitSlop={6}
            >
              <Ionicons name="add" size={22} color="#fff" />
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
        </View>

        {heroImage}

        {hasVisited ? (
          /* ═══════════════════════════════════════════════════════════════
             STATE 2: HAS VISITED — lead with personal experience
             ═══════════════════════════════════════════════════════════════ */
          <>
            <View style={styles.topSection}>
              <Text style={styles.restaurantName} numberOfLines={2}>{restaurantName}</Text>

              {/* Your rating — prominent */}
              <View style={styles.visitedRatingRow}>
                <Text style={styles.visitedRatingScore}>{log.score.toFixed(1)}</Text>
                <View>
                  <Text style={styles.visitedRatingLabel}>{isOwnLog ? 'Your rating' : `${logOwnerName}'s rating`}</Text>
                  {log.highlight ? (
                    <Text style={styles.visitedRatingHighlight}>{log.highlight.charAt(0).toUpperCase() + log.highlight.slice(1)}</Text>
                  ) : null}
                </View>
              </View>

              {/* Match score — secondary */}
              {matchScorePercent != null && matchScorePercent > 0 && (
                <Text style={styles.matchTextSecondary}>{'\u2728'} {matchScorePercent}% match</Text>
              )}

              {infoLine}
            </View>

            {/* Poster's quick take — shown when viewing someone else's log from feed */}
            {!isOwnLog && log.note ? (
              <View style={styles.posterQuoteWrap}>
                <View style={styles.posterQuoteRow}>
                  {log.userAvatar ? (
                    <Image source={{ uri: log.userAvatar }} style={styles.posterAvatar} />
                  ) : (
                    <View style={[styles.posterAvatar, styles.posterAvatarFallback]}>
                      <Text style={styles.posterAvatarInitial}>{logOwnerName[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                  )}
                  <View style={styles.posterQuoteBody}>
                    <Text style={styles.posterName}>{logOwnerName}</Text>
                    <Text style={styles.posterNote}>{log.note}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {friendsBar}
            {actionButtons}

            {/* Tagged friends — "You went with Casey, Riley" */}
            {log.taggedUsers && log.taggedUsers.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {isOwnLog ? 'You went with' : `${logOwnerName} went with`}
                </Text>
                <Text style={styles.dishItem}>
                  {log.taggedUsers.map((t) => t.displayName || t.userName).join(', ')}
                </Text>
              </View>
            ) : null}

            {/* Own-log note (caption). For other people's logs this is shown
                in the posterQuote block above; for own logs we surface it
                here so the user sees what they wrote. */}
            {isOwnLog && log.note ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What you said</Text>
                <Text style={styles.dishItem}>{log.note}</Text>
              </View>
            ) : null}

            {/* Visit count — only meaningful when ≥ 2 */}
            {log.visitCount && log.visitCount > 1 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Visits</Text>
                <Text style={styles.dishItem}>
                  {isOwnLog
                    ? `You've been here ${log.visitCount} times`
                    : `${logOwnerName} has been here ${log.visitCount} times`}
                </Text>
              </View>
            ) : null}

            {/* Dishes */}
            {log.dishes && log.dishes.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{isOwnLog ? 'Dishes you tried' : `Dishes ${logOwnerName} tried`}</Text>
                <View style={styles.dishList}>
                  {log.dishes.map((d, i) => (
                    <Text key={i} style={styles.dishItem}>
                      {'\u00B7'} {d}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Vibe */}
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

            {/* Your notes / recent posts — skip when poster quote already shows the note */}
            {recentPosts.length > 0 && !isFromFriendPost && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your posts</Text>
                {recentPosts.map((p) => (
                  <View key={p.id} style={styles.postRow}>
                    <View style={styles.postAvatar}>
                      <Text style={styles.postAvatarInitial}>{p.userName[0] ?? '\u00B7'}</Text>
                    </View>
                    <View style={styles.postMeta}>
                      <Text style={styles.postUser}>{p.userName}</Text>
                      {p.note ? <Text style={styles.postNote} numberOfLines={2}>{p.note}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Section order follows the discovery -> decision flow:
                BiteRight Picks (your own logs) -> Friends Ordered (social
                proof) -> Quick Tips -> Full Menu (or What People Order
                fallback when menu unavailable) -> Review keyword cloud ->
                Utility details (hours/website) -> Next stop. Each block
                self-hides when it has no signal. */}
            {standoutDishesBlock}
            {!isFromFriendPost && friendQuotesBlock}
            {!isFromFriendPost && id && <QuickTipsBlock restaurantId={id} />}
            {!isFromFriendPost && menuBlock}
            {!isFromFriendPost && whatPeopleAreSayingBlock}
            {!isFromFriendPost && detailsBlock}
            {!isFromFriendPost && afterSpotsBlock}
            {isFromFriendPost && (
              <TouchableOpacity
                style={styles.fullDetailCta}
                activeOpacity={0.7}
                onPress={() => router.push(`/(tabs)/restaurant/${encodeURIComponent(id!)}`)}
              >
                <Text style={styles.fullDetailCtaText}>View full restaurant →</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} />
              </TouchableOpacity>
            )}
          </>
        ) : (
          /* ═══════════════════════════════════════════════════════════════
             STATE 1: NOT VISITED — help the user decide
             ═══════════════════════════════════════════════════════════════ */
          <>
            <View style={styles.topSection}>
              <Text style={styles.restaurantName} numberOfLines={2}>{restaurantName}</Text>

              {/* Match score — large and prominent */}
              {matchScorePercent != null && matchScorePercent > 0 && (
                <View style={styles.matchRowLarge}>
                  <Text style={styles.matchTextLarge}>{'\u2728'} {matchScorePercent}% match for you</Text>
                </View>
              )}

              {infoLine}
            </View>

            {friendsBar}
            {actionButtons}

            {standoutDishesBlock}
            {friendQuotesBlock}
            {id && <QuickTipsBlock restaurantId={id} />}
            {!isFromFriendPost && detailsBlock}
            {!isFromFriendPost && whatPeopleAreSayingBlock}
            {!isFromFriendPost && menuBlock}
            {!isFromFriendPost && afterSpotsBlock}
            {isFromFriendPost && (
              <TouchableOpacity
                style={styles.fullDetailCta}
                activeOpacity={0.7}
                onPress={() => router.push(`/(tabs)/restaurant/${encodeURIComponent(id!)}`)}
              >
                <Text style={styles.fullDetailCtaText}>View full restaurant →</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} />
              </TouchableOpacity>
            )}
          </>
        )}

      </ScrollView>

      <SendToFriendSheet
        visible={sendSheetOpen}
        onClose={() => setSendSheetOpen(false)}
        restaurantName={restaurantName}
        restaurantId={id ?? ''}
        cuisine={(restaurant as any)?.cuisine ?? restaurantFromPayload?.cuisine}
        neighborhood={restaurant?.neighborhood ?? restaurantFromPayload?.neighborhood ?? undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backText: { marginLeft: 2, fontSize: 14, color: colors.text },
  menuBtn: { paddingHorizontal: 6, paddingVertical: 4 },

  // Hero
  heroWrap: {
    height: 240,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 0,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#111827',
    position: 'relative',
    zIndex: 0,
  },
  heroImageFill: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 160 },
  savedBadgeHero: {
    position: 'absolute',
    top: 14,
    right: 14,
    padding: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  wrongPhotoBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  wrongPhotoText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
  },

  // Top section (name + match + info)
  topSection: { paddingTop: 16, paddingBottom: 4 },
  restaurantName: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
    lineHeight: 32,
  },
  matchRow: { marginTop: 6 },
  matchText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
  },
  // State 1: NOT VISITED — large match score
  matchRowLarge: { marginTop: 10, marginBottom: 2 },
  matchTextLarge: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.accent,
    letterSpacing: -0.2,
  },
  // State 2: HAS VISITED — prominent rating, secondary match
  visitedRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visitedRatingScore: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.accent,
    lineHeight: 36,
  },
  visitedRatingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  visitedRatingHighlight: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 1,
  },
  matchTextSecondary: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  infoLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  infoLineText: {
    fontSize: 14,
    color: colors.textMuted,
    flexShrink: 1,
  },
  openBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  openDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34C759',
  },
  openText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1B873B',
  },

  // Friends
  friendsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#FFF5EE',
    borderWidth: 1,
    borderColor: '#F0DDD0',
  },
  friendAvatarsRow: { flexDirection: 'row', alignItems: 'center' },
  friendAvatarRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2.5,
    borderColor: '#FFF5EE',
    backgroundColor: colors.surfaceSoft,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarImg: { width: '100%', height: '100%' },
  friendAvatarInitial: { fontSize: 14, fontWeight: '700', color: colors.text },
  friendsText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#6B4226' },

  // Actions
  actionsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 14,
    marginBottom: 4,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  logFab: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Standout dishes
  dishesSection: { marginTop: 20 },
  dishesSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  dishChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dishChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFF5EE',
    borderWidth: 1,
    borderColor: '#F0DDD0',
  },
  dishChipText: { fontSize: 13, fontWeight: '600', color: colors.text },

  // Social proof quotes
  socialProofSection: { marginTop: 20 },
  socialProofTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  quoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  quoteAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  quoteAvatarImg: { width: '100%', height: '100%' },
  quoteAvatarInitialSmall: { fontSize: 12, fontWeight: '700', color: colors.text },
  quoteBubble: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quoteText: { fontSize: 13, fontStyle: 'italic', color: colors.text, lineHeight: 18 },
  quoteAuthor: { marginTop: 4, fontSize: 12, fontWeight: '600', color: colors.textMuted },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginTop: 2,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },

  // Sections (rating, dishes, vibe, posts)
  section: { marginTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: -4, marginBottom: 10 },
  sayingsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sayingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sayingChipBig: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  sayingText: { fontSize: 12, fontWeight: '600', color: colors.text },
  sayingTextBig: { fontSize: 13, fontWeight: '700', color: colors.accent },
  sayingCount: { fontSize: 11, color: colors.textMuted, marginLeft: 2 },
  peopleOrderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  peopleOrderChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  peopleOrderText: { fontSize: 13, fontWeight: '600', color: colors.accent },
  ratingBreakdown: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  ratingLabel: { fontSize: 14, color: colors.text },
  ratingValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  dishList: { marginTop: 4 },
  dishItem: { fontSize: 14, color: colors.text, marginBottom: 4 },
  vibeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vibePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vibePillText: { fontSize: 13, color: colors.text },
  postRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  postAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  postAvatarInitial: { fontSize: 16, fontWeight: '600', color: colors.text },
  postMeta: { flex: 1 },
  postUser: { fontSize: 13, fontWeight: '600', color: colors.text },
  postNote: { fontSize: 12, color: colors.textMuted },

  // Poster quote (when viewing someone else's log from feed)
  posterQuoteWrap: {
    marginTop: 12,
    marginBottom: 4,
    padding: 14,
    paddingLeft: 0,
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  posterQuoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  posterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  posterAvatarFallback: {
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterAvatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  posterQuoteBody: {
    flex: 1,
  },
  posterName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  posterNote: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },

  // Details (de-emphasized)
  detailsCard: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.85,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  detailText: { fontSize: 13, color: colors.textMuted, flex: 1 },
  hoursList: { marginLeft: 25, marginBottom: 4 },
  hoursLine: { fontSize: 12, color: colors.textMuted, lineHeight: 19 },

  // "Keep the night going" / nearby after spots
  afterSpotsScroll: { gap: 12, paddingRight: 4 },
  afterCard: {
    width: 130,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  afterCardImage: {
    width: 130,
    height: 90,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  afterCardImageFallback: {
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  afterCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  afterCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 10,
  },
  afterCardDistance: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
  },
  afterCardVibe: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.surfaceSoft,
  },
  afterCardVibeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  fullDetailCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fullDetailCtaText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },

  // ── Reserve section ──
  reserveCard: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reserveLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  // Button stretches the inner content area of the card (alignSelf: stretch).
  // No negative margin — the card's pill shadow renders cleanly inside its
  // rounded corners instead of overflowing on each side.
  reservePrimaryBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  reservePrimaryText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.1,
    textAlign: 'center',
    includeFontPadding: false,
  },
  reserveSecondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  reserveSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reserveSecondaryText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.accent,
    maxWidth: 180,
  },

  // ── Compare quick-add ──
});

function distanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
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
