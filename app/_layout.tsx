import { Slot } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { FeedProvider } from '~/src/context/FeedContext';
import { SavedRestaurantsProvider } from '~/src/context/SavedRestaurantsContext';
import { TonightProvider } from '~/src/context/TonightContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <FeedProvider>
        <SavedRestaurantsProvider>
          <TonightProvider>
            <Slot />
          </TonightProvider>
        </SavedRestaurantsProvider>
      </FeedProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

