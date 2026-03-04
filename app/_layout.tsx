import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { FeedProvider } from '../src/context/FeedContext';
import { TonightProvider } from '../src/context/TonightContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
    <FeedProvider>
      <TonightProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#f97316',
          tabBarStyle: {
            backgroundColor: '#fff7ed',
            borderTopColor: '#e5e7eb',
            height: 70,
            paddingBottom: 12,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Feed',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="tonight/index"
          options={{
            title: 'Tonight',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="flame-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="restaurant/[id]"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="log-visit"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="tonight/join"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="tonight/swipe"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="tonight/matches"
          options={{
            href: null,
          }}
        />
      </Tabs>
      </TonightProvider>
    </FeedProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

