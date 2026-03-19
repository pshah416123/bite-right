import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { createUser } from '../api/users';

interface Props {
  onDone: (userId: string) => void;
}

type Step = 'welcome' | 'create' | 'permissions' | 'friends';

export function OnboardingFlow({ onDone }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [contactsAllowed, setContactsAllowed] = useState<boolean | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);

  const handleCreateAccount = async () => {
    if (!name.trim() || !username.trim()) {
      Alert.alert('Missing info', 'Please enter a name and username.');
      return;
    }
    try {
      setCreating(true);
      const user = await createUser({ name: name.trim(), username: username.trim(), email: email.trim() || undefined });
      setCreatedUserId(user.id);
      await AsyncStorage.setItem('biteright_currentUserId', user.id);
      setStep('permissions');
    } catch (e) {
      Alert.alert('Error', 'Could not create account. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationGranted(status === 'granted');
    } catch {
      setLocationGranted(false);
    }
  };

  const completeOnboarding = async () => {
    const id = createdUserId || 'you';
    await AsyncStorage.setItem('biteright_onboardingCompleted', 'true');
    onDone(id);
  };

  const renderWelcome = () => (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>BiteRight</Text>
        <Text style={styles.subtitle}>Your Taste, Perfected</Text>
      </View>
      <View style={styles.body}>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => setStep('create')}
        >
          <Text style={styles.primaryText}>Create account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => setStep('create')}
        >
          <Text style={styles.secondaryText}>Log in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const renderCreate = () => (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep('welcome')} style={styles.backRow}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Set up your BiteRight profile</Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            autoCapitalize="none"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <Text style={styles.label}>Email (optional)</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={handleCreateAccount}
            disabled={creating}
          >
            <Text style={styles.primaryText}>{creating ? 'Creating…' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  const renderPermissions = () => (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Set up BiteRight</Text>
        <Text style={styles.subtitle}>Help us show distance and friends nearby.</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Location</Text>
          <Text style={styles.cardBody}>
            We use your location to show distance and Nearby recommendations.
          </Text>
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.smallBtn} onPress={requestLocation}>
              <Text style={styles.smallBtnText}>Allow</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallBtn, styles.smallBtnSecondary]}
              onPress={() => setLocationGranted(false)}
            >
              <Text style={styles.smallBtnSecondaryText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contacts</Text>
          <Text style={styles.cardBody}>
            Optionally match your contacts to find friends on BiteRight later.
          </Text>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => setContactsAllowed(true)}
            >
              <Text style={styles.smallBtnText}>Allow</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallBtn, styles.smallBtnSecondary]}
              onPress={() => setContactsAllowed(false)}
            >
              <Text style={styles.smallBtnSecondaryText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => setStep('friends')}
        >
          <Text style={styles.primaryText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const renderFriends = () => (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Find friends</Text>
        <Text style={styles.subtitle}>
          Follow friends to see their favorite restaurants in your feed.
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.cardBody}>
          You can search and follow friends from Profile 
          {'>'} Settings any time.
        </Text>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={completeOnboarding}
        >
          <Text style={styles.primaryText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (step === 'welcome') return renderWelcome();
  if (step === 'create') return renderCreate();
  if (step === 'permissions') return renderPermissions();
  return renderFriends();
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  form: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  label: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  primaryBtn: {
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  secondaryBtn: {
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backText: {
    marginLeft: 2,
    fontSize: 14,
    color: colors.text,
  },
  card: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 13,
    color: colors.textMuted,
  },
  cardActions: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  smallBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  smallBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
});

