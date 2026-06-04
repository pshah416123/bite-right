/**
 * FoodAutocomplete — inline dropdown of matching dishes/drinks from
 * FOOD_CATALOG. Strictly food/drink (no restaurants, cuisines, vibes).
 *
 * Used by Discover's search bar and the log-visit dish input. Component
 * doesn't own the input — caller passes value + onChangeText and renders
 * the TextInput itself, so this can sit below any existing input.
 *
 *   const [val, setVal] = useState('');
 *   <TextInput value={val} onChangeText={setVal} />
 *   <FoodAutocomplete query={val} onPick={(food) => { setVal(food); ... }} />
 */
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { searchFoodCatalog } from '../data/foodCatalog';

type Props = {
  query: string;
  onPick: (food: string) => void;
  /** Cap the visible suggestion count. Default 6. */
  maxSuggestions?: number;
  /** Optional style override (margin etc.) */
  style?: object;
};

export function FoodAutocomplete({ query, onPick, maxSuggestions = 6, style }: Props) {
  const suggestions = searchFoodCatalog(query, maxSuggestions);
  if (suggestions.length === 0) return null;

  return (
    <View style={[s.wrap, style]}>
      <ScrollView
        keyboardShouldPersistTaps="always"
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
      >
        {suggestions.map((food) => (
          <TouchableOpacity
            key={food}
            style={s.row}
            onPress={() => onPick(food)}
            activeOpacity={0.7}
          >
            <Ionicons name="restaurant-outline" size={14} color={colors.textMuted} />
            <Text style={s.text} numberOfLines={1}>{food}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: 220,
  },
  scroll: { maxHeight: 220 },
  scrollContent: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1,
  },
});
