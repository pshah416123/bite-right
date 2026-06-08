/**
 * Profile-tab nested Stack.
 *
 * Without this layout, every file in app/(tabs)/profile/ was registered
 * as a sibling Tab screen with href:null. Pushing settings → edit-username
 * was actually a *tab switch*, not a stack push, so router.back() popped
 * to the tab navigator's default tab (Feed) instead of the previous
 * screen (profile or settings). And because profile/index never came
 * back into focus on the way out, its useFocusEffect didn't re-fetch
 * /api/users/me — so the just-edited username appeared unchanged even
 * though the server had saved it.
 *
 * With a nested Stack here, the profile tab owns its own navigation
 * stack: profile/index is the root, settings / edit-* / followers /
 * following / etc. push onto it, router.back() pops correctly, and
 * profile/index regains focus on the way out so its data re-fetches.
 */
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
