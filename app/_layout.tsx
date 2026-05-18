import 'react-native-url-polyfill/auto';
import { Slot } from 'expo-router';
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
                <Slot />
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

