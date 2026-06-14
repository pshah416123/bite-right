import 'react-native-url-polyfill/auto';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { FeedProvider } from '~/src/context/FeedContext';
import { SavedRestaurantsProvider } from '~/src/context/SavedRestaurantsContext';
import { TonightProvider } from '~/src/context/TonightContext';
import { AuthProvider } from '~/src/context/AuthContext';
import { CompareProvider } from '~/src/context/CompareContext';
import { CompareBar } from '~/src/components/CompareBar';
import { CompareSheet } from '~/src/components/CompareSheet';
import { TestModeProvider } from '~/src/context/TestModeContext';

export default function RootLayout() {
  return (
    <View style={styles.root}>
      <TestModeProvider>
      <AuthProvider>
        <FeedProvider>
          <SavedRestaurantsProvider>
            <TonightProvider>
              <CompareProvider>
                {/* Root Stack — required so that pushing from a tab to a
                    top-level route (app/restaurant/[id], app/friend/[id])
                    establishes a real navigation stack frame. Without a
                    Stack here (previously <Slot />), router.push had no
                    history to push onto, so router.back() from a
                    restaurant detail fell through to the bottom-tabs
                    default tab (Feed) instead of returning to whichever
                    tab pushed the screen. */}
                <Stack screenOptions={{ headerShown: false }} />
                <CompareBar />
                <CompareSheet />
              </CompareProvider>
            </TonightProvider>
          </SavedRestaurantsProvider>
        </FeedProvider>
      </AuthProvider>
      </TestModeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

