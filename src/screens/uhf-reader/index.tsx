/**
 * UHF RFID Demo — Chainway UART SDK
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  TextInput,
  DeviceEventEmitter,
  Button,
} from 'react-native';
import rfidScannerModule, {
  RFIDTagResult,
  UHF_BANK,
} from '../../utils/RFIDScanner';

import { useNavigation } from '@react-navigation/native';

interface TagItem {
  id: string;
  epc: string;
  tid: string;
  user: string;
  rssi: string;
  count: number;
  timestamp: Date;
}

type TabMode = 'inventory' | 'read' | 'write' | 'settings';

function App(): React.JSX.Element {
  const navigation = useNavigation();

  // ── State ──
  const [activeTab, setActiveTab] = useState<TabMode>('inventory');
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [totalReads, setTotalReads] = useState(0);
  const [uhfPower, setUhfPower] = useState(20);
  const [fwVersion, setFwVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const [elapsedTime, setElapsedTime] = useState('0.0s');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isScanningRef = useRef(false);

  // Read/Write state
  const [rwPassword, setRwPassword] = useState('00000000');
  const [rwBank, setRwBank] = useState(UHF_BANK.EPC);
  const [rwPtr, setRwPtr] = useState('2');
  const [rwLen, setRwLen] = useState('6');
  const [readResult, setReadResult] = useState('');
  const [writeData, setWriteData] = useState('');
  const [rwBusy, setRwBusy] = useState(false);

  // Settings state
  const [freqMode, setFreqMode] = useState(-1);
  const [rfLink, setRfLink] = useState(-1);

  // ── Initialize ──
  const initReader = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      await rfidScannerModule.initialize();
      setIsInitialized(true);

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
  }, []);

  useEffect(() => {
    initReader();

    rfidScannerModule.addTagListener((result: RFIDTagResult) => {
      if (result.success && result.epc) {
        const epc = result.epc!;
        setTags(prev => {
          const idx = prev.findIndex(t => t.epc === epc);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              rssi: result.rssi || updated[idx].rssi,
              tid: result.tid || updated[idx].tid,
              user: result.user || updated[idx].user,
              count: updated[idx].count + 1,
              timestamp: new Date(),
            };
            return updated;
          }
          return [
            {
              id: Date.now().toString() + Math.random(),
              epc,
              tid: result.tid || '',
              user: result.user || '',
              rssi: result.rssi || '',
              count: 1,
              timestamp: new Date(),
            },
            ...prev,
          ];
        });
        setTotalReads(prev => prev + 1);
      }
    });

    // Hardware trigger button — performs single scan on press
    const triggerPressedSub = DeviceEventEmitter.addListener(
      'onTriggerPressed',
      () => {
        if (!isScanningRef.current) {
          setIsScanning(true);
          isScanningRef.current = true;
          rfidScannerModule
            .singleScan()
            .catch(() => false)
            .finally(() => {
              setIsScanning(false);
              isScanningRef.current = false;
            });
        }
      },
    );

    return () => {
      stopTimer();
      triggerPressedSub.remove();
      rfidScannerModule.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Timer ──
  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setElapsedTime(elapsed.toFixed(1) + 's');
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // ── Inventory ──
  const handleStartInventory = async () => {
    try {
      setIsScanning(true);
      isScanningRef.current = true;
      startTimer();
      await rfidScannerModule.startInventory();
    } catch (e: any) {
      setIsScanning(false);
      isScanningRef.current = false;
      stopTimer();
      Alert.alert('Error', e.message || 'Failed to start inventory');
    }
  };

  const handleStopInventory = async () => {
    await rfidScannerModule.stopInventory().catch(() => {});
    setIsScanning(false);
    isScanningRef.current = false;
    stopTimer();
  };

  const handleSingleScan = async () => {
    setIsScanning(true);
    startTimer();
    const found = await rfidScannerModule.singleScan().catch(() => false);
    setIsScanning(false);
    stopTimer();
    if (!found) {
      Alert.alert('No Tag', 'No UHF tag detected.');
    }
  };

  const handleClear = () => {
    setTags([]);
    setTotalReads(0);
    setElapsedTime('0.0s');
  };

  // ── Power control ──
  const handleSetPower = async (value: number) => {
    const clamped = Math.min(33, Math.max(1, value));
    setUhfPower(clamped);
    await rfidScannerModule.setPower(clamped).catch(() => {});
  };

  // ── Read/Write ──
  const handleRead = async () => {
    try {
      setRwBusy(true);
      setReadResult('');
      const data = await rfidScannerModule.readData(
        rwPassword,
        rwBank,
        parseInt(rwPtr, 10) || 0,
        parseInt(rwLen, 10) || 6,
      );
      setReadResult(data || '(empty / no response)');
    } catch (e: any) {
      Alert.alert('Read Error', e.message);
    } finally {
      setRwBusy(false);
    }
  };

  const handleWrite = async () => {
    if (!writeData.trim()) {
      Alert.alert('Error', 'Enter hex data to write');
      return;
    }
    try {
      setRwBusy(true);
      const ok = await rfidScannerModule.writeData(
        rwPassword,
        rwBank,
        parseInt(rwPtr, 10) || 0,
        parseInt(rwLen, 10) || 6,
        writeData.trim(),
      );
      Alert.alert(
        ok ? 'Success' : 'Failed',
        ok ? 'Data written.' : 'Write failed.',
      );
    } catch (e: any) {
      Alert.alert('Write Error', e.message);
    } finally {
      setRwBusy(false);
    }
  };

  // ── Settings ──
  const loadSettings = async () => {
    const fm = await rfidScannerModule.getFrequencyMode().catch(() => -1);
    setFreqMode(fm);
    const rl = await rfidScannerModule.getRFLink().catch(() => -1);
    setRfLink(rl);
  };

  const handleSetEPCMode = async () => {
    const ok = await rfidScannerModule.setEPCMode().catch(() => false);
    Alert.alert(ok ? 'Done' : 'Failed', ok ? 'EPC-only mode set' : 'Failed');
  };

  const handleSetEPCTIDMode = async () => {
    const ok = await rfidScannerModule.setEPCAndTIDMode().catch(() => false);
    Alert.alert(ok ? 'Done' : 'Failed', ok ? 'EPC+TID mode set' : 'Failed');
  };

  const switchTab = async (tab: TabMode) => {
    if (isScanning) {
      await handleStopInventory();
    }
    setActiveTab(tab);
    if (tab === 'settings') {
      loadSettings();
    }
  };

  const bankLabel = (b: number) =>
    b === 0 ? 'RES' : b === 1 ? 'EPC' : b === 2 ? 'TID' : 'USER';

  // ── Render tag item ──
  const renderTag = ({ item }: { item: TagItem }) => (
    <View style={styles.tagCard}>
      <View style={styles.tagHeader}>
        <Text style={styles.tagEpcLabel}>EPC</Text>
        <Text style={styles.tagCount}>x{item.count}</Text>
      </View>
      <Text style={styles.tagEpc} selectable>
        {item.epc}
      </Text>
      {item.tid ? <Text style={styles.tagMeta}>TID: {item.tid}</Text> : null}
      {item.user ? <Text style={styles.tagMeta}>USER: {item.user}</Text> : null}
      <View style={styles.tagFooter}>
        <Text style={styles.tagRssi}>RSSI: {item.rssi || '--'} dBm</Text>
        <Text style={styles.tagTime}>
          {item.timestamp.toLocaleTimeString()}
        </Text>
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
          <Text style={styles.loadingText}>Initializing UHF Reader...</Text>
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
          <TouchableOpacity style={styles.retryBtn} onPress={initReader}>
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
        <Text style={styles.headerTitle}>UHF RFID Demo</Text>
        <Button title="Details" onPress={() => navigation.navigate('QRNFC')} />
        <Text style={[styles.headerSub, isInitialized && { color: '#10b981' }]}>
          {isInitialized ? 'Connected' : 'Disconnected'}
          {fwVersion ? `  |  FW: ${fwVersion}` : ''}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['inventory', 'read', 'write', 'settings'] as TabMode[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => switchTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText,
              ]}
            >
              {tab === 'inventory'
                ? 'Scan'
                : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ════════ INVENTORY TAB ════════ */}
      {activeTab === 'inventory' && (
        <View style={styles.body}>
          {/* Power */}
          <View style={styles.powerRow}>
            <Text style={styles.powerLabel}>Power</Text>
            <TouchableOpacity
              style={styles.powerBtn}
              onPress={() => handleSetPower(uhfPower - 3)}
            >
              <Text style={styles.powerBtnText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.powerValue}>{uhfPower} dBm</Text>
            <TouchableOpacity
              style={styles.powerBtn}
              onPress={() => handleSetPower(uhfPower + 3)}
            >
              <Text style={styles.powerBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Action buttons */}
          <View style={styles.actionRow}>
            {isScanning ? (
              <TouchableOpacity
                style={[styles.actionBtn, styles.stopBtn]}
                onPress={handleStopInventory}
              >
                <Text style={styles.actionBtnText}>Stop</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.startBtn]}
                  onPress={handleStartInventory}
                >
                  <Text style={styles.actionBtnText}>Start</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.singleBtn]}
                  onPress={handleSingleScan}
                >
                  <Text style={styles.actionBtnText}>Single</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.clearBtn]}
              onPress={handleClear}
            >
              <Text style={styles.actionBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Stats bar */}
          <View style={styles.statsRow}>
            <Text style={styles.statItem}>
              Tags: <Text style={styles.statValue}>{tags.length}</Text>
            </Text>
            <Text style={styles.statItem}>
              Reads: <Text style={styles.statValue}>{totalReads}</Text>
            </Text>
            <Text style={styles.statItem}>
              Time: <Text style={styles.statValue}>{elapsedTime}</Text>
            </Text>
            {isScanning && <ActivityIndicator size="small" color="#f72585" />}
          </View>

          {/* Tag list */}
          {tags.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Press "Start" or "Single" to read UHF tags
              </Text>
            </View>
          ) : (
            <FlatList
              data={tags}
              renderItem={renderTag}
              keyExtractor={item => item.id}
              style={styles.tagList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      {/* ════════ READ TAB ════════ */}
      {activeTab === 'read' && (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.rwContent}
        >
          <Text style={styles.sectionTitle}>Read Tag Memory</Text>

          <Text style={styles.inputLabel}>Access Password (hex)</Text>
          <TextInput
            style={styles.input}
            value={rwPassword}
            onChangeText={setRwPassword}
            placeholder="00000000"
            placeholderTextColor="#555"
            maxLength={8}
            autoCapitalize="none"
          />

          <Text style={styles.inputLabel}>Memory Bank</Text>
          <View style={styles.bankRow}>
            {[UHF_BANK.RESERVED, UHF_BANK.EPC, UHF_BANK.TID, UHF_BANK.USER].map(
              b => (
                <TouchableOpacity
                  key={b}
                  style={[styles.bankBtn, rwBank === b && styles.bankBtnActive]}
                  onPress={() => setRwBank(b)}
                >
                  <Text
                    style={[
                      styles.bankBtnText,
                      rwBank === b && styles.bankBtnTextActive,
                    ]}
                  >
                    {bankLabel(b)}
                  </Text>
                </TouchableOpacity>
              ),
            )}
          </View>

          <View style={styles.rowInputs}>
            <View style={styles.halfInput}>
              <Text style={styles.inputLabel}>Start (word)</Text>
              <TextInput
                style={styles.input}
                value={rwPtr}
                onChangeText={setRwPtr}
                keyboardType="numeric"
                placeholderTextColor="#555"
              />
            </View>
            <View style={styles.halfInput}>
              <Text style={styles.inputLabel}>Length (words)</Text>
              <TextInput
                style={styles.input}
                value={rwLen}
                onChangeText={setRwLen}
                keyboardType="numeric"
                placeholderTextColor="#555"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.readBtn,
              rwBusy && styles.disabledBtn,
            ]}
            onPress={handleRead}
            disabled={rwBusy}
          >
            <Text style={styles.actionBtnText}>
              {rwBusy ? 'Reading...' : 'Read'}
            </Text>
          </TouchableOpacity>

          {readResult ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Result:</Text>
              <Text style={styles.resultData} selectable>
                {readResult}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* ════════ WRITE TAB ════════ */}
      {activeTab === 'write' && (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.rwContent}
        >
          <Text style={styles.sectionTitle}>Write Tag Memory</Text>

          <Text style={styles.inputLabel}>Access Password (hex)</Text>
          <TextInput
            style={styles.input}
            value={rwPassword}
            onChangeText={setRwPassword}
            placeholder="00000000"
            placeholderTextColor="#555"
            maxLength={8}
            autoCapitalize="none"
          />

          <Text style={styles.inputLabel}>Memory Bank</Text>
          <View style={styles.bankRow}>
            {[UHF_BANK.RESERVED, UHF_BANK.EPC, UHF_BANK.TID, UHF_BANK.USER].map(
              b => (
                <TouchableOpacity
                  key={b}
                  style={[styles.bankBtn, rwBank === b && styles.bankBtnActive]}
                  onPress={() => setRwBank(b)}
                >
                  <Text
                    style={[
                      styles.bankBtnText,
                      rwBank === b && styles.bankBtnTextActive,
                    ]}
                  >
                    {bankLabel(b)}
                  </Text>
                </TouchableOpacity>
              ),
            )}
          </View>

          <View style={styles.rowInputs}>
            <View style={styles.halfInput}>
              <Text style={styles.inputLabel}>Start (word)</Text>
              <TextInput
                style={styles.input}
                value={rwPtr}
                onChangeText={setRwPtr}
                keyboardType="numeric"
                placeholderTextColor="#555"
              />
            </View>
            <View style={styles.halfInput}>
              <Text style={styles.inputLabel}>Length (words)</Text>
              <TextInput
                style={styles.input}
                value={rwLen}
                onChangeText={setRwLen}
                keyboardType="numeric"
                placeholderTextColor="#555"
              />
            </View>
          </View>

          <Text style={styles.inputLabel}>Data (hex)</Text>
          <TextInput
            style={styles.input}
            value={writeData}
            onChangeText={setWriteData}
            placeholder="e.g. 112233445566"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.writeBtn,
              rwBusy && styles.disabledBtn,
            ]}
            onPress={handleWrite}
            disabled={rwBusy}
          >
            <Text style={styles.actionBtnText}>
              {rwBusy ? 'Writing...' : 'Write'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ════════ SETTINGS TAB ════════ */}
      {activeTab === 'settings' && (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.rwContent}
        >
          <Text style={styles.sectionTitle}>UHF Settings</Text>

          {/* Power slider */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>TX Power</Text>
            <View style={styles.powerRow}>
              <TouchableOpacity
                style={styles.powerBtn}
                onPress={() => handleSetPower(uhfPower - 1)}
              >
                <Text style={styles.powerBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.powerValue}>{uhfPower} dBm</Text>
              <TouchableOpacity
                style={styles.powerBtn}
                onPress={() => handleSetPower(uhfPower + 1)}
              >
                <Text style={styles.powerBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Frequency */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              Frequency Mode: {freqMode >= 0 ? freqMode : 'N/A'}
            </Text>
          </View>

          {/* RF Link */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              RF Link: {rfLink >= 0 ? rfLink : 'N/A'}
            </Text>
          </View>

          {/* Data mode buttons */}
          <Text style={styles.inputLabel}>Tag Data Mode</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.modeBtn]}
              onPress={handleSetEPCMode}
            >
              <Text style={styles.actionBtnText}>EPC Only</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.modeBtn]}
              onPress={handleSetEPCTIDMode}
            >
              <Text style={styles.actionBtnText}>EPC+TID</Text>
            </TouchableOpacity>
          </View>

          {/* Firmware */}
          <View style={[styles.settingRow, { marginTop: 20 }]}>
            <Text style={styles.settingLabel}>
              Firmware: {fwVersion || 'N/A'}
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: { marginTop: 16, fontSize: 16, color: '#a0a0a0' },
  errorIcon: { fontSize: 48, color: '#ff6b6b', marginBottom: 12 },
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
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Header
  header: { paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 12, color: '#6b7280', marginTop: 4 },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 3,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  activeTab: { backgroundColor: '#f72585' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  activeTabText: { color: '#fff' },

  // Body
  body: { flex: 1, paddingHorizontal: 12 },

  // Power
  powerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  powerLabel: { color: '#9ca3af', fontSize: 13, marginRight: 10 },
  powerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 6,
  },
  powerBtnText: { color: '#f72585', fontSize: 20, fontWeight: 'bold' },
  powerValue: {
    color: '#f72585',
    fontSize: 16,
    fontWeight: '700',
    minWidth: 70,
    textAlign: 'center',
  },

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  actionBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 2,
  },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  startBtn: { backgroundColor: '#f72585' },
  singleBtn: { backgroundColor: '#7209b7' },
  stopBtn: { backgroundColor: '#ef4444', paddingHorizontal: 40 },
  clearBtn: { backgroundColor: '#374151' },
  readBtn: { backgroundColor: '#3b82f6', alignSelf: 'center', marginTop: 16 },
  writeBtn: { backgroundColor: '#f72585', alignSelf: 'center', marginTop: 16 },
  modeBtn: { backgroundColor: '#1e3a5f' },
  disabledBtn: { opacity: 0.4 },

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
  statItem: { color: '#9ca3af', fontSize: 13 },
  statValue: { color: '#fff', fontWeight: '700' },

  // Tag list
  tagList: { flex: 1 },
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
  tagCount: { fontSize: 12, color: '#a78bfa', fontWeight: '700' },
  tagEpc: {
    fontSize: 14,
    color: '#fff',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  tagMeta: { fontSize: 11, color: '#6b7280', fontFamily: 'monospace' },
  tagFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  tagRssi: { fontSize: 11, color: '#9ca3af' },
  tagTime: { fontSize: 11, color: '#6b7280' },

  // Empty
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },

  // Read/Write
  rwContent: { paddingBottom: 40 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  bankRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  bankBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  bankBtnActive: { backgroundColor: '#f72585', borderColor: '#f72585' },
  bankBtnText: { color: '#6b7280', fontWeight: '600', fontSize: 13 },
  bankBtnTextActive: { color: '#fff' },
  rowInputs: { flexDirection: 'row', gap: 12 },
  halfInput: { flex: 1 },
  resultBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  resultLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 6 },
  resultData: { fontSize: 14, color: '#10b981', fontFamily: 'monospace' },

  // Settings
  settingRow: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  settingLabel: { color: '#9ca3af', fontSize: 14 },
});

export default App;
