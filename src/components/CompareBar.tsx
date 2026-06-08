/**
 * CompareBar — Floating bottom bar for guided compare selection.
 * Opens the shared SearchOverlay in compare mode for adding restaurants.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCompare } from '../context/CompareContext';
import { SearchOverlay } from './SearchOverlay';
import { colors } from '../theme/colors';

export function CompareBar() {
  const { selected, clear, openSheet, remove } = useCompare();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevCount = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);

  const count = selected.length;
  const visible = count > 0;
  const ready = count >= 2;

  useEffect(() => {
    if (visible && prevCount.current === 0) {
      slideAnim.setValue(0);
      Animated.spring(slideAnim, {
        toValue: 1,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }).start();
    } else if (!visible && prevCount.current > 0) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    prevCount.current = count;
  }, [visible, slideAnim, count]);

  if (!visible && prevCount.current === 0) return null;

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [80, 0],
  });

  return (
    <>
      <Animated.View
        style={[
          styles.wrap,
          { bottom: 76 + Math.max(insets.bottom - 12, 0) },
          { transform: [{ translateY }], opacity: slideAnim },
        ]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <View style={styles.bar}>
          {/* Selected restaurants \u2014 horizontal chip list so users can see
              exactly what's queued for compare and remove a specific one
              without nuking the entire selection via Clear. Replaces the
              old bare "{count} selected" label that hid the actual picks. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            keyboardShouldPersistTaps="handled"
          >
            {selected.map((r) => (
              <View key={r.id} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>{r.name}</Text>
                <TouchableOpacity
                  onPress={() => remove(r.id)}
                  hitSlop={6}
                  activeOpacity={0.7}
                  style={styles.chipRemove}
                  accessibilityLabel={`Remove ${r.name}`}
                >
                  <Ionicons name="close" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity onPress={clear} activeOpacity={0.7} hitSlop={8}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>

            {!ready && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setSearchOpen(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={16} color={colors.accent} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, ready && styles.actionBtnReady]}
              onPress={ready ? openSheet : () => setSearchOpen(true)}
              activeOpacity={ready ? 0.85 : 0.7}
            >
              <Text style={[styles.actionBtnText, ready && styles.actionBtnTextReady]}>
                {ready ? `Compare \u2192` : `Pick ${count === 1 ? '1' : 'one'} more`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        compareMode
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
  },
  bar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: colors.surface,
    shadowColor: 'rgba(43,33,24,0.15)',
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  chipsRow: {
    gap: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 160,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  chipRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  clearText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
  },
  actionBtnReady: {
    backgroundColor: colors.accent,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  actionBtnTextReady: {
    color: '#fff',
  },
});
