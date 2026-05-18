/**
 * SwipeDeck — Tinder-style card stack for the Tonight tab.
 *
 * Uses React Native's built-in Animated API + PanResponder.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CARD_W, CARD_H, TN, SwipeCard } from './SwipeCard';
import type { TonightCardModel } from './TonightCard';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 120;
const VELOCITY_THRESHOLD = 800;
const ROTATION_MAX = 15; // degrees

// CTA labels — change these in one place to rename buttons across the deck.
const PASS_LABEL = 'Not tonight';
const LIKE_LABEL = 'Crave this'; // Swap to 'Pick this' or "I'm in" later.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwipeDeckProps {
  cards: TonightCardModel[];
  onSwipedLeft?: (card: TonightCardModel) => void;
  onSwipedRight?: (card: TonightCardModel) => void;
  onSwipedTop?: (card: TonightCardModel) => void;
  onAllSwiped?: () => void;
  /** Called when remaining cards drop to this threshold (default 5). */
  onRunningLow?: () => void;
  runningLowThreshold?: number;
  isSaved?: (id: string) => boolean;
  groupAvatars?: Record<string, string[]>;
}

// ─── SwipeDeck ────────────────────────────────────────────────────────────────

export default function SwipeDeck({
  cards,
  onSwipedLeft,
  onSwipedRight,
  onSwipedTop,
  onAllSwiped,
  onRunningLow,
  runningLowThreshold = 5,
  isSaved,
  groupAvatars,
}: SwipeDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Stable refs so callbacks never capture stale values
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const cbRef = useRef({ onSwipedLeft, onSwipedRight, onSwipedTop, onAllSwiped, onRunningLow });
  cbRef.current = { onSwipedLeft, onSwipedRight, onSwipedTop, onAllSwiped, onRunningLow };
  const lowNotifiedRef = useRef(false);
  const prevCardLenRef = useRef(cards.length);
  const swipingRef = useRef(false);

  // Reset the low-notification flag when new cards are appended
  useEffect(() => {
    if (cards.length > prevCardLenRef.current) {
      lowNotifiedRef.current = false;
    }
    prevCardLenRef.current = cards.length;
  }, [cards.length]);

  // ── Animated values ─────────────────────────────────────────────────────────
  const pan = useRef(new Animated.ValueXY()).current;
  const topOpacity = useRef(new Animated.Value(1)).current;
  // dragProgress: 0 → 1 as card is dragged
  const dragProgress = useRef(new Animated.Value(0)).current;

  // Reset on index change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    pan.setValue({ x: 0, y: 0 });
    dragProgress.setValue(0);
    topOpacity.setValue(1);
    swipingRef.current = false;
  }, [currentIndex, pan, dragProgress, topOpacity]);

  // ── Swipe completion ────────────────────────────────────────────────────────
  const handleSwipeComplete = useCallback((direction: 'left' | 'right' | 'up') => {
    const idx = currentIndexRef.current;
    const card = cardsRef.current[idx];
    const next = idx + 1;
    setCurrentIndex(next);

    if (direction === 'left') cbRef.current.onSwipedLeft?.(card);
    if (direction === 'right') cbRef.current.onSwipedRight?.(card);
    if (direction === 'up') cbRef.current.onSwipedTop?.(card);

    const remaining = cardsRef.current.length - next;
    if (remaining <= runningLowThreshold && !lowNotifiedRef.current) {
      lowNotifiedRef.current = true;
      cbRef.current.onRunningLow?.();
    }

    if (next >= cardsRef.current.length) cbRef.current.onAllSwiped?.();
  }, [runningLowThreshold]);

  // ── Fly off helper ──────────────────────────────────────────────────────────
  const flyOff = useCallback((direction: 'left' | 'right' | 'up') => {
    if (swipingRef.current) return;
    swipingRef.current = true;

    const config = { duration: 320, useNativeDriver: true } as const;
    let anim: Animated.CompositeAnimation;

    if (direction === 'up') {
      anim = Animated.timing(pan.y, { toValue: -SH * 1.4, ...config });
    } else {
      const targetX = direction === 'right' ? SW * 1.6 : -SW * 1.6;
      anim = Animated.timing(pan.x, { toValue: targetX, ...config });
    }

    anim.start(({ finished }) => {
      if (finished) {
        topOpacity.setValue(0);
        handleSwipeComplete(direction);
      }
    });
  }, [pan, topOpacity, handleSwipeComplete]);

  // ── PanResponder ────────────────────────────────────────────────────────────
  const panResponder = useMemo(() => {
    let lastDx = 0;
    let lastDy = 0;
    let lastVx = 0;
    let lastVy = 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => !swipingRef.current,
      onMoveShouldSetPanResponder: (_, g) => !swipingRef.current && (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8),
      onPanResponderMove: (_, g) => {
        pan.setValue({ x: g.dx, y: g.dy });
        const progress = Math.min(1, Math.abs(g.dx) / SWIPE_THRESHOLD);
        dragProgress.setValue(progress);
        lastDx = g.dx;
        lastDy = g.dy;
        lastVx = g.vx * 1000; // PanResponder vx is in px/ms, convert to px/s
        lastVy = g.vy * 1000;
      },
      onPanResponderRelease: () => {
        const isHorizontal = Math.abs(lastDx) >= Math.abs(lastDy);
        const pastThresh =
          Math.abs(lastDx) > SWIPE_THRESHOLD || Math.abs(lastVx) > VELOCITY_THRESHOLD;
        const isUpSwipe =
          lastDy < -SWIPE_THRESHOLD || lastVy < -VELOCITY_THRESHOLD;

        if (isHorizontal && pastThresh) {
          flyOff(lastDx > 0 ? 'right' : 'left');
        } else if (!isHorizontal && isUpSwipe) {
          flyOff('up');
        } else {
          // Spring back
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            damping: 15,
            stiffness: 130,
            mass: 0.9,
            useNativeDriver: true,
          }).start();
          Animated.spring(dragProgress, {
            toValue: 0,
            damping: 15,
            stiffness: 130,
            useNativeDriver: true,
          }).start();
        }
      },
    });
  }, [pan, dragProgress, flyOff]);

  // ── Programmatic swipe from action buttons ──────────────────────────────────
  const triggerSwipe = useCallback(
    (direction: 'left' | 'right' | 'up') => {
      if (swipingRef.current) return;

      if (direction === 'up') {
        Animated.timing(dragProgress, { toValue: 1, duration: 160, useNativeDriver: true }).start();
        flyOff('up');
      } else {
        const peek = direction === 'right' ? SWIPE_THRESHOLD * 0.6 : -SWIPE_THRESHOLD * 0.6;
        Animated.timing(dragProgress, { toValue: 1, duration: 160, useNativeDriver: true }).start();
        Animated.timing(pan.x, { toValue: peek, duration: 90, useNativeDriver: true }).start(({ finished }) => {
          if (finished) flyOff(direction);
        });
      }
    },
    [pan, dragProgress, flyOff],
  );

  // ── Interpolated styles ─────────────────────────────────────────────────────
  const rotate = pan.x.interpolate({
    inputRange: [-SW / 2, 0, SW / 2],
    outputRange: [`-${ROTATION_MAX}deg`, '0deg', `${ROTATION_MAX}deg`],
    extrapolate: 'clamp',
  });

  const topCardStyle = {
    opacity: topOpacity,
    transform: [
      { translateX: pan.x },
      { translateY: pan.y },
      { rotate },
    ],
  };

  const card2Scale = dragProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1],
    extrapolate: 'clamp',
  });
  const card2TransY = dragProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
    extrapolate: 'clamp',
  });
  const card2Style = {
    transform: [{ scale: card2Scale }, { translateY: card2TransY }],
  };

  const card3Scale = dragProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 0.94],
    extrapolate: 'clamp',
  });
  const card3TransY = dragProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 14],
    extrapolate: 'clamp',
  });
  const card3Style = {
    transform: [{ scale: card3Scale }, { translateY: card3TransY }],
  };

  // Stamp opacities
  const passOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, -20, 0],
    outputRange: [1, 0.15, 0],
    extrapolate: 'clamp',
  });
  const tonightOpacity = pan.x.interpolate({
    inputRange: [0, 20, SWIPE_THRESHOLD],
    outputRange: [0, 0.15, 1],
    extrapolate: 'clamp',
  });
  const cravingOpacity = pan.y.interpolate({
    inputRange: [-SWIPE_THRESHOLD, -20, 0],
    outputRange: [1, 0.15, 0],
    extrapolate: 'clamp',
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  const isDone = currentIndex >= cards.length;
  const card1 = cards[currentIndex];
  const card2 = cards[currentIndex + 1];
  const card3 = cards[currentIndex + 2];

  return (
    <View style={styles.container} accessibilityLabel="Restaurant swipe deck">
      {/* ── Card stack ─────────────────────────────────────────────────── */}
      <View style={styles.stack}>
        {isDone ? (
          <EmptyState />
        ) : (
          <>
            {card3 && (
              <Animated.View style={[styles.cardSlot, { zIndex: 1 }, card3Style]}>
                <SwipeCard card={card3} isSaved={isSaved?.(card3.restaurant.id)} />
              </Animated.View>
            )}

            {card2 && (
              <Animated.View style={[styles.cardSlot, { zIndex: 2 }, card2Style]}>
                <SwipeCard card={card2} isSaved={isSaved?.(card2.restaurant.id)} />
              </Animated.View>
            )}

            {card1 && (
              <Animated.View
                style={[styles.cardSlot, { zIndex: 3 }, topCardStyle]}
                {...panResponder.panHandlers}
                accessibilityLabel={`Swipe to decide on ${card1.restaurant.name}. Swipe right for Tonight, left to Pass.`}
                accessibilityRole="adjustable"
              >
                {/* PASS overlay — red tint + X icon */}
                <Animated.View style={[styles.feedbackOverlay, styles.feedbackPass, { opacity: passOpacity }]} pointerEvents="none">
                  <View style={styles.feedbackIconCircle}>
                    <Text style={styles.feedbackPassIcon}>{'\u2715'}</Text>
                  </View>
                  <Text style={styles.feedbackPassLabel}>PASS</Text>
                </Animated.View>

                {/* CRAVE overlay — green tint + heart icon */}
                <Animated.View style={[styles.feedbackOverlay, styles.feedbackCrave, { opacity: tonightOpacity }]} pointerEvents="none">
                  <View style={[styles.feedbackIconCircle, styles.feedbackCraveCircle]}>
                    <Text style={styles.feedbackCraveIcon}>{'\u2764\uFE0F'}</Text>
                  </View>
                  <Text style={styles.feedbackCraveLabel}>CRAVE</Text>
                </Animated.View>

                {/* CRAVING (super) overlay */}
                <Animated.View style={[styles.feedbackOverlay, styles.feedbackSuper, { opacity: cravingOpacity }]} pointerEvents="none">
                  <View style={[styles.feedbackIconCircle, styles.feedbackSuperCircle]}>
                    <Text style={styles.feedbackSuperIcon}>{'\u2B50'}</Text>
                  </View>
                  <Text style={styles.feedbackSuperLabel}>{'\u2605'} CRAVING</Text>
                </Animated.View>

                <SwipeCard card={card1} isSaved={isSaved?.(card1.restaurant.id)} />
              </Animated.View>
            )}
          </>
        )}
      </View>

      {/* ── Action buttons ──────────────────────────────────────────────── */}
      {!isDone && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.passBtn]}
            onPress={() => triggerSwipe('left')}
            activeOpacity={0.85}
            accessibilityLabel="Pass on this restaurant"
          >
            <View style={styles.actionIconWrap}>
              <Text style={styles.passBtnIcon}>{'\u2715'}</Text>
            </View>
            <Text style={styles.passBtnLabel}>{PASS_LABEL}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.likeBtn]}
            onPress={() => triggerSwipe('right')}
            activeOpacity={0.9}
            accessibilityLabel="Crave this restaurant"
          >
            <View style={[styles.actionIconWrap, styles.actionIconWrapLike]}>
              <Text style={styles.likeBtnIcon}>{'\u{1F525}'}</Text>
            </View>
            <Text style={styles.likeBtnLabel}>{LIKE_LABEL}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={empty.wrap} accessibilityLabel="Loading more restaurants">
      <Text style={empty.emoji}>{'\u2728'}</Text>
      <Text style={empty.title}>Finding more places…</Text>
      <Text style={empty.sub}>Hang tight, fresh picks are on the way.</Text>
    </View>
  );
}

