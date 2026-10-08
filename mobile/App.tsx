import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

// Production FluxFox web app URL. Override for local/staging builds via the
// EXPO_PUBLIC_WEBAPP_URL environment variable (see .env.example).
const WEBAPP_URL =
  process.env.EXPO_PUBLIC_WEBAPP_URL ?? 'https://fluxfox.app';

// Locks the viewport to disable pinch-to-zoom and double-tap scaling so the
// wrapped web app feels indistinguishable from a native screen.
const DISABLE_ZOOM_SCRIPT = `
  (function () {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content =
      'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no';
    document.getElementsByTagName('head')[0].appendChild(meta);
  })();
  true;
`;

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <WebView
          source={{ uri: WEBAPP_URL }}
          style={styles.webview}
          injectedJavaScript={DISABLE_ZOOM_SCRIPT}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          allowsBackForwardNavigationGestures
          decelerationRate="normal"
          originWhitelist={['https://*']}
          setSupportMultipleWindows={false}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const ZINC_950 = '#09090b';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: ZINC_950,
  },
  webview: {
    flex: 1,
    backgroundColor: ZINC_950,
  },
});
