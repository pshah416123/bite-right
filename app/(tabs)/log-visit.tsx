import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';
import { colors } from '~/src/theme/colors';
import {
  fetchAutocomplete,
  getRestaurantDetail,
  getSearchHealth,
  selectRestaurant,
  type AutocompleteSuggestion,
  type SearchHealth,
  type SelectedRestaurant,
} from '~/src/api/restaurants';
import { apiClient } from '~/src/api/client';
import { RESTAURANTS } from '~/src/data/restaurants';
import { useFeedContext } from '~/src/context/FeedContext';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import type { VibeTag } from '~/src/components/FeedCard';
import { FriendTagPicker } from '~/src/components/tagging/FriendTagPicker';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
type PrefilledRestaurant = SelectedRestaurant & {
  cuisine?: string;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
};

const VIBE_OPTIONS: { value: VibeTag; label: string }[] = [
  { value: 'date_night', label: 'Date night' },
  { value: 'casual', label: 'Casual' },
  { value: 'solo_dining', label: 'Solo dining' },
  { value: 'group', label: 'Group dinner' },
  { value: 'celebration', label: 'Celebration' },
  { value: 'quick_bite', label: 'Quick bite' },
  { value: 'late_night' as VibeTag, label: 'Late night' },
  { value: 'weekend_brunch' as VibeTag, label: 'Weekend brunch' },
];