const empty = StyleSheet.create({
  wrap: {
    width: CARD_W,
    height: CARD_H * 0.65,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emoji: { fontSize: 52, marginBottom: 16 },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 8,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  stack: {
    width: CARD_W,
    height: CARD_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSlot: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    alignItems: 'center',
  },
  // Swipe feedback overlays — fullscreen tint + centred icon
  feedbackOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  feedbackPass: {
    backgroundColor: 'rgba(255,59,48,0.14)',
  },
  feedbackCrave: {
    backgroundColor: 'rgba(52,199,89,0.14)',
  },
  feedbackSuper: {
    backgroundColor: 'rgba(255,215,0,0.14)',
  },
  feedbackIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    marginBottom: 8,
  },
  feedbackCraveCircle: {},
  feedbackSuperCircle: {},
  feedbackPassIcon: {
    fontSize: 30,
    fontWeight: '900',
    color: TN.nope,
  },
  feedbackCraveIcon: {
    fontSize: 28,
  },
  feedbackSuperIcon: {
    fontSize: 28,
  },
  feedbackPassLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: TN.nope,
    letterSpacing: 2,
  },
  feedbackCraveLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: TN.like,
    letterSpacing: 2,
  },
  feedbackSuperLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: TN.craving,
    letterSpacing: 1,
  },
  // Action buttons — tight to card, swipe-app feel
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  actionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  actionIconWrapLike: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  passBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  likeBtn: {
    backgroundColor: TN.accent,
    shadowColor: TN.accent,
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  passBtnIcon: {
    fontSize: 12,
    fontWeight: '800',
    color: TN.textMuted,
  },
  passBtnLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: TN.textMuted,
    letterSpacing: -0.1,
  },
  likeBtnIcon: {
    fontSize: 14,
  },
  likeBtnLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
});
