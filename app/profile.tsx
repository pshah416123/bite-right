import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useProfile } from '../src/hooks/useProfile';
import { TopRestaurantCard } from '../src/components/TopRestaurantCard';
import { SavedRestaurantCard } from '../src/components/SavedRestaurantCard';
import { colors } from '../src/theme/colors';
import {
  RESTAURANT_TYPE_LABELS,
  type RestaurantType,
} from '../src/types/profile';

const TYPE_OPTIONS: (RestaurantType | 'all')[] = [
  'all',
  'date_night',
  'casual',
  'solo_dining',
  'group',
  'quick_bite',
  'special_occasion',
];

const TYPE_CHIP_LABELS: Record<RestaurantType | 'all', string> = {
  all: 'All',
  ...RESTAURANT_TYPE_LABELS,
};

export default function ProfileScreen() {
  const {
    topRestaurants,
    savedRestaurants,
    savedLoading,
    savedError,
    typeFilter,
    setTypeFilter,
    savedLocationMode,
    setSavedLocationMode,
    customLocation,
    customSearchQuery,
    setCustomSearchQuery,
    locationSuggestions,
    locationSuggestionsLoading,
    selectCustomLocation,
    locationPermission,
  } = useProfile();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Your taste, your places</Text>
        </View>

        <TouchableOpacity style={styles.settingsRow} activeOpacity={0.7}>
          <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
          <Text style={styles.settingsRowText}>Settings</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your top restaurants</Text>
          <Text style={styles.sectionSubtitle}>Places you’ve rated highest</Text>
          {topRestaurants.map((r, i) => (
            <TopRestaurantCard key={r.id} restaurant={r} rank={i + 1} />
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Saved</Text>
          <Text style={styles.sectionSubtitle}>
            Sorted by {savedLocationMode === 'NEARBY' ? 'distance' : (customLocation?.label ?? 'location')} · tap a type to filter
          </Text>
          <View style={styles.sortRow}>
            <TouchableOpacity
              onPress={() => setSavedLocationMode('NEARBY')}
              style={[styles.sortChip, savedLocationMode === 'NEARBY' && styles.chipActive]}
            >
              <Text style={[styles.chipText, savedLocationMode === 'NEARBY' && styles.chipTextActive]}>
                Nearby
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSavedLocationMode('CUSTOM')}
              style={[styles.sortChip, savedLocationMode === 'CUSTOM' && styles.chipActive]}
            >
              <Text style={[styles.chipText, savedLocationMode === 'CUSTOM' && styles.chipTextActive]}>
                Choose location
              </Text>
            </TouchableOpacity>
          </View>
          {savedLocationMode === 'NEARBY' && locationPermission === false && (
            <View style={styles.locationPromptBox}>
              <Text style={styles.locationHint}>
                Enable location to sort Nearby, or choose a location
              </Text>
              <View style={styles.locationPromptRow}>
                <TouchableOpacity
                  onPress={() => Linking.openSettings()}
                  style={styles.locationPromptBtn}
                >
                  <Text style={styles.locationPromptBtnText}>Open settings</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSavedLocationMode('CUSTOM')}
                  style={[styles.locationPromptBtn, styles.locationPromptBtnSecondary]}
                >
                  <Text style={styles.locationPromptBtnTextSecondary}>Choose location</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {savedLocationMode === 'CUSTOM' && (
            <>
              <View style={styles.customLocationRow}>
                <TextInput
                  style={styles.customLocationInput}
                  placeholder="City, neighborhood, or zip"
                  placeholderTextColor={colors.textMuted}
                  value={customSearchQuery}
                  onChangeText={setCustomSearchQuery}
                />
                {locationSuggestionsLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} style={styles.locationSpinner} />
                ) : null}
              </View>
              {locationSuggestions.length > 0 && (
                <View style={styles.suggestionsList}>
                  {locationSuggestions.map((item, i) => (
                    <TouchableOpacity
                      key={`${item.label}-${i}`}
                      style={styles.suggestionItem}
                      onPress={() => selectCustomLocation(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.suggestionItemText} numberOfLines={2}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {customLocation && (
                <Text style={styles.customLocationLabel}>Sorting by distance from: {customLocation.label}</Text>
              )}
            </>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            {TYPE_OPTIONS.map((type) => (
              <TouchableOpacity
                key={type}
                onPress={() => setTypeFilter(type)}
                style={[styles.chip, typeFilter === type && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    typeFilter === type && styles.chipTextActive,
                  ]}
                >
                  {TYPE_CHIP_LABELS[type]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {savedError ? (
            <Text style={styles.empty}>{savedError}</Text>
          ) : savedLoading ? (
            <Text style={styles.empty}>Loading saved…</Text>
          ) : savedRestaurants.length === 0 ? (
            <Text style={styles.empty}>
              No saved places
              {typeFilter !== 'all' ? ` for "${TYPE_CHIP_LABELS[typeFilter]}"` : ''}. Save spots from Discover or Tonight.
            </Text>
          ) : (
            savedRestaurants.map((r) => (
              <SavedRestaurantCard key={r.id} restaurant={r} />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingsRowText: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    marginLeft: 10,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 8,
  },
  sortRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
  },
  locationPromptBox: {
    marginBottom: 10,
  },
  locationPromptRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  locationPromptBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  locationPromptBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationPromptBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  locationPromptBtnTextSecondary: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  customLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  customLocationInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  locationSpinner: {
    marginLeft: 4,
  },
  suggestionsList: {
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionItemText: {
    fontSize: 14,
    color: colors.text,
  },
  customLocationLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  chipScroll: {
    marginBottom: 14,
    marginHorizontal: -20,
  },
  chipRow: {
    paddingHorizontal: 20,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  chipTextActive: {
    color: '#111827',
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
