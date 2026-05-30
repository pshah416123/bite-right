/**
 * Profile photo — picks an image, uploads to Supabase Storage (avatars bucket),
 * and patches the user's avatar_url to the resulting public URL.
 *
 * REQUIRES (one-time Supabase setup):
 *   - A storage bucket named "avatars" with Public read access
 *   - Allow authenticated INSERT/UPDATE/UPSERT (handled by the
 *     default authenticated policy or any "service-role can write" rule)
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '~/src/theme/colors';
import { getMe, updateMe } from '~/src/api/users';
import { supabase, supabaseConfigured } from '~/src/lib/supabase';
import { useAuthContext } from '~/src/context/AuthContext';

export default function ProfilePhotoScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => { if (!cancelled) setCurrentUrl(me.avatarUrl ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to set a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPendingUri(result.assets[0].uri);
  };

  const handleSave = async () => {
    if (!pendingUri || !user?.id || !supabaseConfigured) {
      Alert.alert('Not ready', 'Pick an image first.');
      return;
    }
    setUploading(true);
    try {
      // Convert local file URI to a Blob the Supabase SDK can upload.
      const res = await fetch(pendingUri);
      const blob = await res.blob();
      const ext = (pendingUri.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g, '');
      // Path: <userId>/<timestamp>.<ext>. Per-user prefix lets RLS on the
      // bucket key off the path if/when locked down later.
      const path = `${user.id}/${Date.now()}.${ext || 'jpg'}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
      if (uploadError) {
        Alert.alert('Upload failed', uploadError.message);
        return;
      }
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub.publicUrl;
      await updateMe({ avatarUrl: url });
      setCurrentUrl(url);
      setPendingUri(null);
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await updateMe({ avatarUrl: null });
      setCurrentUrl(null);
      setPendingUri(null);
    } catch (e: any) {
      Alert.alert('Could not remove photo', e?.message || 'Try again.');
    } finally {
      setUploading(false);
    }
  };

  const previewUri = pendingUri ?? currentUrl;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Profile photo</Text>
      </View>

      <View style={s.body}>
        <View style={s.avatarWrap}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={s.avatarImage} />
          ) : (
            <View style={s.avatarPlaceholder}>
              <Ionicons name="person" size={56} color={colors.textFaint} />
            </View>
          )}
        </View>

        <TouchableOpacity style={s.pickBtn} onPress={pickImage} activeOpacity={0.85} disabled={uploading}>
          <Ionicons name="image-outline" size={18} color={colors.accent} />
          <Text style={s.pickText}>{previewUri ? 'Choose another' : 'Choose photo'}</Text>
        </TouchableOpacity>

        {pendingUri ? (
          <TouchableOpacity style={s.save} onPress={handleSave} disabled={uploading} activeOpacity={0.85}>
            {uploading ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save</Text>}
          </TouchableOpacity>
        ) : null}

        {currentUrl && !pendingUri ? (
          <TouchableOpacity style={s.removeBtn} onPress={handleRemove} disabled={uploading}>
            <Text style={s.removeText}>Remove photo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { paddingHorizontal: 24, alignItems: 'center', paddingTop: 8 },
  avatarWrap: { width: 160, height: 160, borderRadius: 80, overflow: 'hidden', backgroundColor: colors.surfaceSoft, marginBottom: 20 },
  avatarImage: { width: '100%', height: '100%' },
  avatarPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.accentSoft },
  pickText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  save: { marginTop: 20, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 14, alignItems: 'center', alignSelf: 'stretch' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  removeBtn: { marginTop: 16, paddingVertical: 12 },
  removeText: { color: '#B83A3A', fontSize: 14, fontWeight: '600' },
});
