import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import {
  getCuisineFallbackIcon,
  getProvidedRestaurantImageUrl,
  getProvidedRestaurantImageSourceType,
  getRestaurantImageCacheKey,
  type RestaurantImageData,
  type RestaurantImageFallbackType,
} from '../utils/restaurantImage';
import {
  getCachedRestaurantPhoto,
  getRestaurantFoodPhoto,
  invalidateRestaurantPhoto,
  primeRestaurantPhotoCache,
} from '../utils/restaurantPhoto';

interface Props {
  restaurant: RestaurantImageData;
  aspectRatio?: number;
  fallbackType?: RestaurantImageFallbackType;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}

function Skeleton({ borderRadius }: { borderRadius: number }) {
  const shimmer = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0.45,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          opacity: shimmer,
          borderRadius,
          backgroundColor: '#E9DDD1',
        },
      ]}
    />
  );
}

function Placeholder({
  restaurant,
  fallbackType,
  borderRadius,
}: {
  restaurant: RestaurantImageData;
  fallbackType: RestaurantImageFallbackType;
  borderRadius: number;
}) {
  const iconName = getCuisineFallbackIcon(restaurant.cuisine);

  return (
    <LinearGradient
      colors={
        fallbackType === 'blur'
          ? ['#F8EADF', '#F0E4D7', '#E7D5C7']
          : fallbackType === 'color'
            ? ['#FFF4EB', '#F7E7D8']
            : ['#FFF4EB', '#EDE0D4']
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFillObject, styles.placeholder, { borderRadius }]}
    >
      <View style={styles.placeholderIconWrap}>
        <Ionicons name={iconName as any} size={22} color={colors.textFaint} />
      </View>
    </LinearGradient>
  );
}

