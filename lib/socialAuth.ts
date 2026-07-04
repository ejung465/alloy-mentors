import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '@/lib/supabase';

export type SocialProvider = 'apple' | 'google' | 'linkedin_oidc';

WebBrowser.maybeCompleteAuthSession();

/** Apple only makes sense on iOS — Android has no native Apple auth. */
export const appleAuthAvailable = Platform.OS === 'ios';

let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  GoogleSignin.configure({ webClientId, iosClientId, offlineAccess: false });
  googleConfigured = true;
}

/** True once real client IDs are in place — lets the UI hide/disable the button until then. */
export const googleAuthConfigured = !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export async function signInWithApple(): Promise<{ error: string | null }> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) return { error: 'Apple did not return an identity token.' };

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) return { error: error.message };

    // Apple only sends the name on the FIRST authorization ever — capture it now
    // or it's gone for good. Best-effort; intake will collect it either way.
    const name = credential.fullName;
    if (name && (name.givenName || name.familyName)) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('users').update({
          full_name: [name.givenName, name.familyName].filter(Boolean).join(' '),
        }).eq('id', user.id).is('full_name', null);
      }
    }
    return { error: null };
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED') return { error: null }; // user dismissed — not an error
    return { error: e?.message ?? 'Apple sign-in failed.' };
  }
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  try {
    ensureGoogleConfigured();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { error: null }; // cancelled
    const idToken = response.data.idToken;
    if (!idToken) return { error: 'Google did not return an identity token.' };

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { error: error.message };
    return { error: null };
  } catch (e: any) {
    return { error: e?.message ?? 'Google sign-in failed.' };
  }
}

/**
 * LinkedIn has no native mobile SDK — this is a browser-redirect OAuth flow.
 * Supabase's modern client defaults to PKCE, so the callback carries a `code`
 * query param (not a token in the URL hash) — must exchangeCodeForSession.
 */
export async function signInWithLinkedIn(): Promise<{ error: string | null }> {
  try {
    const redirectTo = makeRedirectUri({ scheme: 'alloymentors', path: 'auth/callback' });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'linkedin_oidc',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };
    if (!data.url) return { error: 'No auth URL returned.' };

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success') return { error: null }; // cancelled

    const { params, errorCode } = QueryParams.getQueryParams(res.url);
    if (errorCode) return { error: errorCode };
    if (!params.code) return { error: 'No authorization code returned.' };

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
    if (exchangeError) return { error: exchangeError.message };
    return { error: null };
  } catch (e: any) {
    return { error: e?.message ?? 'LinkedIn sign-in failed.' };
  }
}

/**
 * Route a just-authenticated user: existing profile → straight into the app.
 * No profile yet (first time via a social button) → intake, carrying the
 * same org context the login screen already had.
 */
export async function hasExistingProfile(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle();
  return !!data;
}
