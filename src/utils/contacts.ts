/**
 * Device contacts → phone numbers for the find-friends contact-match flow.
 *
 * Wraps expo-contacts so the rest of the app doesn't import it directly.
 * Keeps the permission flow + format normalization in one place.
 */

import * as Contacts from 'expo-contacts';

export type ContactsPermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * Read the current contacts permission without prompting the user.
 * Returns 'undetermined' on the first call, then 'granted' / 'denied'.
 */
export async function getContactsPermission(): Promise<ContactsPermissionState> {
  const { status } = await Contacts.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/** Show the system prompt. Returns the resulting state. */
export async function requestContactsPermission(): Promise<ContactsPermissionState> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Read all contacts and return their phone numbers, deduplicated.
 * Returns an empty array when permission isn't granted — caller is
 * responsible for prompting first.
 *
 * Phones are returned as the user has them in their address book; the
 * server normalizes to E.164 before matching.
 */
export async function getContactPhones(): Promise<string[]> {
  const { status } = await Contacts.getPermissionsAsync();
  if (status !== 'granted') return [];
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers],
  });
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const c of data || []) {
    for (const p of c.phoneNumbers || []) {
      const number = p?.number?.trim();
      if (!number) continue;
      // Use the raw string for dedup. Final normalization happens server-side.
      if (seen.has(number)) continue;
      seen.add(number);
      phones.push(number);
    }
  }
  return phones;
}
