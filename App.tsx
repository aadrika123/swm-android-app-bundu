//////////////////////////////////////////////////////////////////////////////////////
//    Author - Imran Alam
//    Version - 1.0
//    Date - 10 March 2026
//    Revision - 1
//    Project - Solid Waste Management System
//    DESCRIPTION - This is the main entry point of the React Native application for the Solid Waste Management System. It sets up the navigation structure, handles permissions, and displays a splash screen while loading. The app includes screens for web view, UHF reader, QR/NFC scanning, and details display. The navigation is implemented using React Navigation with a stack navigator. The app also requests necessary permissions for Bluetooth, camera, and location access on startup.
//////////////////////////////////////////////////////////////////////////////////////

import { Image, SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import WebViewScreen from './src/screens/web-view';
import UHFReader from './src/screens/uhf-reader';
import QRNFC from './src/screens/qr-nfc';
import Details from './src/screens/details';
import {
  createStaticNavigation,
  StaticParamList,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import launch_splash from './assets/splah_screen.png';
import React, { useEffect } from 'react';
import {
  requestBluetoothPermission,
  requestCameraPermission,
  requestLocationPermission,
} from './src/utils/permission';

const RootStack = createNativeStackNavigator({
  initialRouteName: 'WebViewScreen',
  // close the header for all screens
  screenOptions: {
    headerShown: false,
  },
  screens: {
    Details: Details,
    WebViewScreen: WebViewScreen,
    UHFReader: UHFReader,
    QRNFC: QRNFC,
  },
});

const Navigation = createStaticNavigation(RootStack);

type RootStackParamList = StaticParamList<typeof RootStack>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

function App(): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [permissionsGranted, setPermissionsGranted] = React.useState(false);

  useEffect(() => {
    if (!permissionsGranted) {
      requestBluetoothPermission();
      requestCameraPermission();
      requestLocationPermission();
    }
  }, [permissionsGranted]);

  React.useEffect(() => {
    setTimeout(async () => {
      setLoading(false);
    }, 3000);
  }, []);

  if (loading) {
    return (
      <Image
        source={launch_splash}
        style={{
          width: '100%',
          height: '100%',
          resizeMode: 'cover',
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <Navigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
});

export default App;
