/**
 * QR / Barcode + NFC Demo Screen with Log
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
  Alert,
  ActivityIndicator,
  ScrollView,
  DeviceEventEmitter,
} from 'react-native';
import barcodeScannerModule, {ScanResult} from '../../utils/BarcodeScanner';
import nfcScannerModule, {NFCTagResult} from '../../utils/NFCScanner';

// ── Types ──

type TabMode = 'qr' | 'nfc';

interface LogEntry {
  id: string;
  timestamp: Date;
  source: 'QR' | 'NFC';
  message: string;
  data?: string;
  success: boolean;
}

// ── Component ──

export default function QRNfc(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabMode>('qr');

  // QR state
  const [qrInitialized, setQrInitialized] = useState(false);
  const [qrScanning, setQrScanning] = useState(false);
  const [qrResults, setQrResults] = useState<ScanResult[]>([]);

  // NFC state
  const [nfcSupported, setNfcSupported] = useState(false);
  const [nfcEnabled, setNfcEnabled] = useState(false);
  const [nfcInitialized, setNfcInitialized] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);
  const [nfcResults, setNfcResults] = useState<NFCTagResult[]>([]);

  // Shared
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const activeTabRef = useRef<TabMode>('qr');
  const qrScanningRef = useRef(false);
  const nfcScanningRef = useRef(false);

  // ── Helpers ──

  const addLog = useCallback(
    (
      source: 'QR' | 'NFC',
      message: string,
      success: boolean,
      data?: string,
    ) => {
      logIdRef.current += 1;
      const entry: LogEntry = {
        id: String(logIdRef.current),
        timestamp: new Date(),
        source,
        message,
        data,
        success,
      };
      setLogs(prev => [entry, ...prev]);
    },
    [],
  );

  // ── Init ──

  const initScanners = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // QR / Barcode init
    try {
      if (barcodeScannerModule.isAvailable()) {
        await barcodeScannerModule.initialize();
        setQrInitialized(true);
        addLog('QR', 'Barcode scanner initialized', true);
      } else {
        addLog('QR', 'Barcode scanner not available on this device', false);
      }
    } catch (e: any) {
      addLog('QR', `Init failed: ${e.message}`, false);
    }

    // NFC init
    try {
      const supported = await nfcScannerModule.isSupported();
      setNfcSupported(supported);
      if (supported) {
        const enabled = await nfcScannerModule.isEnabled();
        setNfcEnabled(enabled);
        if (enabled) {
          await nfcScannerModule.initialize();
          setNfcInitialized(true);
          addLog('NFC', 'NFC manager initialized', true);
        } else {
          addLog(
            'NFC',
            'NFC is disabled — enable it in device settings',
            false,
          );
        }
      } else {
        addLog('NFC', 'NFC not supported on this device', false);
      }
    } catch (e: any) {
      addLog('NFC', `Init failed: ${e.message}`, false);
    }

    setIsLoading(false);
  }, [addLog]);

  useEffect(() => {
    initScanners();

    // Barcode listener
    const barcodeSub = barcodeScannerModule.addScanListener(
      (result: ScanResult) => {
        if (result.success && result.data) {
          setQrResults(prev => [result, ...prev]);
          addLog('QR', `Scanned: ${result.data}`, true, result.type);
        } else if (result.error) {
          addLog('QR', result.error, false);
        }
      },
    );

    // NFC listener
    const nfcSub = nfcScannerModule.addTagListener((result: NFCTagResult) => {
      if (result.success) {
        setNfcResults(prev => [result, ...prev]);
        const ndefText =
          result.ndefMessage?.map(r => r.payload).join(', ') || '';
        const detail = [
          result.idHex ? `ID: ${result.idHex}` : '',
          result.mifare?.type ? `Type: ${result.mifare.type}` : '',
          ndefText ? `NDEF: ${ndefText}` : '',
        ]
          .filter(Boolean)
          .join(' | ');
        addLog('NFC', `Tag read`, true, detail);
      } else {
        addLog('NFC', result.error || 'Unknown error', false);
      }
    });

    // Hardware trigger button
    const triggerPressedSub = DeviceEventEmitter.addListener(
      'onTriggerPressed',
      () => {
        if (activeTabRef.current === 'qr') {
          if (!qrScanningRef.current) {
            qrScanningRef.current = true;
            setQrScanning(true);
            barcodeScannerModule.startScan().catch(() => {
              qrScanningRef.current = false;
              setQrScanning(false);
            });
          }
        } else {
          if (!nfcScanningRef.current) {
            nfcScanningRef.current = true;
            setNfcScanning(true);
            nfcScannerModule.startScan().catch(() => {
              nfcScanningRef.current = false;
              setNfcScanning(false);
            });
          }
        }
      },
    );

    const triggerReleasedSub = DeviceEventEmitter.addListener(
      'onTriggerReleased',
      () => {
        if (activeTabRef.current === 'qr') {
          if (qrScanningRef.current) {
            barcodeScannerModule.stopScan().catch(() => {});
            qrScanningRef.current = false;
            setQrScanning(false);
          }
        } else {
          if (nfcScanningRef.current) {
            nfcScannerModule.stopScan().catch(() => {});
            nfcScanningRef.current = false;
            setNfcScanning(false);
          }
        }
      },
    );

    return () => {
      barcodeSub.remove();
      nfcSub.remove();
      triggerPressedSub.remove();
      triggerReleasedSub.remove();
      barcodeScannerModule.close().catch(() => {});
      nfcScannerModule.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── QR Actions ──

  const handleStartQrScan = async () => {
    try {
      setQrScanning(true);
      qrScanningRef.current = true;
      await barcodeScannerModule.startScan();
      addLog('QR', 'Scan started', true);
    } catch (e: any) {
      setQrScanning(false);
      qrScanningRef.current = false;
      addLog('QR', `Start failed: ${e.message}`, false);
      Alert.alert('Error', e.message);
    }
  };

  const handleStopQrScan = async () => {
    await barcodeScannerModule.stopScan().catch(() => {});
    setQrScanning(false);
    qrScanningRef.current = false;
    addLog('QR', 'Scan stopped', true);
  };

  const handleClearQr = () => {
    setQrResults([]);
  };

  // ── NFC Actions ──

  const handleStartNfcScan = async () => {
    try {
      setNfcScanning(true);
      nfcScanningRef.current = true;
      await nfcScannerModule.startScan();
      addLog('NFC', 'Scan started — hold tag near device', true);
    } catch (e: any) {
      setNfcScanning(false);
      nfcScanningRef.current = false;
      addLog('NFC', `Start failed: ${e.message}`, false);
      Alert.alert('Error', e.message);
    }
  };

  const handleStopNfcScan = async () => {
    await nfcScannerModule.stopScan().catch(() => {});
    setNfcScanning(false);
    nfcScanningRef.current = false;
    addLog('NFC', 'Scan stopped', true);
  };

  const handleClearNfc = () => {
    setNfcResults([]);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  // ── Render helpers ──

  const renderQrItem = ({item, index}: {item: ScanResult; index: number}) => (
    <View style={styles.tagCard}>
      <View style={styles.tagHeader}>
        <Text style={styles.tagEpcLabel}>
          BARCODE / QR #{qrResults.length - index}
        </Text>
        {item.type ? <Text style={styles.tagCount}>{item.type}</Text> : null}
      </View>
      <Text style={styles.tagEpc} selectable>
        {item.data}
      </Text>
    </View>
  );

  const renderNfcItem = ({
    item,
    index,
  }: {
    item: NFCTagResult;
    index: number;
  }) => (
    <View style={styles.tagCard}>
      <View style={styles.tagHeader}>
        <Text style={styles.tagEpcLabel}>
          NFC TAG #{nfcResults.length - index}
        </Text>
        {item.mifare?.type ? (
          <Text style={styles.tagCount}>{item.mifare.type}</Text>
        ) : null}
      </View>
      {item.idHex ? (
        <Text style={styles.tagEpc} selectable>
          ID: {item.idHex}
        </Text>
      ) : null}
      {item.id && item.id !== item.idHex ? (
        <Text style={styles.tagMeta}>Dec: {item.id}</Text>
      ) : null}
      {item.techTypes && item.techTypes.length > 0 ? (
        <Text style={styles.tagMeta}>
          Tech: {item.techTypes.map(t => t.split('.').pop()).join(', ')}
        </Text>
      ) : null}
      {item.mifare?.size ? (
        <Text style={styles.tagMeta}>
          Size: {item.mifare.size} bytes | Sectors: {item.mifare.sectorCount} |
          Blocks: {item.mifare.blockCount}
        </Text>
      ) : null}
      {item.ndefMessage && item.ndefMessage.length > 0
        ? item.ndefMessage.map((rec, i) => (
            <Text key={i} style={styles.ndefPayload} selectable>
              NDEF: {rec.payload}
            </Text>
          ))
        : null}
    </View>
  );

  const renderLog = ({item}: {item: LogEntry}) => (
    <View style={styles.logRow}>
      <Text style={styles.logTime}>{item.timestamp.toLocaleTimeString()}</Text>
      <Text
        style={[
          styles.logBadge,
          item.source === 'QR' ? styles.logBadgeQr : styles.logBadgeNfc,
        ]}>
        {item.source}
      </Text>
      <View style={styles.logBody}>
        <Text
          style={[styles.logMsg, !item.success && styles.logMsgError]}
          numberOfLines={2}>
          {item.message}
        </Text>
        {item.data ? (
          <Text style={styles.logData} numberOfLines={1}>
            {item.data}
          </Text>
        ) : null}
      </View>
    </View>
  );

  // ── Loading / Error ──

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0f0f23" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#f72585" />
          <Text style={styles.loadingText}>Initializing scanners...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0f0f23" />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={initScanners}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f23" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>QR / NFC Demo</Text>
        <Text style={styles.headerSub}>
          QR:{' '}
          <Text style={{color: qrInitialized ? '#10b981' : '#ef4444'}}>
            {qrInitialized ? 'Ready' : 'N/A'}
          </Text>
          {'   '}NFC:{' '}
          <Text style={{color: nfcInitialized ? '#10b981' : '#ef4444'}}>
            {nfcInitialized
              ? 'Ready'
              : nfcSupported
              ? nfcEnabled
                ? 'Error'
                : 'Disabled'
              : 'N/A'}
          </Text>
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['qr', 'nfc'] as TabMode[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => {
              setActiveTab(tab);
              activeTabRef.current = tab;
            }}>
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText,
              ]}>
              {tab === 'qr' ? 'QR / Barcode' : 'NFC'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ════════ QR TAB ════════ */}
      {activeTab === 'qr' && (
        <View style={styles.body}>
          {/* Actions */}
          <View style={styles.actionRow}>
            {qrScanning ? (
              <TouchableOpacity
                style={[styles.actionBtn, styles.stopBtn]}
                onPress={handleStopQrScan}>
                <Text style={styles.actionBtnText}>Stop Scan</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.startBtn,
                  !qrInitialized && styles.disabledBtn,
                ]}
                onPress={handleStartQrScan}
                disabled={!qrInitialized}>
                <Text style={styles.actionBtnText}>Start Scan</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.clearBtn]}
              onPress={handleClearQr}>
              <Text style={styles.actionBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <Text style={styles.statItem}>
              Scans: <Text style={styles.statValue}>{qrResults.length}</Text>
            </Text>
            {qrScanning && <ActivityIndicator size="small" color="#f72585" />}
          </View>

          {/* Results */}
          {qrResults.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Press "Start Scan" to begin barcode / QR scanning
              </Text>
            </View>
          ) : (
            <FlatList
              data={qrResults}
              renderItem={renderQrItem}
              keyExtractor={(_, i) => String(i)}
              style={styles.tagList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      {/* ════════ NFC TAB ════════ */}
      {activeTab === 'nfc' && (
        <View style={styles.body}>
          {/* Actions */}
          <View style={styles.actionRow}>
            {nfcScanning ? (
              <TouchableOpacity
                style={[styles.actionBtn, styles.stopBtn]}
                onPress={handleStopNfcScan}>
                <Text style={styles.actionBtnText}>Stop Scan</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.startBtn,
                  !nfcInitialized && styles.disabledBtn,
                ]}
                onPress={handleStartNfcScan}
                disabled={!nfcInitialized}>
                <Text style={styles.actionBtnText}>Start Scan</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.clearBtn]}
              onPress={handleClearNfc}>
              <Text style={styles.actionBtnText}>Clear</Text>
            </TouchableOpacity>
            {nfcSupported && !nfcEnabled && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.settingsBtn]}
                onPress={() => nfcScannerModule.goToNfcSettings()}>
                <Text style={styles.actionBtnText}>NFC Settings</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <Text style={styles.statItem}>
              Tags: <Text style={styles.statValue}>{nfcResults.length}</Text>
            </Text>
            {nfcScanning && <ActivityIndicator size="small" color="#f72585" />}
          </View>

          {/* Results */}
          {nfcResults.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Press "Start Scan" and hold an NFC tag near the device
              </Text>
            </View>
          ) : (
            <FlatList
              data={nfcResults}
              renderItem={renderNfcItem}
              keyExtractor={(_, i) => String(i)}
              style={styles.tagList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      {/* ════════ LOG PANEL ════════ */}
      <View style={styles.logPanel}>
        <View style={styles.logHeader}>
          <Text style={styles.logTitle}>Log ({logs.length})</Text>
          <TouchableOpacity onPress={handleClearLogs}>
            <Text style={styles.logClearText}>Clear</Text>
          </TouchableOpacity>
        </View>
        {logs.length === 0 ? (
          <Text style={styles.logEmpty}>No log entries yet</Text>
        ) : (
          <FlatList
            data={logs}
            renderItem={renderLog}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0f0f23'},
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {marginTop: 16, fontSize: 16, color: '#a0a0a0'},
  errorIcon: {fontSize: 48, color: '#ff6b6b', marginBottom: 12},
  errorText: {
    fontSize: 16,
    color: '#ff6b6b',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: '#f72585',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},

  // Header
  header: {paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center'},
  headerTitle: {fontSize: 22, fontWeight: 'bold', color: '#fff'},
  headerSub: {fontSize: 12, color: '#6b7280', marginTop: 4},

  // Tabs
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 3,
  },
  tab: {flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10},
  activeTab: {backgroundColor: '#f72585'},
  tabText: {fontSize: 13, fontWeight: '600', color: '#6b7280'},
  activeTabText: {color: '#fff'},

  // Body
  body: {flex: 1, paddingHorizontal: 12},

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 8,
  },
  actionBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 2,
  },
  actionBtnText: {color: '#fff', fontSize: 14, fontWeight: '700'},
  startBtn: {backgroundColor: '#f72585'},
  stopBtn: {backgroundColor: '#ef4444', paddingHorizontal: 32},
  clearBtn: {backgroundColor: '#374151'},
  settingsBtn: {backgroundColor: '#1e3a5f'},
  disabledBtn: {opacity: 0.4},

  // Stats
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  statItem: {color: '#9ca3af', fontSize: 13},
  statValue: {color: '#fff', fontWeight: '700'},

  // Tag / result cards
  tagList: {flex: 1},
  tagCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#f72585',
  },
  tagHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  tagEpcLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#f72585',
    letterSpacing: 1,
  },
  tagCount: {fontSize: 11, color: '#a78bfa', fontWeight: '700'},
  tagEpc: {
    fontSize: 14,
    color: '#fff',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  tagMeta: {fontSize: 11, color: '#6b7280', fontFamily: 'monospace'},
  ndefPayload: {
    fontSize: 13,
    color: '#10b981',
    fontFamily: 'monospace',
    marginTop: 4,
  },

  // Empty
  emptyBox: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  emptyText: {fontSize: 14, color: '#6b7280', textAlign: 'center'},

  // Log panel
  logPanel: {
    height: 180,
    backgroundColor: '#101020',
    borderTopWidth: 1,
    borderTopColor: '#2d2d44',
    paddingHorizontal: 10,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  logTitle: {fontSize: 13, fontWeight: '700', color: '#9ca3af'},
  logClearText: {fontSize: 12, color: '#f72585', fontWeight: '600'},
  logEmpty: {
    fontSize: 12,
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 20,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e36',
  },
  logTime: {
    fontSize: 10,
    color: '#4b5563',
    fontFamily: 'monospace',
    width: 72,
    marginTop: 2,
  },
  logBadge: {
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 6,
    marginTop: 1,
  },
  logBadgeQr: {backgroundColor: '#7209b7', color: '#fff'},
  logBadgeNfc: {backgroundColor: '#0891b2', color: '#fff'},
  logBody: {flex: 1},
  logMsg: {fontSize: 12, color: '#d1d5db'},
  logMsgError: {color: '#ef4444'},
  logData: {fontSize: 10, color: '#6b7280', fontFamily: 'monospace'},
});
