import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#E8692A',
        tabBarInactiveTintColor: '#A8A19A',
        tabBarStyle: {
          backgroundColor: '#FFF7ED',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: 'rgba(0, 0, 0, 0.05)',
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
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass-outline" size={size} color={color} />
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
        name="profile/index"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Profile sub-screens are inside the profile tab's own nested
          Stack (app/(tabs)/profile/_layout.tsx) — no Tabs.Screen entries
          needed here. */}
      <Tabs.Screen name="log-visit" options={{ href: null }} />
      <Tabs.Screen name="tonight/join" options={{ href: null }} />
      <Tabs.Screen name="tonight/swipe" options={{ href: null }} />
      <Tabs.Screen name="tonight/matches" options={{ href: null }} />
      <Tabs.Screen name="tonight/setup" options={{ href: null }} />
    </Tabs>
  );
}
