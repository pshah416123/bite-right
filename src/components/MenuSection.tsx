import React, { useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RestaurantMenu, MenuItem, MenuPhoto, MenuGroup, MenuSection as MenuSectionType } from '~/src/api/restaurants';

// ─── Menu groups: display labels + ordering ────────────────────────────────
// Order is "what someone scanning the menu wants to see first": food, then
// brunch (when present), then drinks, then dessert. Tabs only appear when a
// restaurant has 2+ groups — single-group menus render flat as before.
const GROUP_LABEL: Record<MenuGroup, string> = {
  food: 'Food',
  brunch: 'Brunch',
  cocktails: 'Cocktails',
  wine: 'Wine',
  beer: 'Beer',
  na: 'Non-Alcoholic',
  dessert: 'Dessert',
  coffee: 'Coffee & Tea',
};
const GROUP_DISPLAY_ORDER: MenuGroup[] = [
  'food', 'brunch', 'cocktails', 'wine', 'beer', 'na', 'dessert', 'coffee',
];

/** Pick the tab that best matches the current local time. Brunch wins on
 *  weekend mornings; otherwise default to food. Drinks/dessert never default —
 *  they're explicit picks, not "what should be open first." */
function pickDefaultGroup(present: Set<MenuGroup>): MenuGroup {
  const now = new Date();
  const dow = now.getDay();              // 0 = Sun, 6 = Sat
  const hour = now.getHours();
  const isWeekendMorning = (dow === 0 || dow === 6) && hour >= 8 && hour < 15;

  if (isWeekendMorning && present.has('brunch')) return 'brunch';
  if (present.has('food')) return 'food';
  // Drinks-only / dessert-only restaurant — fall back to display order.
  for (const g of GROUP_DISPLAY_ORDER) if (present.has(g)) return g;
  return 'food';
}

const { width: SW } = Dimensions.get('window');

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  vegetarian: { bg: '#E8F5E9', text: '#2E7D32' },
  vegan: { bg: '#E8F5E9', text: '#1B5E20' },
  spicy: { bg: '#FFF3E0', text: '#E65100' },
  'gluten-free': { bg: '#FFF8E1', text: '#F57F17' },
};

interface Props {
  menu: RestaurantMenu;
  restaurantName: string;
}