export function RestaurantImage({
  restaurant,
  aspectRatio = 4 / 3,
  fallbackType = 'icon',
  borderRadius = 16,
  style,
  imageStyle,
}: Props) {
  const restaurantSnapshot = useMemo(
    () => ({
      id: restaurant.id ?? null,
      restaurantId: restaurant.restaurantId ?? null,
      placeId: restaurant.placeId ?? null,
      place_id: restaurant.place_id ?? null,
      name: restaurant.name ?? null,
      cuisine: restaurant.cuisine ?? null,
      googlePlaceId: restaurant.googlePlaceId ?? null,
      displayImageUrl: restaurant.displayImageUrl ?? null,
      displayImageSourceType: restaurant.displayImageSourceType ?? null,
      displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt ?? null,
      imageUrl: restaurant.imageUrl ?? null,
      previewPhotoUrl: restaurant.previewPhotoUrl ?? null,
      cover_image_url: restaurant.cover_image_url ?? null,
      food_image_urls: restaurant.food_image_urls ?? null,
    }),
    [
      restaurant.id,
      restaurant.restaurantId,
      restaurant.placeId,
      restaurant.place_id,
      restaurant.name,
      restaurant.cuisine,
      restaurant.googlePlaceId,
      restaurant.displayImageUrl,
      restaurant.displayImageSourceType,
      restaurant.displayImageLastResolvedAt,
      restaurant.imageUrl,
      restaurant.previewPhotoUrl,
      restaurant.cover_image_url,
      restaurant.food_image_urls,
    ],
  );
  const cacheKey = getRestaurantImageCacheKey(restaurantSnapshot);
  const providedImage = useMemo(() => getProvidedRestaurantImageUrl(restaurantSnapshot), [restaurantSnapshot]);
  const cachedImage = useMemo(() => getCachedRestaurantPhoto(restaurantSnapshot), [restaurantSnapshot, cacheKey]);
  const initialImage = providedImage ?? cachedImage ?? null;
  const providedSourceType = useMemo(
    () => getProvidedRestaurantImageSourceType(restaurantSnapshot),
    [restaurantSnapshot],
  );
  const [uri, setUri] = useState<string | null>(initialImage);
  const [loading, setLoading] = useState(!initialImage && !!cacheKey);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Track which restaurant we're currently displaying so we only reset uri
  // when the entity actually changes — not when the parent re-renders for
  // unrelated reasons (e.g. a Discover filter toggle re-rendering the list).
  // Without this, every parent re-render flashed uri to null briefly while
  // the resolver re-ran, which read as "the pic came and went."
  const lastInitedCacheKeyRef = useRef<string | null>(null);

  useEffect(() => {
    primeRestaurantPhotoCache(restaurantSnapshot);
    // Only initialize state when we're rendering a different restaurant
    // (cacheKey changed). For re-renders that keep the same entity — e.g.
    // a Discover filter toggle causing the parent to re-render the same
    // card — leave the existing uri/loading/failed/imageLoaded alone so
    // the photo doesn't blink to the placeholder while the resolver
    // unnecessarily re-runs. The onError and resolver effects below still
    // own uri transitions for this entity.
    if (lastInitedCacheKeyRef.current !== cacheKey) {
      lastInitedCacheKeyRef.current = cacheKey;
      setUri(initialImage);
      setLoading(!initialImage && !!cacheKey);
      setFailed(false);
    }
  }, [cacheKey, initialImage, restaurantSnapshot]);

  useEffect(() => {
    let cancelled = false;
    if (initialImage || !cacheKey) return;

    getRestaurantFoodPhoto(restaurantSnapshot)
      .then((resolved) => {
        if (cancelled) return;
        setUri(resolved);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, initialImage, restaurantSnapshot]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log('[BiteRight][RestaurantImageClient]', {
      restaurantName: restaurantSnapshot.name ?? 'Restaurant',
      internalId: restaurantSnapshot.id ?? restaurantSnapshot.restaurantId ?? null,
      googlePlaceId: restaurantSnapshot.googlePlaceId ?? restaurantSnapshot.placeId ?? restaurantSnapshot.place_id ?? null,
      googlePlaceIdFound: !!(
        restaurantSnapshot.googlePlaceId ??
        restaurantSnapshot.placeId ??
        restaurantSnapshot.place_id
      ),
      chosenImageSourceType:
        providedSourceType ?? (uri && !failed ? 'resolved' : 'placeholder'),
      finalChosenImageUrl: uri,
      placeholderUsed: !uri || failed,
    });
  }, [failed, providedSourceType, restaurantSnapshot, uri]);

  const showImage = !!uri && !failed;

  return (
    <View
      style={[
        styles.root,
        { aspectRatio, borderRadius },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: uri! }}
          style={[styles.image, { borderRadius }, imageStyle]}
          resizeMode="cover"
          onLoadStart={() => {
            setImageLoaded(false);
            setLoading(true);
          }}
          onLoadEnd={() => {
            setImageLoaded(true);
            setLoading(false);
          }}
          onError={() => {
            // The persisted URL failed to load (404, stale, etc). Invalidate
            // the cache and trigger a confidence-gated retry via the centralized
            // resolver. Placeholder shows while we re-resolve.
            if (__DEV__) {
              console.log('[BiteRight][RestaurantImage] image load failed — retrying via resolver', {
                cacheKey, failedUri: uri,
              });
            }
            setFailed(true);
            setUri(null);
            setLoading(true);
            if (cacheKey) invalidateRestaurantPhoto(restaurantSnapshot);
            getRestaurantFoodPhoto(restaurantSnapshot)
              .then((resolved) => {
                if (resolved) {
                  setUri(resolved);
                  setFailed(false);
                }
              })
              .finally(() => setLoading(false));
          }}
        />
      ) : null}

      {/* Skeleton: only while resolving a URI (no URI yet but cache lookup in flight). */}
      {(loading && !showImage) ? <Skeleton borderRadius={borderRadius} /> : null}

      {/* Placeholder: render UNDER the <Image> until the image has actually
          decoded (imageLoaded). The <Image> above will cover it as soon as
          it paints, but until then we show the gradient placeholder instead
          of the blank container — eliminates the brief blank flash when a
          fresh RestaurantImage mounts on navigation (e.g. tapping a Next
          Stop card into the destination detail screen). */}
      {(!showImage || !imageLoaded) ? (
        <Placeholder
          restaurant={restaurant}
          fallbackType={fallbackType}
          borderRadius={borderRadius}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  placeholderIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
