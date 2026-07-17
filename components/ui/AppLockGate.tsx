import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet, View } from 'react-native';
import { LockScreen } from '@/components/ui/LockScreen';
import { getAppLockEnabled } from '@/lib/appLock';

interface AppLockGateProps {
  children: React.ReactNode;
}

/**
 * Wrap the app's root content with this. On mount, and whenever the app
 * returns to the foreground from a true background state, it checks the
 * `alloy.appLockEnabled` AsyncStorage flag (see lib/appLock.ts) — if set, it
 * renders <LockScreen> as an overlay ON TOP of `children` (which stay
 * mounted underneath, mirroring IntroSplash) until the user authenticates,
 * so in-app navigation state survives a lock/unlock cycle instead of the
 * whole Stack remounting back to the root route.
 *
 * Only a real `background` -> `active` transition re-arms the lock —
 * `inactive` (Control Center, the app switcher, a call banner) is too
 * transient to treat as "left the app."
 *
 * Wired in app/_layout.tsx:
 *
 *   <UserProvider>
 *     <AppLockGate>
 *       <Stack ...>...</Stack>
 *     </AppLockGate>
 *   </UserProvider>
 */
export function AppLockGate({ children }: AppLockGateProps) {
  const [lockEnabled, setLockEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const refreshLockState = async () => {
    const enabled = await getAppLockEnabled();
    setLockEnabled(enabled);
    setChecked(true);
  };

  useEffect(() => {
    refreshLockState();
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev === 'background' && next === 'active') {
        // Returning from a real background state: re-check the flag and
        // require unlock again.
        refreshLockState();
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  // Avoid a flash of locked/unlocked content before we've read the flag once.
  if (!checked) return null;

  const showLock = lockEnabled && !unlocked;

  return (
    <View style={styles.root}>
      {children}
      {showLock && (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen onUnlock={() => setUnlocked(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
