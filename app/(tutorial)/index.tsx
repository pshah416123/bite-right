import { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';
import { useTutorialControls } from '~/src/context/AuthContext';

const { width: SCREEN_W } = Dimensions.get('window');

type Slide = {
  key: string;
  title: string;
  tagline?: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    title: 'Welcome to ByteRite',
    tagline: 'Your Taste, Perfected',
    body: 'Log meals you love. Discover places you’ll love. Built around your real taste, not generic ratings.',
    icon: 'restaurant',
  },
  {
    key: 'log',
    title: 'Log what you love',
    body: 'Tap the + tab to log a visit — rate dishes, add a photo, mark standouts. We learn your taste from your own logs.',
    icon: 'add-circle',
  },
  {
    key: 'friends',
    title: 'See what friends are eating',
    body: 'Your Home feed shows where the people you trust have been and what they loved. Social proof that actually matters.',
    icon: 'people',
  },
  {
    key: 'tonight',
    title: 'Plan tonight together',
    body: 'Heading out? Use Tonight to pick a spot with friends. Discover surfaces personal recommendations as you log more.',
    icon: 'sparkles',
  },
];

export default function TutorialScreen() {
  const router = useRouter();
  const { markTutorialComplete } = useTutorialControls();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finish = async () => {
    await markTutorialComplete();
    router.replace('/(tabs)');
  };

  const next = () => {
    if (isLast) return finish();
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== index) setIndex(i);
  };

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.topBar}>
        <Image source={require('../../assets/icon.png')} style={s.wordmarkIcon} />
        {!isLast ? (
          <TouchableOpacity onPress={finish} hitSlop={12}>
            <Text style={s.skip}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={s.flatlist}
        renderItem={({ item }) => (
          <View style={s.slide}>
            <View style={s.iconCircle}>
              <Ionicons name={item.icon} size={64} color={colors.accent} />
            </View>
            <Text style={s.title}>{item.title}</Text>
            {item.tagline ? <Text style={s.tagline}>{item.tagline}</Text> : null}
            <Text style={s.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={s.footer}>
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.dot, i === index && s.dotActive]} />
          ))}
        </View>
        <TouchableOpacity style={s.cta} onPress={next} activeOpacity={0.85}>
          <Text style={s.ctaText}>{isLast ? 'Get started' : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  wordmarkIcon: { width: 40, height: 40, borderRadius: 10 },
  skip: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  flatlist: { flex: 1 },
  slide: {
    width: SCREEN_W,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    fontStyle: 'italic',
    color: colors.accentText,
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 24,
  },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
