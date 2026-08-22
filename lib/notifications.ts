import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

/**
 * Ask the OS for push-notification permission. Call this from an explicit
 * user action (a settings toggle, or once at the end of onboarding) — never
 * silently on every app launch.
 *
 * Returns true only if the user actually granted permission.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  return status === 'granted';
}

/**
 * Registers this device for push notifications and returns the Expo push
 * token, or null if unavailable (simulator, permission denied, no project id).
 * Also upserts the token into `push_tokens` (migration 0031) so a backend job
 * can actually address this device — see `savePushToken`.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push tokens aren't available on simulators/emulators.
    return null;
  }

  const granted = await requestNotificationPermission();
  if (!granted) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse.data;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await savePushToken(user.id, token);
    return token;
  } catch (e) {
    console.warn('[notifications] failed to get Expo push token:', e);
    return null;
  }
}

/** Upsert this device's Expo push token for `userId` into `push_tokens`. */
export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' }
    );
  if (error) console.warn('[notifications] failed to save push token:', error.message);
}

/** Remove this device's push token for `userId` (e.g. notifications toggled off). */
export async function removePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token);
  if (error) console.warn('[notifications] failed to remove push token:', error.message);
}
