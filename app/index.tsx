import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useUser } from '@/contexts/UserContext';

// The animated intro lives in the root layout as an overlay, so the real
// destination mounts underneath it while the intro plays and the flipboard
// reveal uncovers it. This screen just routes.
export default function Index() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return <View style={styles.loading} />;
  }
  if (user) {
    return <Redirect href="/(tabs)" />;
  }
  return <Redirect href="/(auth)/onboarding" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#165B74' },
});
