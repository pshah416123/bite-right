import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#f97316',
        tabBarInactiveTintColor: 'rgba(0, 0, 0, 0.45)',
        tabBarStyle: {
          backgroundColor: '#fff7ed',
          borderTopWidth: 1,
          borderTopColor: 'rgba(0, 0, 0, 0.08)',
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
      <Tabs.Screen name="profile/find-friends" options={{ href: null }} />
      <Tabs.Screen name="profile/settings" options={{ href: null }} />
      <Tabs.Screen name="profile/followers" options={{ href: null }} />
      <Tabs.Screen name="profile/following" options={{ href: null }} />
      <Tabs.Screen name="restaurant/[id]" options={{ href: null }} />
      <Tabs.Screen name="log-visit" options={{ href: null }} />
      <Tabs.Screen name="tonight/join" options={{ href: null }} />
      <Tabs.Screen name="tonight/swipe" options={{ href: null }} />
      <Tabs.Screen name="tonight/matches" options={{ href: null }} />
    </Tabs>
  );
}
