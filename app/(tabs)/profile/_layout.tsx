/**
 * Profile-tab nested Stack.
 *
 * Without this layout, every file in app/(tabs)/profile/ is registered
 * as a sibling Tab screen with href:null. Pushing settings → edit-username
 * is then a *tab switch*, not a stack push, so router.back() pops to the
 * tab navigator's default tab (Feed) instead of returning to the previous
 * screen (profile / settings). And because profile/index never comes back
 * into focus on the way out, its useFocusEffect doesn't re-fetch
 * /api/users/me — so a just-edited username appears unchanged even
 * though the server saved it.
 *
 * With a Stack here, the profile tab owns its own internal navigation:
 * profile/index is the stack root; settings / edit-* / followers /
 * following / etc. push onto it; router.back() pops correctly; and
 * profile/index regains focus on the way out so its data re-fetches.
 */
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
