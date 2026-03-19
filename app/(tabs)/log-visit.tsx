import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '~/src/theme/colors';
import {
  fetchAutocomplete,
  getSearchHealth,
  getRestaurantDetail,
  getSampleSuggestions,
  selectRestaurant,
  type AutocompleteSuggestion,
  type SearchHealth,
  type SelectedRestaurant,
} from '~/src/api/restaurants';
import { apiClient } from '~/src/api/client';
import { RESTAURANTS } from '~/src/data/restaurants';
import { useFeedContext } from '~/src/context/FeedContext';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import type { VibeTag } from '~/src/components/FeedCard';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const SCORE_MIN = 0;
const SCORE_MAX = 10;
const SCORE_STEP = 0.5;

const VIBE_OPTIONS: { value: VibeTag; label: string }[] = [
  { value: 'date_night', label: 'Date night' },
  { value: 'casual', label: 'Casual' },
  { value: 'solo_dining', label: 'Solo dining' },
  { value: 'group', label: 'Group dinner' },
  { value: 'celebration', label: 'Celebration' },
  { value: 'quick_bite', label: 'Quick bite' },
];

function clampScore(v: number): number {
  const steps = Math.round((v - SCORE_MIN) / SCORE_STEP);
  const clamped = SCORE_MIN + steps * SCORE_STEP;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, clamped));
}

function ScoreStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <View style={styles.scoreRow}>
      {label ? <Text style={styles.scoreLabel}>{label}</Text> : <View />}
      <View style={styles.scoreControls}>
        <TouchableOpacity
          style={styles.scoreBtn}
          onPress={() => onChange(clampScore(value - SCORE_STEP))}
          disabled={value <= SCORE_MIN}
        >
          <Ionicons name="remove" size={18} color={value <= SCORE_MIN ? colors.textMuted : colors.text} />
        </TouchableOpacity>
        <Text style={styles.scoreValue}>{value.toFixed(1)}</Text>
        <TouchableOpacity
          style={styles.scoreBtn}
          onPress={() => onChange(clampScore(value + SCORE_STEP))}
          disabled={value >= SCORE_MAX}
        >
          <Ionicons name="add" size={18} color={value >= SCORE_MAX ? colors.textMuted : colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function LogVisitScreen() {
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [selectedRestaurant, setSelectedRestaurant] = useState<SelectedRestaurant | null>(null);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null);
  const [overallScore, setOverallScore] = useState(7);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [caption, setCaption] = useState('');
  const [foodRating, setFoodRating] = useState<number | undefined>(undefined);
  const [serviceRating, setServiceRating] = useState<number | undefined>(undefined);
  const [ambienceRating, setAmbienceRating] = useState<number | undefined>(undefined);
  const [valueRating, setValueRating] = useState<number | undefined>(undefined);
  const [dishHighlight, setDishHighlight] = useState('');
  const [dishes, setDishes] = useState<string[]>([]);
  const [dishInput, setDishInput] = useState('');
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [primaryIndex, setPrimaryIndex] = useState<number | null>(null);
  const [searchHealth, setSearchHealth] = useState<SearchHealth | null | undefined>(undefined);
  const [restaurantInputFocused, setRestaurantInputFocused] = useState(false);
  const [fallbackSuggestions, setFallbackSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addLog } = useFeedContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ logId?: string; payload?: string }>();
  const isEditMode = !!(typeof params.logId === 'string' && params.logId.trim());
  const payloadRaw =
    typeof params.payload === 'string'
      ? params.payload
      : Array.isArray(params.payload)
        ? params.payload[0]
        : undefined;

  const prefilledRestaurant = useMemo(() => {
    if (!payloadRaw) return null;
    try {
      const parsed = JSON.parse(payloadRaw) as {
        id?: string;
        name?: string;
        cuisine?: string;
        neighborhood?: string | null;
        state?: string | null;
        placeId?: string | null;
        imageUrl?: string | null;
      };

      if (!parsed?.id || !parsed?.name) return null;

      const address = [parsed.neighborhood, parsed.state].filter(Boolean).join(', ');
      return {
        restaurantId: parsed.id,
        placeId: parsed.placeId ?? null,
        name: parsed.name,
        address: address || parsed.neighborhood || '',
        fallbackPhotoUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : undefined,
      } satisfies SelectedRestaurant;
    } catch {
      return null;
    }
  }, [payloadRaw]);

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
    setDetailsExpanded(false);
    setCaption('');
    setFoodRating(undefined);
    setServiceRating(undefined);
    setAmbienceRating(undefined);
    setValueRating(undefined);
    setDishHighlight('');
    setDishes([]);
    setDishInput('');
    setVibeTags([]);
    setPhotos([]);
    setPrimaryIndex(null);
    setRestaurantInputFocused(false);
    setFallbackSuggestions([]);
  }, []);

  // Whenever this screen is focused in create mode, start from a clean slate.
  useFocusEffect(
    useCallback(() => {
      if (!isEditMode && !payloadRaw) {
        resetForm();
      }
    }, [isEditMode, payloadRaw, resetForm]),
  );

  useEffect(() => {
    let cancelled = false;
    getSearchHealth().then((h) => {
      if (!cancelled) setSearchHealth(h ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  // If navigated here from Discover/Restaurant Detail, preselect the exact restaurant.
  useEffect(() => {
    if (!prefilledRestaurant) return;
    setRestaurantQuery(prefilledRestaurant.name);
    setSelectedRestaurant(prefilledRestaurant);
    setSuggestions([]);
    setFallbackSuggestions([]);
    setRestaurantInputFocused(false);
  }, [prefilledRestaurant]);

  // When focused and empty (no selection), show fallback suggestions
  useEffect(() => {
    if (restaurantInputFocused && !restaurantQuery.trim() && !selectedRestaurant) {
      setFallbackSuggestions(getSampleSuggestions());
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
        const list = await fetchAutocomplete(restaurantQuery.trim());
        setSuggestions(list);
      } catch (err) {
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
      const uris = result.assets.map((a) => a.uri);
      setPhotos((prev) => {
        const next = [...prev, ...uris];
        if (primaryIndex === null && next.length > 0) setPrimaryIndex(0);
        return next;
      });
    }
  };

  const addDish = () => {
    const t = dishInput.trim();
    if (t && !dishes.includes(t)) {
      setDishes((prev) => [...prev, t]);
      setDishInput('');
    }
  };

  const removeDish = (index: number) => {
    setDishes((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleVibe = (v: VibeTag) => {
    setVibeTags((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const handleSave = async () => {
    const trimmedName = restaurantQuery.trim();
    if (!trimmedName) return;

    const mockRest = selectedRestaurant
      ? RESTAURANTS.find((r) => r.id === selectedRestaurant.restaurantId)
      : null;
    const restaurantId = selectedRestaurant?.restaurantId ?? `custom-${Date.now()}`;
    const cuisine = mockRest?.cuisine ?? '';
    const neighborhood = mockRest?.neighborhood;
    const state = mockRest?.state;
    const address = selectedRestaurant?.address;
    const standoutDish = dishHighlight.trim() || (dishes.length > 0 ? dishes[0] : undefined);

    let previewPhotoUrl: string | undefined;
    if (!photos?.length && restaurantId && !restaurantId.startsWith('custom-')) {
      const detail = await getRestaurantDetail(restaurantId);
      const raw = detail?.imageUrl;
      if (raw) {
        previewPhotoUrl = raw.startsWith('http') ? raw : `${(apiClient.defaults.baseURL || '').replace(/\/$/, '')}${raw.startsWith('/') ? raw : `/${raw}`}`;
      }
    }

    addLog({
      userName: 'You',
      restaurantId,
      restaurantName: selectedRestaurant?.name ?? trimmedName,
      cuisine,
      neighborhood,
      state,
      address,
      rating: overallScore,
      note: caption.trim() || undefined,
      dishHighlight: standoutDish,
      photoUris: photos,
      primaryPhotoIndex: primaryIndex,
      previewPhotoUrl,
      foodRating: foodRating !== undefined && foodRating !== null ? foodRating : undefined,
      serviceRating: serviceRating !== undefined && serviceRating !== null ? serviceRating : undefined,
      ambienceRating: ambienceRating !== undefined && ambienceRating !== null ? ambienceRating : undefined,
      valueRating: valueRating !== undefined && valueRating !== null ? valueRating : undefined,
      dishes: dishes.length > 0 ? dishes : undefined,
      vibeTags: vibeTags.length > 0 ? vibeTags : undefined,
    });

    // On successful save, reset form so the next visit starts fresh.
    if (!isEditMode) {
      resetForm();
    }
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Log a visit</Text>
        <Text style={styles.subtitle}>Quickly capture how it was</Text>

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
          <Text style={styles.label}>Restaurant</Text>
          <View style={[styles.restaurantInputWrap, selectedRestaurant && styles.restaurantInputWrapSelected]}>
            <TextInput
              value={restaurantQuery}
              onChangeText={(text) => {
                setRestaurantQuery(text);
                setSelectedRestaurant(null);
                if (text.trim()) setFallbackSuggestions([]);
                else if (restaurantInputFocused) setFallbackSuggestions(getSampleSuggestions());
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
                }, 200);
              }}
              placeholder="Search or type a restaurant"
              style={[styles.input, styles.restaurantInputInner]}
            />
            {selectedRestaurant ? (
              <View style={styles.restaurantSelectedBadge}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                <Text style={styles.restaurantSelectedText}>Selected</Text>
              </View>
            ) : null}
          </View>
          {autocompleteError ? <Text style={styles.errorText}>{autocompleteError}</Text> : null}
          {(loading || suggestions.length > 0 || (restaurantInputFocused && !restaurantQuery.trim() && !selectedRestaurant && fallbackSuggestions.length > 0)) &&
            !autocompleteError && (
            <View style={styles.suggestions}>
              {loading ? (
                <View style={styles.suggestionRow}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.suggestionMeta}>Searching…</Text>
                </View>
              ) : (
                (suggestions.length > 0 ? suggestions : fallbackSuggestions).map((s) => {
                  const isSelected =
                    selectedRestaurant &&
                    (s.placeId === selectedRestaurant.placeId ||
                      (s.placeId.startsWith('mock_') && s.placeId === `mock_${selectedRestaurant.restaurantId}`));
                  return (
                    <TouchableOpacity
                      key={s.placeId}
                      style={[styles.suggestionRow, isSelected ? styles.suggestionRowSelected : undefined]}
                      activeOpacity={0.8}
                      onPress={() => {
                        // Immediately show selected name, close dropdown, and set optimistic selection
                        // so the autocomplete effect doesn't kick off another search (loading) while API runs
                        setRestaurantQuery(s.name);
                        setSuggestions([]);
                        setFallbackSuggestions([]);
                        setLoading(false);
                        if (s.placeId.startsWith('mock_')) {
                          const id = s.placeId.replace(/^mock_/, '');
                          const rest = RESTAURANTS.find((r) => r.id === id);
                          if (rest) {
                            setSelectedRestaurant({
                              restaurantId: rest.id,
                              placeId: s.placeId,
                              name: rest.name,
                              address: rest.neighborhood ?? '',
                              fallbackPhotoUrl: rest.samplePhotoUrl,
                            });
                          }
                          return;
                        }
                        // Optimistic selection so dropdown stays closed and effect doesn't re-run
                        setSelectedRestaurant({
                          restaurantId: s.placeId,
                          placeId: s.placeId,
                          name: s.name,
                          address: s.address,
                        });
                        selectRestaurant(s.placeId)
                          .then((restaurant) => setSelectedRestaurant(restaurant))
                          .catch(() => {
                            setSelectedRestaurant(null);
                          });
                      }}
                    >
                      <View style={styles.suggestionContent}>
                        <Text style={styles.suggestionName}>{s.name}</Text>
                        <Text style={styles.suggestionMeta}>{s.address}</Text>
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.accent} style={styles.suggestionCheck} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Overall score</Text>
          <ScoreStepper value={overallScore} onChange={setOverallScore} label="0–10" />
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!restaurantQuery.trim()}
        >
          <Ionicons name="checkmark" size={18} color="#111827" style={{ marginRight: 6 }} />
          <Text style={styles.primaryButtonText}>Save log</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.expandHeader}
          onPress={() => setDetailsExpanded((e) => !e)}
          activeOpacity={0.7}
        >
          <Text style={styles.expandTitle}>Add more details (optional)</Text>
          <Ionicons
            name={detailsExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textMuted}
          />
        </TouchableOpacity>

        {detailsExpanded && (
          <View style={styles.detailsSection}>
            <View style={styles.section}>
              <Text style={styles.label}>Standout dish</Text>
              <Text style={[styles.helper, { marginBottom: 4 }]}>
                Shows as a Standout badge on your feed above the photo.
              </Text>
              <TextInput
                value={dishHighlight}
                onChangeText={setDishHighlight}
                placeholder="e.g. Chicago-style deep dish, Goat belly & lobster"
                style={styles.input}
              />
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Caption</Text>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="What stood out? Dish, vibe, or quick takeaway."
                style={[styles.input, styles.noteInput]}
                multiline
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Food</Text>
              <ScoreStepper value={foodRating ?? overallScore} onChange={(v) => setFoodRating(v)} />
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Service</Text>
              <ScoreStepper value={serviceRating ?? overallScore} onChange={(v) => setServiceRating(v)} />
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Ambience</Text>
              <ScoreStepper value={ambienceRating ?? overallScore} onChange={(v) => setAmbienceRating(v)} />
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>Value</Text>
              <ScoreStepper value={valueRating ?? overallScore} onChange={(v) => setValueRating(v)} />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Dishes you tried</Text>
              <View style={styles.dishInputRow}>
                <TextInput
                  value={dishInput}
                  onChangeText={setDishInput}
                  placeholder="Add a dish"
                  style={[styles.input, { flex: 1 }]}
                  onSubmitEditing={addDish}
                />
                <TouchableOpacity style={styles.addDishBtn} onPress={addDish}>
                  <Ionicons name="add" size={18} color={colors.text} />
                  <Text style={styles.addDishBtnText}>Add dish</Text>
                </TouchableOpacity>
              </View>
              {dishes.length > 0 && (
                <View style={styles.dishChips}>
                  {dishes.map((d, i) => (
                    <View key={i} style={styles.dishChip}>
                      <Text style={styles.dishChipText}>{d}</Text>
                      <TouchableOpacity onPress={() => removeDish(i)} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Vibe tags</Text>
              <View style={styles.vibeRow}>
                {VIBE_OPTIONS.map((opt) => {
                  const active = vibeTags.includes(opt.value);
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.vibeChip, active && styles.vibeChipActive]}
                      onPress={() => toggleVibe(opt.value)}
                    >
                      <Text style={[styles.vibeChipText, active && styles.vibeChipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Photos</Text>
              <Text style={styles.helper}>
                Add photos. Tap a photo to choose the cover image for your feed.
              </Text>
              <View style={styles.photoRow}>
                {photos.map((uri, index) => {
                  const isPrimary = index === primaryIndex;
                  return (
                    <TouchableOpacity
                      key={uri}
                      style={[styles.photoThumbWrap, isPrimary && styles.photoThumbPrimary]}
                      onPress={() => setPrimaryIndex(index)}
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
                <TouchableOpacity style={styles.addPhoto} onPress={pickPhotos} activeOpacity={0.8}>
                  <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                  <Text style={styles.addPhotoText}>Add photos</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted, marginBottom: 16 },
  section: { marginTop: 16 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  helper: { fontSize: 13, color: colors.textMuted },
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  noteInput: { minHeight: 80, textAlignVertical: 'top' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
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
  scoreValue: { fontSize: 18, fontWeight: '700', color: colors.text, minWidth: 36, textAlign: 'center' },
  primaryButton: {
    marginTop: 24,
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#111827', fontSize: 16, fontWeight: '600' },
  expandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  expandTitle: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  detailsSection: { marginTop: 8 },
  dishInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  addDishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addDishBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  dishChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  dishChip: {
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
  dishChipText: { fontSize: 13, color: colors.text },
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
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photoThumbWrap: {
    position: 'relative',
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoThumbPrimary: { borderColor: colors.accent },
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
  addPhoto: {
    height: 72,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addPhotoText: { fontSize: 13, color: colors.textMuted },
});
