import React, { useState } from 'react';
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
import type { RestaurantMenu, MenuItem, MenuPhoto } from '~/src/api/restaurants';

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

  const hasSections = menu.sections.length > 0;
  const hasContent = hasSections;

  const itemCount = hasSections
    ? menu.sections.reduce((sum, s) => sum + s.items.length, 0)
    : 0;
  const subtitle = `${menu.sections.length} section${menu.sections.length !== 1 ? 's' : ''} · ${itemCount} item${itemCount !== 1 ? 's' : ''}`;

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
              {/* Scraped structured menu */}
              {hasSections ? (
                <View style={styles.sectionsWrap}>
                  {menu.sections.map((section, si) => (
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
