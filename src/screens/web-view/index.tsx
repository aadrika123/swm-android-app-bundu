import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  BackHandler,
  ScrollView,
  Linking,
  Text,
  Alert,
  Platform,
  PermissionsAndroid,
  ToastAndroid,
  Button,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import ThermalPrinterModule from 'react-native-thermal-printer';
import Geolocation, {
  GeolocationResponse,
} from '@react-native-community/geolocation';
import { openSettings } from 'react-native-permissions';
import { Base64 } from 'js-base64';
import RNFS from 'react-native-fs';
import {
  requestBluetoothPermission,
  requestCameraPermission,
  requestLocationPermission,
} from '../../utils/permission';
import nfcScannerModule, { NFCTagResult } from '../../utils/NFCScanner';
import rfidScannerModule, { RFIDTagResult } from '../../utils/RFIDScanner';
import { DeviceEventEmitter } from 'react-native';

// Type definitions
type RootStackParamList = {
  WebViewScreen: undefined;
  PermissionComp: undefined;
};

interface WebViewMessage {
  Key: string;
  keyData?: {
    redirectUrl?: string;
    charPerLine?: number;
    printTxt?: string;
    isLoader?: boolean;
    nfcRedirectUrl?: string;
    uhfRedirectUrl?: string;
    uhfPower?: number;
  };
}

interface GeolocationDataWithRedirect extends GeolocationResponse {
  redirectUrl?: string;
}

interface ShouldStartLoadRequest {
  url: string;
  navigationType?: string;
}

const ActivityIndicatorElement: React.FC = () => {
  return (
    <View style={styles.activityIndicatorStyle}>
      <ActivityIndicator color="#838FCE" size="large" />
    </View>
  );
};

const BlueToothConnect = async (): Promise<void> => {
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: 'Bluetooth Permission',
        message: 'This app requires access to your bluetooth.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );
    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      await ThermalPrinterModule.getBluetoothDeviceList();
    }
  } catch (err) {
    ToastAndroid.show('Something went wrong', ToastAndroid.SHORT);
  }
};

