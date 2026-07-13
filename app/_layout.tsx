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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F1F1EF' } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="kiosk" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="add-student" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="students" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="my-pairing" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="my-qr" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="student/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="edit-profile" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="org-tree" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="org-settings" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="dark" />
        {/* Overlay ON TOP of the Stack: the real destination mounts and loads
            underneath while the intro plays, so the flipboard reveal uncovers
            a ready screen. Unmounts itself when the reveal completes. */}
        {!introDone && <IntroSplash onDone={() => setIntroDone(true)} />}
      </UserProvider>
    </GestureHandlerRootView>
  );
}