export default function LogVisitScreen() {
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [selectedRestaurant, setSelectedRestaurant] = useState<SelectedRestaurant | null>(null);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null);
  const [overallScore, setOverallScore] = useState(7);
  const [caption, setCaption] = useState('');
  const [standoutDishes, setStandoutDishes] = useState<string[]>([]);
  const [orderedDishes, setOrderedDishes] = useState<string[]>([]);
  const [dishInput, setDishInput] = useState('');
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([]);
  const [quickTip, setQuickTip] = useState('');
  const [bestTime, setBestTime] = useState<string | null>(null);
  const [taggedUserNames, setTaggedUserNames] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [primaryIndex, setPrimaryIndex] = useState<number | null>(null);
  const [searchHealth, setSearchHealth] = useState<SearchHealth | null | undefined>(undefined);
  const [restaurantInputFocused, setRestaurantInputFocused] = useState(false);
  const [fallbackSuggestions, setFallbackSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [revisitCount, setRevisitCount] = useState<number>(0);
  const scrollRef = useRef<ScrollView>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { items, addLog, updateLog, getRestaurantLog } = useFeedContext();
  const { savedRestaurants } = useSavedRestaurants();
  const router = useRouter();
  const params = useLocalSearchParams<{ logId?: string; payload?: string }>();
  const logIdParam =
    typeof params.logId === 'string' ? params.logId : Array.isArray(params.logId) ? params.logId[0] : undefined;
  const isEditMode = !!(logIdParam && logIdParam.trim());
  const payloadRaw =
    typeof params.payload === 'string'
      ? params.payload
      : Array.isArray(params.payload)
        ? params.payload[0]
        : undefined;

  const editingLog = useMemo(
    () => (logIdParam ? items.find((item) => item.id === logIdParam) : undefined),
    [items, logIdParam],
  );

  const prefilledRestaurant = useMemo<PrefilledRestaurant | null>(() => {
    if (!payloadRaw) return null;
    try {
      const parsed = JSON.parse(payloadRaw) as {
        id?: string;
        name?: string;
        cuisine?: string;
        neighborhood?: string | null;
        state?: string | null;
        placeId?: string | null;
        googlePlaceId?: string | null;
        displayImageUrl?: string | null;
        imageUrl?: string | null;
      };

      if (!parsed?.id || !parsed?.name) return null;

      const address = [parsed.neighborhood, parsed.state].filter(Boolean).join(', ');
      return {
        restaurantId: parsed.id,
        placeId: parsed.googlePlaceId ?? parsed.placeId ?? parsed.id,
        name: parsed.name,
        address: address || parsed.neighborhood || '',
        displayImageUrl:
          typeof parsed.displayImageUrl === 'string'
            ? parsed.displayImageUrl
            : typeof parsed.imageUrl === 'string'
              ? parsed.imageUrl
              : undefined,
        fallbackPhotoUrl:
          typeof parsed.displayImageUrl === 'string'
            ? parsed.displayImageUrl
            : typeof parsed.imageUrl === 'string'
              ? parsed.imageUrl
              : undefined,
        cuisine: parsed.cuisine,
        neighborhood: parsed.neighborhood,
        state: parsed.state,
      };
    } catch {
      return null;
    }
  }, [payloadRaw]);

  // Dynamic suggestions: recently logged restaurants, then saved spots not yet logged.
  // Shown when the input is focused but empty — surfaces "places you might be logging again."
  const dynamicSuggestions = useMemo<AutocompleteSuggestion[]>(() => {
    const myLogs = items.filter((l) => l.userName === 'You');
    const seen = new Set<string>();
    const result: AutocompleteSuggestion[] = [];

    for (const log of myLogs) {
      if (seen.has(log.restaurantId)) continue;
      seen.add(log.restaurantId);
      const seed = RESTAURANTS.find((r) => r.id === log.restaurantId);
      result.push({
        placeId: `mock_${log.restaurantId}`,
        name: log.restaurantName,
        address: [log.neighborhood ?? seed?.neighborhood, log.city ?? seed?.city ?? log.state ?? seed?.state].filter(Boolean).join(', '),
      });
      if (result.length >= 3) return result;
    }

    for (const saved of savedRestaurants) {
      const id = saved.restaurantId ?? saved.place_id;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        placeId: saved.place_id ?? `mock_${id}`,
        name: saved.name,
        address: [saved.neighborhood, saved.city].filter(Boolean).join(', '),
      });
      if (result.length >= 3) break;
    }

    return result;
  }, [items, savedRestaurants]);

  // Personal dish history: dishes the user previously logged at this restaurant,
  // with standouts first. Only shown when meaningful personal data exists.
  const previousDishes = useMemo<string[]>(() => {
    const rid = selectedRestaurant?.restaurantId ?? prefilledRestaurant?.restaurantId;
    if (!rid) return [];
    const myLogs = items.filter((l) => l.userName === 'You' && l.restaurantId === rid);
    if (myLogs.length === 0) return [];

    const standouts = new Set<string>();
    const all = new Set<string>();
    for (const log of myLogs) {
      const dh = log.standoutDish?.name ?? log.dishHighlight;
      if (dh) standouts.add(dh);
      log.dishes?.forEach((d) => { if (d.trim()) all.add(d); });
      if (dh) all.add(dh);
    }
    // Standouts first, then the rest
    const sorted = [...standouts, ...[...all].filter((d) => !standouts.has(d))];
    return sorted.slice(0, 8);
  }, [items, selectedRestaurant?.restaurantId, prefilledRestaurant?.restaurantId]);

  const resetForm = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (blurDelayRef.current) {
      clearTimeout(blurDelayRef.current);
      blurDelayRef.current = null;
    }
    setRestaurantQuery('');
    setSelectedRestaurant(null);
    setSuggestions([]);
    setLoading(false);
    setAutocompleteError(null);
    setOverallScore(7);
    setCaption('');
    setStandoutDishes([]);
    setOrderedDishes([]);
    setDishInput('');
    setVibeTags([]);
    setQuickTip('');
    setBestTime(null);
    setTaggedUserNames([]);
    setPhotos([]);
    setPrimaryIndex(null);
    setRestaurantInputFocused(false);
    setFallbackSuggestions([]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isEditMode && !payloadRaw) {
        resetForm();
      }
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [isEditMode, payloadRaw, resetForm]),
  );

  useEffect(() => {
    let cancelled = false;
    getSearchHealth().then((health) => {
      if (!cancelled) setSearchHealth(health ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // GPS location for search bias
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) {
          setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch {
        // Location unavailable — fall back to default search
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!prefilledRestaurant || isEditMode) return;
    setRestaurantQuery(prefilledRestaurant.name);
    setSelectedRestaurant(prefilledRestaurant);
    setSuggestions([]);
    setFallbackSuggestions([]);
    setRestaurantInputFocused(false);
  }, [isEditMode, prefilledRestaurant]);

  useEffect(() => {
    if (!isEditMode || !editingLog) return;
    setRestaurantQuery(editingLog.restaurantName);
    setSelectedRestaurant({
      restaurantId: editingLog.restaurantId,
      placeId: editingLog.restaurantId,
      name: editingLog.restaurantName,
      address:
        editingLog.address ??
        [editingLog.neighborhood, editingLog.state].filter(Boolean).join(', '),
      displayImageUrl: editingLog.photo_url ?? editingLog.previewPhotoUrl,
      fallbackPhotoUrl: editingLog.previewPhotoUrl,
    });
    setSuggestions([]);
    setLoading(false);
    setAutocompleteError(null);
    setOverallScore(editingLog.score);
    setCaption(editingLog.note ?? '');
    const existingStandouts: string[] = [];
    const dh = editingLog.standoutDish?.name ?? editingLog.dishHighlight;
    if (dh) existingStandouts.push(dh);
    editingLog.dishes?.forEach((d) => {
      if (d && !existingStandouts.includes(d) && existingStandouts.length < 2) existingStandouts.push(d);
    });
    setStandoutDishes(existingStandouts);
    setOrderedDishes(editingLog.dishes?.filter((d) => d.trim().length > 0) ?? []);
    setDishInput('');
    setVibeTags(editingLog.vibeTags ?? []);
    setTaggedUserNames((editingLog.taggedUsers ?? []).map((t) => t.userName));
    setPhotos(editingLog.photo_url ? [editingLog.photo_url] : []);
    setPrimaryIndex(editingLog.photo_url ? 0 : null);
    setRestaurantInputFocused(false);
    setFallbackSuggestions([]);
  }, [editingLog, isEditMode]);

  // ── Re-visit detection: pre-fill from canonical restaurant_log ────────────
  useEffect(() => {
    if (isEditMode) return;
    const rid = selectedRestaurant?.restaurantId ?? prefilledRestaurant?.restaurantId;
    if (!rid) {
      setRevisitCount(0);
      return;
    }
    const rl = getRestaurantLog(rid);
    if (!rl) {
      setRevisitCount(0);
      return;
    }
    setRevisitCount(rl.visitCount);
    // Pre-fill rating from their last canonical rating
    setOverallScore(rl.rating);
    if (rl.standoutDish) setStandoutDishes([rl.standoutDish]);
    if (rl.tags && rl.tags.length > 0) setVibeTags(rl.tags);
  }, [selectedRestaurant, prefilledRestaurant, isEditMode, getRestaurantLog]);

  useEffect(() => {
    if (restaurantInputFocused && !restaurantQuery.trim() && !selectedRestaurant) {
      setFallbackSuggestions(dynamicSuggestions);
    } else {
      setFallbackSuggestions([]);
    }
  }, [restaurantInputFocused, restaurantQuery, selectedRestaurant]);

  useEffect(() => {
    return () => {
      if (blurDelayRef.current) clearTimeout(blurDelayRef.current);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (selectedRestaurant || restaurantQuery.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      setAutocompleteError(null);
      try {
        const list = await fetchAutocomplete(restaurantQuery.trim(), userCoords);
        setSuggestions(list);
      } catch {
        setSuggestions([]);
        setAutocompleteError(
          "Search unavailable. Start the backend (npm run dev in server/) and, on a physical device, set EXPO_PUBLIC_API_URL to your computer's IP (e.g. http://192.168.1.5:4000) in a .env file, then restart Expo.",
        );
      } finally {
        setLoading(false);
        debounceRef.current = null;
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [restaurantQuery, selectedRestaurant]);

  const pickPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });

    if (!result.canceled) {
      const uris = result.assets.map((asset) => asset.uri);
      setPhotos((previous) => {
        const next = [...previous, ...uris];
        if (primaryIndex === null && next.length > 0) setPrimaryIndex(0);
        return next;
      });
    }
  };

  const addOrderedDish = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setOrderedDishes((prev) => {
      if (prev.some((d) => d.toLowerCase() === trimmed.toLowerCase())) return prev;
      return [...prev, trimmed];
    });
    setDishInput('');
  };

  const removeOrderedDish = (name: string) => {
    setOrderedDishes((prev) => prev.filter((d) => d !== name));
  };

  const toggleVibe = (value: VibeTag) => {
    setVibeTags((previous) =>
      previous.includes(value) ? previous.filter((item) => item !== value) : previous.length < 3 ? [...previous, value] : previous,
    );
  };

  const primaryPhotoUri =
    photos.length > 0 ? photos[Math.max(0, primaryIndex ?? 0)] ?? photos[0] : undefined;

  const handleSave = async () => {
    const trimmedName = restaurantQuery.trim();
    if (!trimmedName) return;

    const restaurantId =
      selectedRestaurant?.restaurantId ??
      prefilledRestaurant?.restaurantId ??
      editingLog?.restaurantId ??
      `custom-${Date.now()}`;
    const restaurantSeed = RESTAURANTS.find((restaurant) => restaurant.id === restaurantId);
    const cuisine = restaurantSeed?.cuisine ?? selectedRestaurant?.cuisine ?? prefilledRestaurant?.cuisine ?? editingLog?.cuisine ?? '';
    const neighborhood =
      restaurantSeed?.neighborhood ?? selectedRestaurant?.neighborhood ?? prefilledRestaurant?.neighborhood ?? editingLog?.neighborhood;
    const city =
      restaurantSeed?.city ?? prefilledRestaurant?.city ?? editingLog?.city ?? undefined;
    const state = restaurantSeed?.state ?? prefilledRestaurant?.state ?? editingLog?.state;
    const address = selectedRestaurant?.address ?? prefilledRestaurant?.address ?? editingLog?.address;
    const standoutDish = standoutDishes.length > 0 ? standoutDishes[0] : undefined;

    let previewPhotoUrl = primaryPhotoUri ?? editingLog?.previewPhotoUrl ?? (() => {
      const candidateUrl = selectedRestaurant?.displayImageUrl ?? selectedRestaurant?.fallbackPhotoUrl;
      if (!candidateUrl) return undefined;
      if (candidateUrl.startsWith('http')) return candidateUrl;
      const base = (apiClient.defaults.baseURL || '').replace(/\/$/, '');
      return base ? `${base}${candidateUrl.startsWith('/') ? candidateUrl : `/${candidateUrl}`}` : candidateUrl;
    })();
    if (!previewPhotoUrl && restaurantId && !restaurantId.startsWith('custom-')) {
      const detail = await getRestaurantDetail(restaurantId);
      const raw = detail?.displayImageUrl ?? detail?.imageUrl;
      if (raw) {
        previewPhotoUrl = raw.startsWith('http')
          ? raw
          : `${(apiClient.defaults.baseURL || '').replace(/\/$/, '')}${raw.startsWith('/') ? raw : `/${raw}`}`;
      }
    }

    const payload = {
      userName: 'You',
      restaurantId,
      restaurantName: selectedRestaurant?.name ?? prefilledRestaurant?.name ?? trimmedName,
      cuisine,
      neighborhood: neighborhood ?? undefined,
      city: city ?? undefined,
      state: state ?? undefined,
      address,
      rating: overallScore,
      note: caption.trim() || undefined,
      dishHighlight: standoutDish,
      photoUris: photos,
      primaryPhotoIndex: primaryIndex,
      previewPhotoUrl,
      highlight: undefined,
      dishes: orderedDishes.length > 0 ? orderedDishes : standoutDishes.length > 0 ? standoutDishes : undefined,
      standoutDishes: standoutDishes.length > 0 ? standoutDishes : undefined,
      vibeTags: vibeTags.length > 0 ? vibeTags : undefined,
      quickTip: quickTip.trim() || undefined,
      bestTime: bestTime || undefined,
      taggedUserNames: taggedUserNames.length > 0 ? taggedUserNames : undefined,
    };

    if (isEditMode && editingLog) {
      updateLog(editingLog.id, payload);
    } else {
      addLog(payload);
      resetForm();
    }

    router.back();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
        <Text style={styles.title}>{isEditMode ? 'Edit your visit' : 'Log a visit'}</Text>
        <Text style={styles.subtitle}>
          {isEditMode
            ? 'Give the review a little more personality.'
            : 'Only the restaurant is required — add as much or as little as you like.'}
        </Text>

        {searchHealth === null ? (
          <View style={styles.setupBanner}>
            <Ionicons name="warning-outline" size={18} color={colors.textMuted} />
            <Text style={styles.setupBannerText}>
              Start the backend: run <Text style={styles.setupBannerCode}>npm run dev</Text> in{' '}
              <Text style={styles.setupBannerCode}>server/</Text>. On a physical device, add{' '}
              <Text style={styles.setupBannerCode}>EXPO_PUBLIC_API_URL=http://YOUR_IP:4000</Text> to a{' '}
              <Text style={styles.setupBannerCode}>.env</Text> in the project root and restart Expo.
            </Text>
          </View>
        ) : searchHealth && !searchHealth.googleConfigured ? (
          <View style={styles.setupBanner}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
            <Text style={styles.setupBannerText}>
              Real search: add <Text style={styles.setupBannerCode}>GOOGLE_PLACES_API_KEY</Text> to{' '}
              <Text style={styles.setupBannerCode}>server/.env</Text> and enable &quot;Places API&quot; in Google Cloud Console. See <Text style={styles.setupBannerCode}>server/.env.example</Text>.
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Where did you go?</Text>
            <Text style={styles.requiredTag}>Required</Text>
          </View>
          <View
            style={[
              styles.restaurantInputWrap,
              selectedRestaurant && restaurantQuery.trim().toLowerCase() === selectedRestaurant.name.toLowerCase() && styles.restaurantInputWrapSelected,
            ]}
          >
            <TextInput
              value={restaurantQuery}
              onChangeText={(text) => {
                setRestaurantQuery(text);
                if (selectedRestaurant && text.trim().toLowerCase() !== selectedRestaurant.name.toLowerCase()) {
                  setSelectedRestaurant(null);
                }
                if (text.trim()) setFallbackSuggestions([]);
                else if (restaurantInputFocused) setFallbackSuggestions(dynamicSuggestions);
              }}
              onFocus={() => {
                if (blurDelayRef.current) {
                  clearTimeout(blurDelayRef.current);
                  blurDelayRef.current = null;
                }
                setRestaurantInputFocused(true);
              }}
              onBlur={() => {
                blurDelayRef.current = setTimeout(() => {
                  setRestaurantInputFocused(false);
                  blurDelayRef.current = null;
                }, 400);
              }}
              placeholder="Search or type a restaurant"
              style={[styles.input, styles.restaurantInputInner]}
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
            />
            {selectedRestaurant && restaurantQuery.trim().toLowerCase() === selectedRestaurant.name.toLowerCase() ? (
              <View style={styles.restaurantSelectedBadge}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                <Text style={styles.restaurantSelectedText}>Selected</Text>
              </View>
            ) : null}
          </View>
          {autocompleteError ? <Text style={styles.errorText}>{autocompleteError}</Text> : null}
          {(loading ||
            suggestions.length > 0 ||
            (restaurantInputFocused &&
              !restaurantQuery.trim() &&
              !selectedRestaurant &&
              fallbackSuggestions.length > 0)) &&
          !autocompleteError ? (
            <View style={styles.suggestions}>
              {loading ? (
                <View style={styles.suggestionRow}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.suggestionMeta}>Searching…</Text>
                </View>
              ) : (
                (suggestions.length > 0 ? suggestions : fallbackSuggestions).map((suggestion) => {
                  const isSelected =
                    selectedRestaurant &&
                    (suggestion.placeId === selectedRestaurant.placeId ||
                      (suggestion.placeId.startsWith('mock_') &&
                        suggestion.placeId === `mock_${selectedRestaurant.restaurantId}`));

                  return (
                    <TouchableOpacity
                      key={suggestion.placeId}
                      style={[
                        styles.suggestionRow,
                        isSelected ? styles.suggestionRowSelected : undefined,
                      ]}
                      activeOpacity={0.8}
                      onPress={() => {
                        // Cancel any pending blur so the dropdown stays alive
                        if (blurDelayRef.current) {
                          clearTimeout(blurDelayRef.current);
                          blurDelayRef.current = null;
                        }
                        setRestaurantInputFocused(false);
                        setRestaurantQuery(suggestion.name);
                        setSuggestions([]);
                        setFallbackSuggestions([]);
                        setLoading(false);

                        if (suggestion.placeId.startsWith('mock_')) {
                          const id = suggestion.placeId.replace(/^mock_/, '');
                          const restaurant = RESTAURANTS.find((item) => item.id === id);
                          if (restaurant) {
                            setSelectedRestaurant({
                              restaurantId: restaurant.id,
                              placeId: suggestion.placeId,
                              name: restaurant.name,
                              address: restaurant.neighborhood ?? '',
                              googlePlaceId: restaurant.googlePlaceId ?? null,
                              displayImageUrl: restaurant.displayImageUrl ?? null,
                              fallbackPhotoUrl: restaurant.displayImageUrl ?? undefined,
                            });
                          }
                          return;
                        }

                        setSelectedRestaurant({
                          restaurantId: suggestion.placeId,
                          placeId: suggestion.placeId,
                          name: suggestion.name,
                          address: suggestion.address,
                        });
                        selectRestaurant(suggestion.placeId)
                          .then((restaurant) => setSelectedRestaurant(restaurant))
                          .catch(() => {
                            setSelectedRestaurant(null);
                          });
                      }}
                    >
                      <View style={styles.suggestionContent}>
                        <Text style={styles.suggestionName}>{suggestion.name}</Text>
                        <Text style={styles.suggestionMeta}>{suggestion.address}</Text>
                      </View>
                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.accent}
                          style={styles.suggestionCheck}
                        />
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          ) : null}
        </View>

        {/* ── 1. Rating ────────────────────────────────────────────── */}
        <View style={styles.heroSection}>
          <View style={styles.section}>
            <Text style={styles.labelMuted}>How was it overall?</Text>
            <Text style={styles.sliderValue}>{overallScore.toFixed(1)}</Text>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderBound}>0</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={10}
                step={0.5}
                value={overallScore}
                onValueChange={(v: number) => setOverallScore(Math.round(v * 2) / 2)}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.border}
                thumbTintColor={colors.accent}
              />
              <Text style={styles.sliderBound}>10</Text>
            </View>
          </View>

          {/* ── 2. Photo ──────────────────────────────────────────── */}
          <View style={styles.section}>
            <TouchableOpacity style={[styles.photoHero, primaryPhotoUri && styles.photoHeroWithImage]} onPress={pickPhotos} activeOpacity={0.86}>
              {primaryPhotoUri ? (
                <>
                  <Image source={{ uri: primaryPhotoUri }} style={styles.photoHeroImage} />
                  <View style={styles.photoHeroOverlay}>
                    <Ionicons name="camera-outline" size={18} color="#fff" />
                    <Text style={styles.photoHeroOverlayText}>Add photos</Text>
                  </View>
                </>
              ) : (
                <>
                  <Ionicons name="images-outline" size={26} color={colors.textMuted} />
                  <Text style={styles.photoHeroSubtitle}>
                    Tap to add photos
                  </Text>
                  <Text style={styles.photoHeroHint}>
                    The dish, the table, the vibe — anything goes.
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {photos.length > 0 ? (
              <>
                <Text style={styles.photoHelper}>Tap to set cover · long-press to remove</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.photoRow}
                >
                  {photos.map((uri, index) => {
                    const isPrimary = index === primaryIndex;
                    return (
                      <TouchableOpacity
                        key={`${uri}-${index}`}
                        style={[
                          styles.photoThumbWrap,
                          isPrimary && styles.photoThumbPrimary,
                        ]}
                        onPress={() => setPrimaryIndex(index)}
                        onLongPress={() => {
                          setPhotos((prev) => {
                            const next = prev.filter((_, i) => i !== index);
                            if (next.length === 0) { setPrimaryIndex(null); return next; }
                            if (primaryIndex !== null && primaryIndex >= next.length) setPrimaryIndex(next.length - 1);
                            else if (primaryIndex === index) setPrimaryIndex(0);
                            return next;
                          });
                        }}
                        activeOpacity={0.8}
                      >
                        <Image source={{ uri }} style={styles.photoThumb} />
                        {isPrimary ? (
                          <View style={styles.primaryBadge}>
                            <Text style={styles.primaryBadgeText}>Cover</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={styles.photoAddMore} onPress={pickPhotos} activeOpacity={0.8}>
                    <Ionicons name="add" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </ScrollView>
              </>
            ) : null}
          </View>

          {/* ── 3. What did you order? ─────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>What did you order?</Text>
            <Text style={styles.chipHint}>Tap the star to mark your favorites</Text>

            {/* Added dishes as chips with inline star toggle */}
            {orderedDishes.length > 0 && (
              <View style={styles.dishChipsRow}>
                {orderedDishes.map((name) => {
                  const isStandout = standoutDishes.includes(name);
                  return (
                    <View key={name} style={styles.orderedDishChipRow}>
                      <TouchableOpacity
                        style={[styles.orderedDishChip, isStandout && styles.orderedDishChipStandout]}
                        onPress={() => removeOrderedDish(name)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.orderedDishChipText}>{name}</Text>
                        <Ionicons name="close" size={14} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() =>
                          setStandoutDishes((prev) =>
                            prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name],
                          )
                        }
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={isStandout ? 'star' : 'star-outline'}
                          size={16}
                          color={isStandout ? colors.accent : colors.textFaint}
                        />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Free-text input */}
            <View style={styles.dishInputRow}>
              <TextInput
                value={dishInput}
                onChangeText={setDishInput}
                onSubmitEditing={() => addOrderedDish(dishInput)}
                placeholder="e.g. Margherita pizza"
                placeholderTextColor={colors.textFaint}
                style={styles.dishInputField}
                returnKeyType="done"
                blurOnSubmit={false}
              />
              {dishInput.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.dishAddBtn}
                  onPress={() => addOrderedDish(dishInput)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={18} color={colors.accent} />
                </TouchableOpacity>
              )}
            </View>

            {/* Personal history: dishes you've had here before */}
            {previousDishes.filter((s) => !orderedDishes.some((d) => d.toLowerCase() === s.toLowerCase())).length > 0 && (
              <View style={styles.dishQuickAddWrap}>
                <Text style={styles.dishQuickAddLabel}>You've had here before</Text>
                <View style={styles.dishChipsRow}>
                  {previousDishes
                    .filter((s) => !orderedDishes.some((d) => d.toLowerCase() === s.toLowerCase()))
                    .map((name) => (
                      <TouchableOpacity
                        key={name}
                        style={styles.dishChip}
                        onPress={() => addOrderedDish(name)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.dishChipText}>{name}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>
            )}
          </View>

          {/* ── 4. How was it? ─────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>How was it?</Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="What would you tell a friend?"
              style={[styles.input, styles.quickTakeInput]}
              multiline
            />
          </View>

          {/* ── 5. Vibe + occasion ────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>What was it like?</Text>
            <Text style={styles.chipHint}>Pick up to 3</Text>
            <View style={styles.vibeRow}>
              {VIBE_OPTIONS.map((option) => {
                const active = vibeTags.includes(option.value);
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.vibeChip, active && styles.vibeChipActive]}
                    onPress={() => toggleVibe(option.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.vibeChipText, active && styles.vibeChipTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── 6. Quick tip ──────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>Leave a tip</Text>
            <Text style={styles.chipHint}>Help others decide</Text>
            <TextInput
              value={quickTip}
              onChangeText={setQuickTip}
              placeholder="e.g. Ask for extra crispy edges"
              style={styles.input}
              maxLength={80}
            />
          </View>

          {/* ── 7. Tag friends (optional) ─────────────────────────── */}
          <View style={styles.section}>
            <FriendTagPicker
              selectedUserNames={taggedUserNames}
              onChange={setTaggedUserNames}
            />
          </View>
        </View>

        {/* ── Save button ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!restaurantQuery.trim()}
        >
          <Ionicons name="checkmark" size={18} color="#111827" style={styles.primaryButtonIcon} />
          <Text style={styles.primaryButtonText}>{isEditMode ? 'Save changes' : 'Save log'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 4, marginBottom: 16, fontSize: 13, color: colors.textMuted },
  section: { marginTop: 16 },
  heroSection: {
    marginTop: 20,
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFF4EB',
    borderWidth: 1,
    borderColor: '#F0E4D7',
    gap: 4,
  },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  labelMuted: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginBottom: 4, textAlign: 'center' as const },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  requiredTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    letterSpacing: 0.4,
  },
  chipHint: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  suggestions: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionRowSelected: {
    backgroundColor: colors.surfaceSoft,
  },
  suggestionContent: { flex: 1 },
  suggestionName: { fontSize: 14, fontWeight: '600', color: colors.text },
  suggestionMeta: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  suggestionCheck: { marginLeft: 8 },
  setupBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  setupBannerText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  setupBannerCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: colors.text,
  },
  errorText: { marginTop: 6, fontSize: 12, color: '#b91c1c' },
  restaurantInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    paddingRight: 12,
  },
  restaurantInputWrapSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceSoft,
  },
  restaurantInputInner: {
    flex: 1,
    borderWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: 'transparent',
  },
  restaurantSelectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  restaurantSelectedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    backgroundColor: colors.surfaceSoft,
    color: colors.text,
  },
  quickTakeInput: {
    minHeight: 64,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  photoHero: {
    minHeight: 148,
    borderRadius: 18,
    backgroundColor: '#f3e8dc',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 20,
    shadowColor: 'rgba(43,33,24,0.06)',
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  photoHeroWithImage: {
    aspectRatio: 4 / 3,
    minHeight: undefined,
    paddingHorizontal: 0,
  },
  photoHeroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoHeroOverlay: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(28,28,30,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  photoHeroOverlayText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  photoHeroTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  photoHeroSubtitle: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
    color: colors.text,
    textAlign: 'center',
  },
  photoHeroHint: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textFaint,
    textAlign: 'center',
  },
  photoHelper: {
    marginTop: 10,
    fontSize: 12,
    color: '#8A7060',
  },
  photoRow: { flexDirection: 'row', gap: 8, marginTop: 10, paddingRight: 8 },
  photoAddMore: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoThumbWrap: {
    position: 'relative',
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoThumbPrimary: { borderColor: colors.accent, borderWidth: 2 },
  photoThumb: { width: '100%', height: '100%' },
  primaryBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  primaryBadgeText: { fontSize: 10, fontWeight: '600', color: '#111827' },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  scoreLabel: { fontSize: 13, color: colors.textMuted },
  scoreControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    minWidth: 36,
    textAlign: 'center',
  },
  sliderValue: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.accent,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 0,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slider: {
    flex: 1,
    height: 44,
  },
  sliderBound: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    width: 18,
    textAlign: 'center',
  },
  dishChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  orderedDishChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  orderedDishChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent + '30',
  },
  orderedDishChipStandout: {
    backgroundColor: colors.accent + '22',
    borderColor: colors.accent + '55',
  },
  orderedDishChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  dishInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: 6,
  },
  dishInputField: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  dishAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dishQuickAddWrap: { marginTop: 10 },
  dishQuickAddLabel: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginBottom: 6 },
  dishChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dishChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  dishChipText: { fontSize: 13, fontWeight: '500', color: colors.text },
  dishChipTextActive: { fontWeight: '600', color: '#111827' },
  vibeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  vibeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vibeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  vibeChipText: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  vibeChipTextActive: { fontSize: 13, fontWeight: '600', color: '#111827' },
  primaryButton: {
    marginTop: 22,
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonIcon: { marginRight: 6 },
  primaryButtonText: { color: '#111827', fontSize: 16, fontWeight: '600' },
});
