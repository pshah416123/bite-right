import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { apiClient } from '~/src/api/client';
import { colors } from '~/src/theme/colors';
import { useTonightSession } from '~/src/context/TonightContext';
import {
  getSessionState,
  updateSessionSettings,
  nominateRestaurant,
  removeNominatedRestaurant,
  startSession,
  type NominatedRestaurant,
  type ParticipantProgress,
} from '~/src/api/tonight';

// ── Config ───────────────────────────────────────────────────────────────────

const FEELING_OPTIONS = [
  { label: 'Surprise us', value: null, emoji: '🎲' },
  { label: 'Ramen', value: 'Ramen', emoji: '🍜' },
  { label: 'Pizza', value: 'Pizza', emoji: '🍕' },
  { label: 'Sushi', value: 'Sushi', emoji: '🍣' },
  { label: 'Mexican', value: 'Mexican', emoji: '🌮' },
  { label: 'Indian', value: 'Indian', emoji: '🍛' },
  { label: 'Thai', value: 'Thai', emoji: '🥘' },
  { label: 'American', value: 'American', emoji: '🍔' },
  { label: 'Italian', value: 'Italian', emoji: '🍝' },
  { label: 'BBQ', value: 'BBQ', emoji: '🔥' },
] as const;

const PRICE_CHIPS: { label: string; value: number }[] = [
  { label: '$', value: 1 },
  { label: '$$', value: 2 },
  { label: '$$$', value: 3 },
  { label: '$$$$', value: 4 },
];

const DEADLINE_OPTIONS = [
  { label: '1 hour', value: '1h' },
  { label: '2 hours', value: '2h' },
  { label: 'Tonight', value: 'tonight' },
] as const;

const POLL_INTERVAL = 3000;

type GeoSuggestion = { label: string; lat: number; lng: number };

// ── Screen ───────────────────────────────────────────────────────────────────

