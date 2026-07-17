import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_LOCK_KEY = 'alloy.appLockEnabled';

/** Checks whether this device can actually do biometric auth (hardware + enrolled). */
export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return isEnrolled;
}

/** Prompts Face ID / Touch ID / device PIN. Resolves true only on success. */
export async function authenticateAsync(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Alloy Mentors',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}

export async function getAppLockEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(APP_LOCK_KEY);
  return v === '1';
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(APP_LOCK_KEY, enabled ? '1' : '0');
}

export { APP_LOCK_KEY };