export function MenuTemplate({ menu, restaurantName }: Props) {
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Bucket sections by group, preserving the server-provided order within
  // each bucket. Tabs are derived from which buckets are non-empty, in
  // GROUP_DISPLAY_ORDER. The default-selected tab is time-of-day driven.
  const { tabs, sectionsByGroup, allItemCount } = useMemo(() => {
    const byGroup = new Map<MenuGroup, MenuSectionType[]>();
    let total = 0;
    for (const s of menu.sections) {
      const g: MenuGroup = (s.group as MenuGroup) || 'food';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(s);
      total += s.items.length;
    }
    const orderedTabs = GROUP_DISPLAY_ORDER.filter((g) => byGroup.has(g));
    return { tabs: orderedTabs, sectionsByGroup: byGroup, allItemCount: total };
  }, [menu.sections]);

  const presentGroups = useMemo(() => new Set(tabs), [tabs]);
  const [activeGroup, setActiveGroup] = useState<MenuGroup>(() => pickDefaultGroup(presentGroups));

  // If the menu reloads with a different set of groups (e.g. cache refresh
  // adds a wine list), re-pick a sensible default rather than keep a stale
  // tab that no longer exists.
  React.useEffect(() => {
    if (!presentGroups.has(activeGroup)) {
      setActiveGroup(pickDefaultGroup(presentGroups));
    }
  }, [presentGroups, activeGroup]);

  const hasSections = menu.sections.length > 0;
  const hasContent = hasSections;
  const showTabs = tabs.length > 1;
  const visibleSections = showTabs ? (sectionsByGroup.get(activeGroup) ?? []) : menu.sections;

  const subtitle = showTabs
    ? `${tabs.length} menus · ${allItemCount} items`
    : `${menu.sections.length} section${menu.sections.length !== 1 ? 's' : ''} · ${allItemCount} item${allItemCount !== 1 ? 's' : ''}`;

  return (
    <View style={styles.container}>
      {hasContent ? (
        <>
          <TouchableOpacity
            style={styles.headingRow}
            onPress={() => setExpanded(!expanded)}
            activeOpacity={0.7}
          >
            <View>
              <Text style={styles.heading}>Menu</Text>
              {!expanded && <Text style={styles.headingSubtitle}>{subtitle}</Text>}
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#8A7060"
            />
          </TouchableOpacity>

          {expanded ? (
            <>
              {/* Group tabs — only shown when the restaurant has 2+ groups
                  (e.g. food + drinks). Single-group menus render flat. */}
              {showTabs ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabsRow}
                  style={styles.tabsScroll}
                >
                  {tabs.map((g) => {
                    const active = g === activeGroup;
                    const count = (sectionsByGroup.get(g) ?? []).reduce(
                      (n, s) => n + s.items.length,
                      0,
                    );
                    return (
                      <TouchableOpacity
                        key={g}
                        onPress={() => setActiveGroup(g)}
                        activeOpacity={0.7}
                        style={[styles.tab, active && styles.tabActive]}
                      >
                        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                          {GROUP_LABEL[g]}
                        </Text>
                        <Text style={[styles.tabCount, active && styles.tabCountActive]}>
                          {count}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : null}

              {/* Scraped structured menu */}
              {hasSections ? (
                <View style={styles.sectionsWrap}>
                  {visibleSections.map((section, si) => (
                    <View key={si} style={styles.sectionCard}>
                      <View style={styles.sectionHeaderRow}>
                        <Text style={styles.sectionTitle}>{section.title}</Text>
                        <View style={styles.sectionDivider} />
                      </View>
                      {section.items.map((item, ii) => (
                        <MenuItemRow key={ii} item={item} isLast={ii === section.items.length - 1} />
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Photo fallback disabled — only show structured menu items */}
            </>
          ) : null}
        </>
      ) : (
        /* Empty state */
        <>
          <Text style={styles.heading}>Menu</Text>
          <View style={styles.emptyCard}>
            <Ionicons name="restaurant-outline" size={32} color="#C4BDB5" />
            <Text style={styles.emptyTitle}>Menu coming soon</Text>
            <Text style={styles.emptySubtitle}>
              We're working on getting the menu for {restaurantName}.
            </Text>
            <TouchableOpacity style={styles.suggestBtn}>
              <Text style={styles.suggestBtnText}>Suggest a menu</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Zoom modal */}
      {zoomPhoto ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setZoomPhoto(null)}>
          <Pressable style={styles.zoomBackdrop} onPress={() => setZoomPhoto(null)}>
            <Image
              source={{ uri: zoomPhoto }}
              style={styles.zoomImage}
              resizeMode="contain"
            />
            <TouchableOpacity style={styles.zoomCloseBtn} onPress={() => setZoomPhoto(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

function MenuItemRow({ item, isLast }: { item: MenuItem; isLast: boolean }) {
  return (
    <View style={[styles.itemRow, !isLast && styles.itemRowBorder]}>
      {item.photoUrl ? (
        <Image source={{ uri: item.photoUrl }} style={styles.itemThumb} resizeMode="cover" />
      ) : null}
      <View style={styles.itemContent}>
        <View style={styles.itemNameRow}>
          <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
          {item.price ? <Text style={styles.itemPrice}>{item.price}</Text> : null}
        </View>
        {item.description ? (
          <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>
        ) : null}
        {item.tags && item.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {item.tags.map((tag) => {
              const c = TAG_COLORS[tag] || { bg: '#F3F0EB', text: '#8A7060' };
              return (
                <View key={tag} style={[styles.tagPill, { backgroundColor: c.bg }]}>
                  <Text style={[styles.tagText, { color: c.text }]}>{tag}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
  },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1207',
  },
  headingSubtitle: {
    fontSize: 12,
    color: '#8A7060',
    marginTop: 2,
  },

  // Group tabs
  tabsScroll: {
    marginBottom: 14,
  },
  tabsRow: {
    gap: 8,
    paddingRight: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F3F0EB',
  },
  tabActive: {
    backgroundColor: '#1A1207',
  },
  tabLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1A1207',
    letterSpacing: -0.1,
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  tabCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A7060',
    opacity: 0.85,
  },
  tabCountActive: {
    color: '#FFFFFF',
    opacity: 0.7,
  },

  // Section cards
  sectionsWrap: {
    gap: 14,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    // subtle shadow
    shadowColor: '#111827',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionHeaderRow: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1207',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  sectionDivider: {
    height: 2.5,
    width: 36,
    backgroundColor: '#E8572A',
    borderRadius: 2,
  },

  // Menu items
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    gap: 10,
  },
  itemRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDE8E1',
  },
  itemThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#F3F0EB',
  },
  itemContent: {
    flex: 1,
  },
  itemNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1207',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E8572A',
  },
  itemDesc: {
    marginTop: 3,
    fontSize: 12,
    color: '#8A7060',
    lineHeight: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },

  // Photo fallback
  photosWrap: {
    gap: 14,
  },
  menuPhotoFull: {
    width: '100%',
    height: 280,
    borderRadius: 14,
    backgroundColor: '#EDE8E1',
  },
  photoAttribution: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '500',
    color: '#B0A69A',
    textAlign: 'right',
  },

  // Empty state
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#111827',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1207',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#8A7060',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  suggestBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#E8572A',
  },
  suggestBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Zoom modal
  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomImage: {
    width: SW - 32,
    height: SW * 1.4,
  },
  zoomCloseBtn: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
