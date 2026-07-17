import { UserProvider } from '@/contexts/UserContext';
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  Inter_700Bold, Inter_900Black,
} from '@expo-google-fonts/inter';
import { Lato_400Regular, Lato_700Bold } from '@expo-google-fonts/lato';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import '../global.css';
import { IntroSplash } from '@/components/ui/IntroSplash';
import { AppLockGate } from '@/components/ui/AppLockGate';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
    'Inter-Black': Inter_900Black,
    'Lato-Regular': Lato_400Regular,
    'Lato-Bold': Lato_700Bold,
  });
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#F1F1EF' }}>
      <UserProvider>
        <AppLockGate>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F1F1EF' } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            {/* Kiosk is a deliberate full-screen device mode (not a page you
                navigate "into"), and the quick-log sheet is a genuine transient
                action — both stay as true modals. Everything else below reads
                as a normal app page, so it gets standard push presentation:
                native back button + edge-swipe-back come for free from
                expo-router/react-navigation once presentation isn't 'modal'. */}
            <Stack.Screen name="kiosk" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="add-student" options={{ headerShown: false }} />
            <Stack.Screen name="import-students" options={{ headerShown: false }} />
            <Stack.Screen name="students" options={{ headerShown: false }} />
            <Stack.Screen name="my-pairing" options={{ headerShown: false }} />
            <Stack.Screen name="my-qr" options={{ headerShown: false }} />
            <Stack.Screen name="student/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
            <Stack.Screen name="org-tree" options={{ headerShown: false }} />
            <Stack.Screen name="org-settings" options={{ headerShown: false }} />
            <Stack.Screen name="data-export" options={{ headerShown: false }} />
            <Stack.Screen name="admin-analytics" options={{ headerShown: false }} />
            <Stack.Screen name="admin-chat-viewer" options={{ headerShown: false }} />
            <Stack.Screen name="resources" options={{ headerShown: false }} />
            <Stack.Screen name="audit-log" options={{ headerShown: false }} />
            <Stack.Screen name="upgrade" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
            <Stack.Screen name="credits" options={{ headerShown: false }} />
            <Stack.Screen name="contact-support" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="dark" />
          {/* Overlay ON TOP of the Stack: the real destination mounts and loads
              underneath while the intro plays, so the flipboard reveal uncovers
              a ready screen. Unmounts itself when the reveal completes. */}
          {!introDone && <IntroSplash onDone={() => setIntroDone(true)} />}
        </AppLockGate>
      </UserProvider>
    </GestureHandlerRootView>
  );
}
