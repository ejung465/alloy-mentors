import { useState } from 'react';
import { Redirect } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useUser } from '@/contexts/UserContext';
import { IntroSplash } from '@/components/ui/IntroSplash';

const PINE = '#165B74';

export default function Index() {
  const { user, isLoading } = useUser();
  const [introDone, setIntroDone] = useState(false);

  if (!introDone || isLoading) {
    return (
      <View style={styles.loading}>
        {!introDone && <IntroSplash onDone={() => setIntroDone(true)} />}
      </View>
    );
  }

  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/onboarding" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: PINE,
  },
});
