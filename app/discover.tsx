import { StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RestaurantCard } from '../src/components/RestaurantCard';
import { useDiscover } from '../src/hooks/useDiscover';
import { colors } from '../src/theme/colors';

export default function DiscoverScreen() {
  const {
    items,
    isColdStart,
    filterMode,
    setFilterMode,
    locationQuery,
    setLocationQuery,
    applyLocationQuery,
    locationPermissionDenied,
    loading,
    error,
  } = useDiscover();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>
          Cluster-based picks from the entire BiteRight community
        </Text>
      </View>
      <View style={styles.filterRow}>
        <TouchableOpacity
          onPress={() => setFilterMode('nearby')}
          style={[styles.segment, filterMode === 'nearby' && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, filterMode === 'nearby' && styles.segmentTextActive]}>
            Nearby
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFilterMode('location')}
          style={[styles.segment, filterMode === 'location' && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, filterMode === 'location' && styles.segmentTextActive]}>
            Choose location
          </Text>
        </TouchableOpacity>
      </View>
      {locationPermissionDenied && (
        <Text style={styles.locationDeniedHint}>
          Location access denied. Enter a city or neighborhood below.
        </Text>
      )}
      {filterMode === 'location' && (
        <View style={styles.locationInputRow}>
          <TextInput
            style={styles.locationInput}
            placeholder="City, neighborhood, or zip"
            placeholderTextColor={colors.textMuted}
            value={locationQuery}
            onChangeText={setLocationQuery}
          />
          <TouchableOpacity onPress={applyLocationQuery} style={styles.applyBtn}>
            <Text style={styles.applyBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>
      )}
      {isColdStart ? (
        <View style={styles.coldStartCard}>
          <Text style={styles.coldTitle}>We’re just getting to know you</Text>
          <Text style={styles.coldBody}>
            These recommendations come from diners with strong opinions nearby. As you log more
            visits, Discover will sharpen to your exact taste.
          </Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.restaurant.id}
        renderItem={({ item }) => <RestaurantCard item={item} />}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
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
  coldStartCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  coldTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  coldBody: {
    fontSize: 13,
    color: colors.textMuted,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 10,
    gap: 8,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: '#111827',
  },
  locationDeniedHint: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  locationInputRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  locationInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  applyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
  },
  applyBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  errorText: {
    fontSize: 13,
    color: '#b91c1c',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
});

