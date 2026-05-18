/**
 * MatchCelebration — warm peach full-screen overlay shown on right swipe.
 * Uses React Native's built-in Animated API (no reanimated dependency).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityRole,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { TonightCardModel } from './TonightCard';
import { TN } from './SwipeCard';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Confetti particles ───────────────────────────────────────────────────────

const COLORS = [TN.accent, TN.craving, '#FF3B30', '#FFA940', '#FFCF87', '#F97316'];
const COUNT = 22;

interface PDef {
  angle: number;
  dist: number;
  size: number;
  color: string;
  delay: number;
  isSquare: boolean;
}

function Particle({ angle, dist, size, color, delay, isSquare }: PDef) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(anim, { toValue: 1, duration: 620, useNativeDriver: true }),
    ]).start();
  }, []);

  const x = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist] });
  const y = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * dist - 24] });
  const opacity = anim.interpolate({ inputRange: [0, 0.62, 1], outputRange: [1, 0.9, 0] });
  const scale = anim.interpolate({ inputRange: [0, 0.38, 1], outputRange: [0, 1.25, 0.7] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: isSquare ? 3 : size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateX: x }, { translateY: y }, { scale }],
      }}
    />
  );
}

// ─── MatchCelebration ─────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  card: TonightCardModel | null;
  onDismiss: () => void;
  onViewDetails?: () => void;
}

export default function MatchCelebration({ visible, card, onDismiss, onViewDetails }: Props) {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.5);
      opacity.setValue(0);
      Animated.sequence([
        Animated.delay(120),
        Animated.parallel([
          Animated.spring(scale, {
            toValue: 1,
            damping: 13,
            stiffness: 150,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]),
      ]).start();
      const t = setTimeout(onDismiss, 2500);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const particles = useMemo<PDef[]>(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        angle: (i / COUNT) * Math.PI * 2,
        dist: 72 + ((i * 43) % 88),
        size: 6 + ((i * 11) % 9),
        color: COLORS[i % COLORS.length],
        delay: (i * 20) % 180,
        isSquare: i % 4 === 0,
      })),
    [],
  );

  if (!card) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        style={s.backdrop}
        onPress={onDismiss}
        accessibilityLabel="Dismiss celebration"
        accessibilityRole={"button" as AccessibilityRole}
      >
        {/* Particle burst */}
        <View style={s.burst} pointerEvents="none">
          {particles.map((p, i) => <Particle key={i} {...p} />)}
        </View>

        {/* Card — tap inside does NOT dismiss */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Animated.View style={[s.card, { transform: [{ scale }], opacity }]}>
            <Text style={s.flame}>🔥</Text>
            <Text style={s.headline}>You're Going{'\n'}Tonight!</Text>
            <Text style={s.restaurant}>{card.restaurant.name}</Text>
            {(card.restaurant.cuisine || card.restaurant.neighborhood) ? (
              <Text style={s.meta}>
                {[card.restaurant.cuisine, card.restaurant.neighborhood]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}

            <View style={s.buttons}>
              {onViewDetails && (
                <TouchableOpacity
                  style={s.primaryBtn}
                  onPress={onViewDetails}
                  activeOpacity={0.85}
                  accessibilityLabel="Make a reservation"
                  accessibilityRole={"button" as AccessibilityRole}
                >
                  <Text style={s.primaryBtnText}>Make a Reservation</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onDismiss}
                activeOpacity={0.7}
                accessibilityLabel="Keep swiping"
                accessibilityRole={"button" as AccessibilityRole}
              >
                <Text style={s.keepSwiping}>Keep swiping</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(248,247,249,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  burst: {
    position: 'absolute',
    top: SH / 2,
    left: SW / 2,
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: SW - 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 28,
    alignItems: 'center',
    shadowColor: 'rgba(180,120,80,0.2)',
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  flame: { fontSize: 52, marginBottom: 14 },
  headline: {
    fontSize: 30,
    fontWeight: '900',
    color: TN.text,
    textAlign: 'center',
    lineHeight: 36,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  restaurant: {
    fontSize: 18,
    fontWeight: '700',
    color: TN.accent,
    textAlign: 'center',
    marginBottom: 4,
  },
  meta: {
    fontSize: 13,
    color: TN.textWarm,
    textAlign: 'center',
    marginBottom: 26,
  },
  buttons: { width: '100%', gap: 10, alignItems: 'center' },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: TN.accent,
    alignItems: 'center',
    shadowColor: TN.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
  keepSwiping: {
    fontSize: 13,
    color: TN.textMuted,
    paddingVertical: 6,
    fontWeight: '500',
  },
});
