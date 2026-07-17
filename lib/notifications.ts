import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
 *
 * TODO(follow-up): upload the returned token to a `push_tokens` table keyed
 * by user_id so the backend can actually send pushes. Not built here — this
 * only gets the token itself working end-to-end on-device.
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
    return tokenResponse.data;
  } catch (e) {
    console.warn('[notifications] failed to get Expo push token:', e);
    return null;
  }
}