export default function WebViewScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const webViewRef = useRef<WebView>(null);

  // UI State
  const [errorLoader, setErrorLoader] = useState<boolean>(true);
  const [loading, setIsLoading] = useState<boolean>(false);
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [_refresherEnabled, setEnableRefresher] = useState<boolean>(true);
  const [_isLoadPage, setIsLoadPage] = useState<boolean>(false);

  // Data State
  const [_currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [geolocationData, setGeolocationData] =
    useState<GeolocationDataWithRedirect | null>(null);
  const [printData, setPrintData] = useState<string | null>(null);
  const [charPerLine, setCharPerLine] = useState<number>(48);

  // NFC State
  const [isNFCInitialized, setIsNFCInitialized] = useState<boolean>(false);
  const [isNFCEnabled, setIsNFCEnabled] = useState<boolean>(false);
  const [isNFCScanning, setIsNFCScanning] = useState<boolean>(false);
  const [nfcRedirectUrl, setNfcRedirectUrl] = useState<string | null>(null);
  const nfcRedirectUrlRef = useRef<string | null>(null);

  // UHF RFID State
  const [uhfPower, setUhfPower] = useState(21);
  const [isUHFInitialized, setIsUHFInitialized] = useState<boolean>(false);
  const [isUHFScanning, setIsUHFScanning] = useState<boolean>(false);
  const isUHFScanningRef = useRef<boolean>(false);
  const uhfRedirectUrlRef = useRef<string | null>(null);
  const [fwVersion, setFwVersion] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      BlueToothConnect();
    }
  }, []);

  // Initialize NFC
  const initializeNFC = useCallback(async (): Promise<void> => {
    try {
      const nfcSupported = await nfcScannerModule.isSupported();
      if (nfcSupported) {
        await nfcScannerModule.initialize();
        setIsNFCInitialized(true);

        const nfcEnabled = await nfcScannerModule.isEnabled();
        setIsNFCEnabled(nfcEnabled);
        console.log('WebView: NFC initialized, enabled:', nfcEnabled);
      }
    } catch (error) {
      console.warn('WebView: NFC initialization failed:', error);
    }
  }, []);

  useEffect(() => {
    initializeNFC();

    return () => {
      nfcScannerModule.stopScan().catch(console.error);
      nfcScannerModule.removeAllListeners();
    };
  }, [initializeNFC]);

  // Initialize UHF RFID
  const initializeUHF = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      await rfidScannerModule.initialize();
      setIsUHFInitialized(true);

      await rfidScannerModule.setPower(uhfPower).catch(() => {});
      const power = await rfidScannerModule.getPower().catch(() => 0);
      if (power > 0) {
        setUhfPower(power);
      }
      const ver = await rfidScannerModule.getVersion().catch(() => '');
      setFwVersion(ver);
    } catch (e: any) {
      setError(e.message || 'Failed to initialize UHF reader');
    } finally {
      setIsLoading(false);
    }
  }, [uhfPower]);

  // Handle UHF tag result — send to WebView
  const handleUHFResult = useCallback((result: RFIDTagResult): void => {
    if (result.success && result.epc) {
      const uhfData = {
        success: true,
        epc: result.epc,
        tid: result.tid || '',
        user: result.user || '',
        rssi: result.rssi || '',
      };

      const currentRedirectUrl = uhfRedirectUrlRef.current;
      if (currentRedirectUrl) {
        const base64 = Base64.encode(JSON.stringify({ uhfData }));
        const newUrl = `${currentRedirectUrl}?response=${base64}`;
        const redirectTo = `window.location = "${newUrl}"`;
        webViewRef.current?.injectJavaScript(redirectTo);
        // Don't clear uhfRedirectUrlRef — keep it so the handheld button works every time
      } else {
        const script = `
          window.dispatchEvent(new CustomEvent('uhf-tag-read', { detail: ${JSON.stringify(
            uhfData,
          )} }));
          true;
        `;
        webViewRef.current?.injectJavaScript(script);
      }
    }
  }, []);

  // UHF initialization + hardware trigger + tag listener
  useEffect(() => {
    initializeUHF();

    const tagListenerSub = rfidScannerModule.addTagListener(handleUHFResult);

    // Hardware trigger button — performs single scan on press
    // Matches the working pattern from the UHF reader screen:
    // just call singleScan() directly, NO re-initialize before each scan.
    const triggerPressedSub = DeviceEventEmitter.addListener(
      'onTriggerPressed',
      () => {
        console.log(
          'WebView: Trigger pressed, scanning:',
          isUHFScanningRef.current,
        );
        if (isUHFScanningRef.current) {
          return;
        }
        isUHFScanningRef.current = true;
        setIsUHFScanning(true);

        // Notify the web page that a hardware-triggered scan has started
        webViewRef.current?.injectJavaScript(
          "window.dispatchEvent(new CustomEvent('uhf-scan-started'));true;",
        );

        rfidScannerModule
          .singleScan()
          .catch(() => false)
          .finally(() => {
            console.log('WebView: Trigger scan finished');
            isUHFScanningRef.current = false;
            setIsUHFScanning(false);
            webViewRef.current?.injectJavaScript(
              "window.dispatchEvent(new CustomEvent('uhf-scan-complete',{detail:{found:true}}));true;",
            );
          });
      },
    );

    return () => {
      triggerPressedSub.remove();
      tagListenerSub.remove();
      // Do NOT call rfidScannerModule.close() here —
      // close() frees the native UART hardware and clears all callbacks.
      // The WebView screen stays mounted for the app's entire lifetime,
      // so freeing the hardware would kill UHF for all subsequent scans.
    };
  }, [initializeUHF, handleUHFResult]);

  // Start UHF Scan (from WebView message)
  const startUHFScan = useCallback(
    async (redirectUrl?: string): Promise<void> => {
      if (!isUHFInitialized) {
        // Try re-initializing before giving up
        try {
          await rfidScannerModule.initialize();
          setIsUHFInitialized(true);
        } catch {
          Alert.alert(
            'UHF Not Available',
            'UHF RFID reader is not available on this device.',
          );
          return;
        }
      }

      try {
        setIsLoading(true);
        setIsUHFScanning(true);
        isUHFScanningRef.current = true;

        if (redirectUrl) {
          uhfRedirectUrlRef.current = redirectUrl;
        }

        // Safety timeout
        const safetyTimer = setTimeout(() => {
          if (isUHFScanningRef.current) {
            isUHFScanningRef.current = false;
            setIsUHFScanning(false);
            setIsLoading(false);
          }
        }, 5000);

        const found = await rfidScannerModule.singleScan();
        clearTimeout(safetyTimer);
        setIsUHFScanning(false);
        isUHFScanningRef.current = false;
        setIsLoading(false);
        if (!found) {
          console.log('WebView: No UHF tag detected');
        }
      } catch (error: any) {
        setIsLoading(false);
        setIsUHFScanning(false);
        isUHFScanningRef.current = false;
        Alert.alert('UHF Error', error.message || 'Failed to scan UHF tag');
      }
    },
    [isUHFInitialized],
  );

  // Stop UHF Scan
  const stopUHFScan = useCallback(async (): Promise<void> => {
    try {
      setIsUHFScanning(false);
      isUHFScanningRef.current = false;
      setIsLoading(false);
      await rfidScannerModule.stopInventory();
    } catch (error) {
      console.warn('WebView: Error stopping UHF scan:', error);
    }
  }, []);

  // ── Power control ──
  const handleSetPower = async (value: number) => {
    const clamped = Math.min(33, Math.max(1, value));
    setUhfPower(clamped);
    await rfidScannerModule.setPower(clamped).catch(() => {});
  };

  // Handle NFC tag callback
  const handleNFCResult = useCallback((result: NFCTagResult): void => {
    setIsNFCScanning(false);
    setIsLoading(false);

    if (result.success && (result.id || result.idHex)) {
      const nfcData = {
        success: true,
        id: result.id,
        idHex: result.idHex,
        techTypes: result.techTypes,
        ndefMessage: result.ndefMessage,
        mifare: result.mifare,
      };

      const base64 = Base64.encode(JSON.stringify({ nfcData }));

      // Use ref to get the current redirect URL (avoids stale closure)
      const currentRedirectUrl = nfcRedirectUrlRef.current;
      if (currentRedirectUrl) {
        const newUrl = `${currentRedirectUrl}?response=${base64}`;
        const redirectTo = `window.location = "${newUrl}"`;
        webViewRef.current?.injectJavaScript(redirectTo);
        nfcRedirectUrlRef.current = null;
        setNfcRedirectUrl(null);
      } else {
        // Send message to WebView
        const script = `
          if (window.onNFCTagRead) {
            window.onNFCTagRead(${JSON.stringify(nfcData)});
          }
          true;
        `;
        webViewRef.current?.injectJavaScript(script);
      }

      nfcScannerModule.stopScan().catch(console.error);
    } else {
      console.log('WebView: NFC scan failed or cancelled:', result.error);
    }
  }, []);

  // Start NFC Scan
  const startNFCScan = useCallback(
    async (redirectUrl?: string): Promise<void> => {
      if (!isNFCInitialized) {
        Alert.alert(
          'NFC Not Available',
          'NFC is not supported on this device.',
        );
        return;
      }

      if (!isNFCEnabled) {
        Alert.alert(
          'NFC Disabled',
          'Please enable NFC in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => nfcScannerModule.goToNfcSettings(),
            },
          ],
        );
        return;
      }

      try {
        setIsLoading(true);
        setIsNFCScanning(true);

        if (redirectUrl) {
          // Set ref synchronously so it's available immediately in the callback
          nfcRedirectUrlRef.current = redirectUrl;
          setNfcRedirectUrl(redirectUrl);
        }

        nfcScannerModule.removeAllListeners();
        nfcScannerModule.addTagListener(handleNFCResult);

        await nfcScannerModule.startScan();
      } catch (error: any) {
        setIsLoading(false);
        setIsNFCScanning(false);
        Alert.alert('NFC Error', error.message || 'Failed to start NFC scan');
      }
    },
    [isNFCInitialized, isNFCEnabled, handleNFCResult],
  );

  // Stop NFC Scan
  const stopNFCScan = useCallback(async (): Promise<void> => {
    try {
      setIsNFCScanning(false);
      setIsLoading(false);
      await nfcScannerModule.stopScan();
    } catch (error) {
      console.warn('WebView: Error stopping NFC scan:', error);
    }
  }, []);

  // Handle scroll
  const handleScroll = (event: any): void => {
    const yOffset = Number(event.nativeEvent.contentOffset.y);
    if (yOffset === 0) {
      setEnableRefresher(true);
    } else {
      setEnableRefresher(false);
    }
  };

  const handleBack = useCallback((): boolean => {
    if (canGoBack && webViewRef.current) {
      webViewRef.current.goBack();
      return true;
    }
    return false;
  }, [canGoBack]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBack,
    );
    return () => {
      backHandler.remove();
    };
  }, [handleBack]);

  function onShouldStartLoadWithRequest(
    request: ShouldStartLoadRequest,
  ): boolean {
    // short circuit these
    if (
      !request.url ||
      request.url.startsWith('http') ||
      request.url.startsWith('/') ||
      request.url.startsWith('#') ||
      request.url.startsWith('javascript') ||
      request.url.startsWith('about:blank') ||
      request.url.startsWith('data:text/html') ||
      request.url.startsWith('data:text/css') ||
      request.url.startsWith('data:text/javascript') ||
      request.url.startsWith('data:text/json') ||
      request.url.startsWith('data:text/plain') ||
      request.url.startsWith('data:text/xml')
    ) {
      return true;
    }

    // blocked blobs
    if (request.url.startsWith('blob')) {
      Alert.alert('Link cannot be opened.');
      return false;
    }

    // list of schemas we will allow the webview
    // to open natively
    if (
      request.url.startsWith('tel:') ||
      request.url.startsWith('mailto:') ||
      request.url.startsWith('maps:') ||
      request.url.startsWith('geo:') ||
      request.url.startsWith('sms:') ||
      request.url.startsWith('whatsapp:') ||
      request.url.startsWith('intent:') ||
      // print
      request.url.startsWith('print:') ||
      request.url.startsWith('print://') ||
      // camera
      request.url.startsWith('camera:')
    ) {
      Linking.openURL(request.url).catch(er => {
        Alert.alert('Failed to open Link: ' + er.message);
      });
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (geolocationData) {
      const base64 = Base64.encode(JSON.stringify({ geolocationData }));
      const newUrl = `${geolocationData?.redirectUrl}?response=${base64}`;
      const redirectTo = 'window.location = "' + newUrl + '"';
      webViewRef.current?.injectJavaScript(`${redirectTo}`);
      setGeolocationData(null);
    }
  }, [geolocationData]);

  const PrintForBTPrinter = async (): Promise<void> => {
    if (printData !== null) {
      try {
        await ThermalPrinterModule.printBluetooth({
          payload: printData,
          printerNbrCharactersPerLine: charPerLine,
        });
        setPrintData(null);
      } catch (err: any) {
        ToastAndroid.show(err.message, ToastAndroid.SHORT);
        setPrintData(null);
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (printData) {
      PrintForBTPrinter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printData]);

  useEffect(() => {
    setTimeout(() => {
      setErrorLoader(false);
    }, 10000); // 10 seconds
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          flex: 1,
        }}
        // refreshControl={
        //   <RefreshControl
        //     refreshing={refreshing}
        //     enabled={refresherEnabled}
        //     onRefresh={() => {
        //       webView.current?.reload();
        //       setIsLoading(false);
        //     }}
        //   />
        // }
      >
        <WebView
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
          // onLoadingStart={() => {
          //   if (isLoadPage) {
          //     setIsLoading(true);
          //   }
          // }}

          onLoadEnd={() => {
            setIsLoading(false);
            setIsLoadPage(false);
          }}
          startInLoadingState={true}
          javaScriptCanOpenWindowsAutomatically={true}
          style={{ flex: 1 }}
          bounces={false}
          renderLoading={() => <ActivityIndicatorElement />}
          originWhitelist={['*']}
          source={{
            uri: 'https://rmsw.co.in/bundu-swm/web/pages',
            // uri: 'http://172.18.1.111/Old-SWM-PHP-Project/web/pages/index.php',
          }}
          scalesPageToFit={true}
          geolocationEnabled={true}
          javaScriptEnabled={true}
          allowFileAccess={true}
          domStorageEnabled={true}
          useWebView2
          allowFileAccessFromFileURLs={true}
          thirdPartyCookiesEnabled={true}
          ref={webViewRef}
          onFileDownload={(event: any) => {
            // download from my website and save to device storage here

            const url =
              event.nativeEvent?.downloadUrl || event.nativeEvent?.url || '';
            const fileName = url.split('/').pop() || 'download';

            const fileDest = `${RNFS.ExternalStorageDirectoryPath}/Download/${fileName}`;
            const options = {
              fromUrl: url,
              toFile: fileDest,
            };
            RNFS.downloadFile(options)
              .promise.then(() => {
                console.log('File downloaded successfully');
                console.log('File saved to ', fileDest);
              })
              .catch(err => {
                console.log(err.message, err.code);
              });
          }}
          onNavigationStateChange={navState => {
            setCurrentUrl(navState.url);
          }}
          onLoadProgress={event => setCanGoBack(event.nativeEvent.canGoBack)}
          sharedCookiesEnabled={true}
          allowUniversalAccessFromFileURLs={true}
          cacheEnabled
          onScroll={event => handleScroll(event)}
          onMessage={async (event: WebViewMessageEvent) => {
            const message: WebViewMessage = JSON.parse(event.nativeEvent.data);
            if (message?.Key === 'RELOAD') {
              webViewRef.current?.reload();
            } else if (message?.Key === 'GEO_LOCATION') {
              setIsLoading(true);
              Geolocation.getCurrentPosition(
                (position: GeolocationResponse) => {
                  setGeolocationData({
                    ...message?.keyData, // pass data from webview
                    ...position,
                  } as GeolocationDataWithRedirect);
                  setIsLoading(false);
                },
                error => {
                  console.log('error', error);
                  Alert.alert('Error', error?.message, [
                    {
                      text: 'OK',
                    },
                  ]);
                  setIsLoading(false);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
              );
            } else if (message?.Key === 'OPEN_CAMERA') {
              setIsLoading(true);
              await requestCameraPermission();
              setIsLoading(false);
            } else if (message?.Key === 'OPEN_LOCATION') {
              setIsLoading(true);
              await requestLocationPermission();
              setIsLoading(false);
            } else if (message?.Key === 'OPEN_BLUETOOTH') {
              setIsLoading(true);
              await requestBluetoothPermission();
              setIsLoading(false);
            } else if (message?.Key === 'OPEN_SETTINGS') {
              setIsLoading(true);
              await openSettings();
              setIsLoading(false);
            } else if (message?.Key === 'PERMISSION_SCREEN') {
              navigation.navigate('PermissionComp');
            } else if (message?.Key === 'PRINT_FOR_BT_PRINTER') {
              setIsLoading(true);
              setCharPerLine(message?.keyData?.charPerLine ?? 48);
              setPrintData(message?.keyData?.printTxt ?? null);
            } else if (message?.Key === 'HREF_PAGE') {
              setIsLoading(message?.keyData?.isLoader || false);
            } else if (message?.Key === 'START_NFC_SCAN') {
              // Handle NFC scan request from WebView
              console.log(
                'WebView: Received START_NFC_SCAN message with data:',
              );
              startNFCScan(message?.keyData?.nfcRedirectUrl);
            } else if (message?.Key === 'STOP_NFC_SCAN') {
              // Handle NFC scan stop request from WebView
              stopNFCScan();
            } else if (message?.Key === 'CHECK_NFC_STATUS') {
              // Send NFC status back to WebView
              const nfcStatus = {
                isSupported: isNFCInitialized,
                isEnabled: isNFCEnabled,
                isScanning: isNFCScanning,
              };
              const script = `
                if (window.onNFCStatusResponse) {
                  window.onNFCStatusResponse(${JSON.stringify(nfcStatus)});
                }
                true;
              `;
              webViewRef.current?.injectJavaScript(script);
            } else if (message?.Key === 'SET_UHF_REDIRECT_URL') {
              // Web page sets the redirect URL — handheld button will navigate here on every scan
              const url =
                message?.keyData?.uhfRedirectUrl ||
                message?.keyData?.redirectUrl;
              if (url) {
                uhfRedirectUrlRef.current = url;
                console.log('WebView: UHF redirect URL set to:', url);
              }
            } else if (message?.Key === 'CLEAR_UHF_REDIRECT_URL') {
              uhfRedirectUrlRef.current = null;
              console.log('WebView: UHF redirect URL cleared');
            } else if (message?.Key === 'START_UHF_SCAN') {
              // Handle UHF scan request from WebView
              console.log('WebView: Received START_UHF_SCAN message');
              startUHFScan(
                message?.keyData?.uhfRedirectUrl ||
                  message?.keyData?.nfcRedirectUrl,
              );
            } else if (message?.Key === 'STOP_UHF_SCAN') {
              // Handle UHF scan stop request from WebView
              stopUHFScan();
            } else if (message?.Key === 'CHECK_UHF_STATUS') {
              // Send UHF status back to WebView
              const uhfStatus = {
                isAvailable: isUHFInitialized,
                isScanning: isUHFScanning,
              };
              const script = `
                if (window.onUHFStatusResponse) {
                  window.onUHFStatusResponse(${JSON.stringify(uhfStatus)});
                }
                true;
              `;
              webViewRef.current?.injectJavaScript(script);
            } else if (message?.Key === 'SET_UHF_POWER') {
              const power = message?.keyData?.uhfPower;
              if (typeof power === 'number') {
                handleSetPower(power);
              }
            } else if (message?.Key === 'INITIALIZE_UHF') {
              initializeUHF();
            }
          }}
          onError={() => {
            webViewRef.current?.goBack();
          }}
          showsVerticalScrollIndicator={false}
          setSupportMultipleWindows={true}
          onShouldStartLoadWithRequest={event =>
            onShouldStartLoadWithRequest(event)
          }
          // renderError={
          //   (errorName, errorDescription, errorDomain) => (
          //     <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
          //       <Text style={{fontSize: 20, fontWeight: 'bold'}}>Error</Text>
          //       <Text>{errorName}</Text>
          //       <Text>{errorDescription}</Text>
          //       <Text>{errorDomain}</Text>
          //     </View>
          //   )
          // }

          renderError={() => {
            if (errorLoader) {
              return <ActivityIndicatorElement />;
            } else {
              return (
                <View
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'white',
                    width: '100%',
                    height: '100%',
                    position: 'absolute',
                  }}
                >
                  <Text>Oops! Something went wrong.</Text>
                  <Text>Check your internet connection.</Text>
                  <Button
                    color={'#838FCE'}
                    title="Reload"
                    onPress={() => webViewRef.current?.reload()}
                  />
                </View>
              );
            }
          }}
        />
        {loading ? <ActivityIndicatorElement /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // backgroundColor: '#FFFFFF',
    flex: 1,
  },
  activityIndicatorStyle: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    position: 'absolute',
    marginLeft: 'auto',
    marginRight: 'auto',
    marginTop: 'auto',
    marginBottom: 'auto',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  ScrollStyle: {
    backgroundColor: 'white',
    position: 'relative',
  },
});