export default function TonightSetupScreen() {
  const { session } = useTonightSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Two-step flow
  const [step, setStep] = useState<1 | 2>(1);

  // Settings state
  const [feelings, setFeelings] = useState<string[]>([]);
  const [location, setLocation] = useState<string | null>(null);
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [searchRadius, setSearchRadius] = useState<number>(3);
  const [priceRange, setPriceRange] = useState<number[]>([2]);
  const [deckSize, setDeckSize] = useState<10 | 15 | 20>(10);
  const [deadline, setDeadline] = useState<string | null>('2h');
  const [nominated, setNominated] = useState<NominatedRestaurant[]>([]);

  // Participants
  const [participants, setParticipants] = useState<ParticipantProgress[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const isHostRef = useRef(false);
  const initialLoadDone = useRef(false);

  // Track fields the host has locally modified — polls must not overwrite these
  const dirtyFields = useRef<Set<string>>(new Set());

  // Location autocomplete
  const [locationInput, setLocationInput] = useState('');
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [geoSuggestions, setGeoSuggestions] = useState<GeoSuggestion[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const geoCacheRef = useRef<Record<string, GeoSuggestion[]>>({});
  const geoReqIdRef = useRef(0);

  // Restaurant search for nominations
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ placeId: string; name: string; address: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchReqIdRef = useRef(0);

  // UI state
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);

  const code = session?.code;
  const participantId = session?.participantId;

  // ── Poll session state ─────────────────────────────────────────────────────

  const pollFailCount = useRef(0);
  const sessionGoneRef = useRef(false);

  const fetchState = useCallback(async () => {
    if (!code || sessionGoneRef.current) return;
    try {
      const state = await getSessionState(code);
      pollFailCount.current = 0; // reset on success
      setParticipants(state.participants);
      setParticipantCount(state.participantCount);

      const host =
        state.hostParticipantId === participantId ||
        state.participants[0]?.participantId === participantId;
      setIsHost(host);
      isHostRef.current = host;

      setNominated(state.settings.nominatedRestaurants);

      if (state.started) {
        router.navigate('/(tabs)/tonight/swipe');
        return;
      }

      // First load: hydrate everything. After that, non-hosts get all updates,
      // but hosts only get updates for fields they haven't locally modified.
      const firstLoad = !initialLoadDone.current;
      const shouldHydrate = firstLoad || !host;
      if (shouldHydrate) {
        const dirty = dirtyFields.current;
        if (firstLoad || !dirty.has('location')) {
          setLocation(state.settings.location);
          setLocationInput(state.settings.location ?? '');
          setLocationLat(state.settings.locationLat ?? null);
          setLocationLng(state.settings.locationLng ?? null);
        }
        if (firstLoad || !dirty.has('searchRadius')) {
          setSearchRadius(state.settings.searchRadius ?? 3);
        }
        if (firstLoad || !dirty.has('priceRange')) {
          const pr = state.settings.priceRange;
          setPriceRange(pr.length > 0 ? pr : [2]);
        }
        if (firstLoad || !dirty.has('deckSize')) {
          setDeckSize(state.settings.deckSize as 10 | 15 | 20);
        }
        if (firstLoad || !dirty.has('cuisines')) {
          setFeelings(state.settings.cuisines ?? []);
        }
        if (firstLoad || !dirty.has('deadline')) {
          setDeadline(state.settings.deadline ?? '2h');
        }
        initialLoadDone.current = true;
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || status === 410) {
        pollFailCount.current += 1;
        // Only show expired after 3 consecutive failures (handles transient server restarts)
        if (pollFailCount.current >= 3 && !sessionGoneRef.current) {
          sessionGoneRef.current = true;
          Alert.alert('Session expired', 'This session is no longer available. Please create a new one.', [
            { text: 'OK', onPress: () => router.navigate('/(tabs)/tonight') },
          ]);
        }
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [code, participantId, router]);

  useEffect(() => {
    if (!code) {
      router.navigate('/(tabs)/tonight');
      return;
    }
    fetchState();
    const id = setInterval(fetchState, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [code, fetchState, router]);

  // ── Location autocomplete ──────────────────────────────────────────────────

  useEffect(() => {
    if (!locationDropdownOpen) return;
    const q = locationInput.trim();
    if (!q) {
      setGeoSuggestions([]);
      setGeoLoading(false);
      return;
    }
    const key = q.toLowerCase();
    const cached = geoCacheRef.current[key];
    if (cached) {
      setGeoSuggestions(cached);
      setGeoLoading(false);
      return;
    }
    setGeoLoading(true);
    const reqId = ++geoReqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get<{ results: GeoSuggestion[] }>('/api/geo/autocomplete', {
          params: { query: q },
        });
        if (geoReqIdRef.current !== reqId) return;
        const results = Array.isArray(data?.results) ? data.results : [];
        geoCacheRef.current[key] = results;
        setGeoSuggestions(results);
      } catch {
        if (geoReqIdRef.current !== reqId) return;
        setGeoSuggestions([]);
      } finally {
        if (geoReqIdRef.current !== reqId) return;
        setGeoLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [locationDropdownOpen, locationInput]);

  const selectLocation = (g: GeoSuggestion) => {
    setLocation(g.label);
    setLocationInput(g.label);
    setLocationLat(g.lat);
    setLocationLng(g.lng);
    setLocationDropdownOpen(false);
    pushSetting('location', { location: g.label, locationLat: g.lat, locationLng: g.lng });
  };

  // ── Settings handlers ──────────────────────────────────────────────────────

  /** Mark a field dirty (host-only, prevents poll overwrite) then push to server. */
  const pushSetting = (field: string, payload: Partial<Record<string, unknown>>) => {
    dirtyFields.current.add(field);
    if (code) {
      updateSessionSettings(code, payload as any).then(() => {
        // PUT succeeded — server is in sync, safe to clear dirty flag
        dirtyFields.current.delete(field);
      }).catch(() => {
        // PUT failed — keep dirty so polls don't overwrite with stale data
      });
    }
  };

  const toggleFeeling = (value: string | null) => {
    if (value === null) {
        setFeelings([]);
      pushSetting('cuisines', { cuisines: [] });
      return;
    }
    const next = feelings.includes(value)
      ? feelings.filter((f) => f !== value)
      : [...feelings, value];
    setFeelings(next);
    pushSetting('cuisines', { cuisines: next });
  };

  const selectSearchRadius = (val: number) => {
    setSearchRadius(val);
    pushSetting('searchRadius', { searchRadius: val });
  };

  const togglePrice = (val: number) => {
    const next = priceRange.includes(val)
      ? priceRange.filter((v) => v !== val)
      : [...priceRange, val];
    setPriceRange(next);
    pushSetting('priceRange', { priceRange: next });
  };

  const selectDeadline = (val: string) => {
    setDeadline(val);
    pushSetting('deadline', { deadline: val });
  };

  // ── Restaurant search for nominations ──────────────────────────────────────

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const reqId = ++searchReqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get('/api/restaurants/autocomplete', {
          params: { query: q },
        });
        if (searchReqIdRef.current !== reqId) return;
        setSearchResults(Array.isArray(data) ? data : []);
      } catch {
        if (searchReqIdRef.current !== reqId) return;
        setSearchResults([]);
      } finally {
        if (searchReqIdRef.current !== reqId) return;
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleNominate = async (r: { placeId: string; name: string; address: string }) => {
    if (!code) return;
    if (nominated.length >= 15) {
      Alert.alert(
        'Limit reached',
        'You can nominate up to 15 restaurants. Remove one to add another.',
      );
      return;
    }
    try {
      const res = await nominateRestaurant(code, {
        restaurantId: r.placeId,
        name: r.name,
        address: r.address,
        participantId: participantId ?? undefined,
      });
      setNominated(res.nominated);
      setSearchQuery('');
      setSearchResults([]);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Could not add restaurant';
      Alert.alert('Error', msg);
    }
  };

  const handleRemoveNomination = async (restaurantId: string) => {
    if (!code) return;
    try {
      const res = await removeNominatedRestaurant(code, restaurantId);
      setNominated(res.nominated);
    } catch {
      Alert.alert('Error', 'Could not remove restaurant');
    }
  };

  // ── Start session ──────────────────────────────────────────────────────────

  const handleStart = async () => {
    if (!code) return;
    if (!location) {
      Alert.alert('Location required', 'Go back and pick a location first.');
      return;
    }
    setStarting(true);
    try {
      await startSession(code);
      router.navigate('/(tabs)/tonight/swipe');
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Failed to start session';
      Alert.alert('Error', msg);
    } finally {
      setStarting(false);
    }
  };

  const handleCopyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Alert.alert('Copied', 'Session code copied to clipboard.');
  };

  const handleShareCode = () => {
    if (!code) return;
    Share.share({ message: `Join my BiteRight session! Code: ${code}\n\nbiteright://tonight/join?code=${code}` }).catch(() => {});
  };

  const handleNext = () => {
    if (!location) {
      Alert.alert('Location required', 'Pick a city or neighborhood before continuing.');
      return;
    }
    setStep(2);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!session) return null;

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={s.helperText}>Loading session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── STEP 1: "Let's go" ─────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.navigate('/(tabs)/tonight')} style={s.backBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.accent} />
              <Text style={s.backText}>Tonight</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scrollBody}
            contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 100 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Step indicator */}
            <View style={s.stepRow}>
              <View style={[s.stepDot, s.stepDotActive]} />
              <View style={s.stepLine} />
              <View style={s.stepDot} />
            </View>

            {/* Title */}
            <Text style={s.pageTitle}>Let's go</Text>
            <Text style={s.pageSubtitle}>Get your group together</Text>

            {/* Session code card */}
            <View style={s.codeCard}>
              <Text style={s.codeCardLabel}>Session Code</Text>
              <Text style={s.codeCardValue}>{code}</Text>
              <Text style={s.codeCardHint}>Share this code with your group</Text>
              <View style={s.codeActions}>
                <TouchableOpacity style={s.codeActionBtn} onPress={handleCopyCode} activeOpacity={0.8}>
                  <Ionicons name="copy-outline" size={16} color={colors.accent} />
                  <Text style={s.codeActionText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.codeActionBtn} onPress={handleShareCode} activeOpacity={0.8}>
                  <Ionicons name="share-outline" size={16} color={colors.accent} />
                  <Text style={s.codeActionText}>Share</Text>
                </TouchableOpacity>
              </View>
              <View style={s.participantsRow}>
                {participants.map((p, i) => (
                  <View key={p.participantId} style={s.participantChip}>
                    <View style={[s.participantDot, i === 0 && s.hostDot]} />
                    <Text style={s.participantName} numberOfLines={1}>
                      {p.displayName}{i === 0 ? ' (host)' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* We're feeling... */}
            <Text style={s.sectionLabel}>We're feeling...</Text>
            <View style={s.feelingContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.feelingScroll}
              >
                {FEELING_OPTIONS.map((opt) => {
                  const active = opt.value === null
                    ? feelings.length === 0
                    : feelings.includes(opt.value);
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={[s.feelingChip, active && s.feelingChipActive]}
                      onPress={() => toggleFeeling(opt.value)}
                      activeOpacity={0.8}
                    >
                      <Text style={s.feelingEmoji}>{opt.emoji}</Text>
                      <Text style={[s.feelingText, active && s.feelingTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <LinearGradient
                colors={['rgba(255,247,237,0)', 'rgba(255,247,237,1)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.feelingFade}
                pointerEvents="none"
              />
            </View>

            {/* Location */}
            <Text style={s.sectionLabel}>Location <Text style={s.required}>*</Text></Text>
            <View style={[s.inputCard, !location && s.inputCardEmpty]}>
              <Ionicons name="location-outline" size={18} color={location ? colors.accent : colors.textMuted} />
              <TextInput
                style={s.inputText}
                placeholder="Search city or neighborhood…"
                placeholderTextColor="#B0A090"
                value={locationInput}
                onChangeText={(text) => {
                  setLocationInput(text);
                  setLocation(null);
                  if (!locationDropdownOpen) setLocationDropdownOpen(true);
                }}
                onFocus={() => setLocationDropdownOpen(true)}
                onBlur={() => setTimeout(() => setLocationDropdownOpen(false), 150)}
                returnKeyType="done"
              />
              {location && <Ionicons name="checkmark-circle" size={18} color="#22c55e" />}
            </View>
            {locationDropdownOpen && locationInput.trim().length > 0 && (
              <View style={s.dropdown}>
                {geoLoading ? (
                  <View style={s.dropdownEmpty}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={s.dropdownEmptyText}>Searching…</Text>
                  </View>
                ) : geoSuggestions.length === 0 ? (
                  <View style={s.dropdownEmpty}>
                    <Text style={s.dropdownEmptyText}>No locations found</Text>
                  </View>
                ) : (
                  geoSuggestions.map((g, i) => (
                    <TouchableOpacity
                      key={g.label}
                      style={[s.dropdownRow, i === geoSuggestions.length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => selectLocation(g)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="location" size={14} color={colors.accent} style={{ marginRight: 10 }} />
                      <Text style={s.dropdownRowText} numberOfLines={1}>{g.label}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Bottom: Next button */}
          <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity
              style={[s.nextBtn, !location && s.nextBtnDisabled]}
              onPress={handleNext}
              disabled={!location}
              activeOpacity={0.85}
            >
              <Text style={s.nextBtnText}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── STEP 2: "Set the rules" ────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => setStep(1)} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.accent} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={s.scrollBody}
          contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Step indicator */}
          <View style={s.stepRow}>
            <View style={[s.stepDot, s.stepDotDone]} />
            <View style={[s.stepLine, s.stepLineDone]} />
            <View style={[s.stepDot, s.stepDotActive]} />
          </View>

          {/* Title */}
          <Text style={s.pageTitle}>Set up your group</Text>
          <Text style={s.pageSubtitle}>Invite friends and find a spot everyone likes.</Text>

          {/* Search Radius */}
          <Text style={s.sectionLabel}>Search Radius</Text>
          <View style={s.chipsRow}>
            {[1, 3, 5, 10].map((mi) => {
              const active = searchRadius === mi;
              return (
                <TouchableOpacity
                  key={mi}
                  style={[s.ruleChip, active && s.ruleChipActive]}
                  onPress={() => selectSearchRadius(mi)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.ruleChipText, active && s.ruleChipTextActive]}>{mi} mi</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Price Range */}
          <Text style={s.sectionLabel}>Price Range</Text>
          <View style={s.chipsRow}>
            {PRICE_CHIPS.map(({ label, value }) => {
              const active = priceRange.includes(value);
              return (
                <TouchableOpacity
                  key={label}
                  style={[s.ruleChip, active && s.ruleChipActive]}
                  onPress={() => togglePrice(value)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.ruleChipText, active && s.ruleChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Add must-haves (formerly Nominated Restaurants) */}
          <Text style={s.sectionLabel}>Add must-haves</Text>
          <Text style={s.sectionHint}>
            Add specific places you want in the swipe pool ({nominated.length}/15)
          </Text>

          <View style={s.inputCard}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={s.inputText}
              placeholder="Search restaurants to add…"
              placeholderTextColor="#B0A090"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchLoading && <ActivityIndicator size="small" color={colors.accent} />}
          </View>

          {searchResults.length > 0 && (
            <View style={s.dropdown}>
              {searchResults.map((r, i) => {
                const alreadyNominated = nominated.some((n) => n.restaurantId === r.placeId);
                return (
                  <TouchableOpacity
                    key={r.placeId}
                    style={[s.dropdownRow, i === searchResults.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => !alreadyNominated && handleNominate(r)}
                    activeOpacity={alreadyNominated ? 1 : 0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.dropdownRowText} numberOfLines={1}>{r.name}</Text>
                      <Text style={s.dropdownRowSub} numberOfLines={1}>{r.address}</Text>
                    </View>
                    {alreadyNominated ? (
                      <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                    ) : (
                      <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {nominated.length > 0 && (
            <View style={s.nominatedList}>
              {nominated.map((n, i) => (
                <View key={n.restaurantId} style={[s.nominatedCard, i === nominated.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={s.nominatedIcon}>
                    <Ionicons name="restaurant-outline" size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.nominatedName} numberOfLines={1}>{n.name}</Text>
                    {n.address ? <Text style={s.nominatedAddr} numberOfLines={1}>{n.address}</Text> : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveNomination(n.restaurantId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={s.removeBtn}
                  >
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Bottom CTA — host: Start, member: waiting */}
        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {isHost || participantCount <= 1 ? (
            <TouchableOpacity
              style={s.startBtn}
              onPress={handleStart}
              disabled={starting}
              activeOpacity={0.85}
            >
              {starting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="flame" size={18} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={s.startBtnText}>
                    Start group swipe{participantCount > 1 ? ` · ${participantCount} members` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={s.waitingBar}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={s.waitingBarText}>Waiting for host to start…</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  helperText: { marginTop: 8, fontSize: 13, color: colors.textMuted },

  // Header
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 16, fontWeight: '600', color: colors.accent },

  // Step indicator
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    marginBottom: 16,
    marginTop: 4,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.accent,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stepDotDone: {
    backgroundColor: '#22c55e',
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: 6,
  },
  stepLineDone: {
    backgroundColor: '#22c55e',
  },

  // Page title
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },

  // Scroll
  scrollBody: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },

  // Session code card
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#111827',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  codeCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  codeCardValue: {
    fontSize: 36,
    fontWeight: '900',
    color: colors.accent,
    letterSpacing: 6,
  },
  codeCardHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  codeActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  codeActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(249,115,22,0.08)',
  },
  codeActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  participantsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    width: '100%',
  },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  participantDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textMuted },
  hostDot: { backgroundColor: colors.accent },
  participantName: { fontSize: 12, fontWeight: '600', color: colors.text, maxWidth: 100 },

  // Sections
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 24,
    marginBottom: 10,
  },
  required: {
    color: colors.accent,
    fontWeight: '700',
  },
  sectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: -6,
    marginBottom: 10,
  },

  // "We're feeling..." horizontal scroll
  feelingContainer: { position: 'relative' },
  feelingScroll: { gap: 8, paddingRight: 40 },
  feelingFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 40,
  },
  feelingChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    minWidth: 72,
  },
  feelingChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  feelingEmoji: { fontSize: 22, marginBottom: 4 },
  feelingText: { fontSize: 12, fontWeight: '600', color: colors.text },
  feelingTextActive: { color: '#fff' },

  // Shared input card
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  inputCardEmpty: {
    borderColor: '#E4E2E7',
  },
  inputText: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 13 },

  // Dropdown
  dropdown: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    marginTop: 6,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: 'hidden',
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dropdownRowText: { fontSize: 14, fontWeight: '600', color: colors.text },
  dropdownRowSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  dropdownEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  dropdownEmptyText: { fontSize: 13, color: colors.textMuted },

  // Step 2: rule chips — compact, pill-shaped (matches Discover cuisine chips)
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ruleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: '#E4E2E7',
  },
  ruleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  ruleChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  ruleChipTextActive: { color: '#fff' },

  // Nominated list
  nominatedList: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  nominatedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  nominatedIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(249,115,22,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  nominatedName: { fontSize: 14, fontWeight: '600', color: colors.text },
  nominatedAddr: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  nextBtn: {
    flexDirection: 'row',
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnDisabled: {
    opacity: 0.5,
  },
  nextBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  startBtn: {
    flexDirection: 'row',
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  waitingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    backgroundColor: 'rgba(249,115,22,0.06)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.15)',
  },
  waitingBarText: { fontSize: 14, fontWeight: '600', color: colors.accent },
});
