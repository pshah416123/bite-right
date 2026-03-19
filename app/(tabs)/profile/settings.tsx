import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>App preferences and account</Text>
      </View>
      <View style={styles.content}>
        <TouchableOpacity style={styles.row} activeOpacity={0.7}>
          <Ionicons name="person-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>Edit profile</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} activeOpacity={0.7}>
          <Ionicons name="moon-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>Appearance</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} activeOpacity={0.7}>
          <Ionicons name="lock-closed-outline" size={22} color={colors.text} />
          <Text style={styles.rowText}>Privacy & security</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backText: { marginLeft: 4, fontSize: 16, color: colors.text },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  content: { paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, marginLeft: 12, fontSize: 16, color: colors.text },
});
