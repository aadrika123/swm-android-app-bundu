import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import NfcManager, { NfcEvents, TagEvent } from 'react-native-nfc-manager';

const { RFIDScanner: RFIDScannerNative } = NativeModules;
const rfidEventEmitter =
  Platform.OS === 'android' && RFIDScannerNative
    ? new NativeEventEmitter(RFIDScannerNative)
    : null;

export interface MifareInfo {
  type?: string;
  size?: number;
  sectorCount?: number;
  blockCount?: number;
}

export interface NFCTagResult {
  success: boolean;
  id?: string;
  idHex?: string;
  techTypes?: string[];
  ndefMessage?: NdefRecord[];
  mifare?: MifareInfo;
  error?: string;
}

export interface NdefRecord {
  tnf: number;
  type: string;
  payload: string;
  id?: string;
}

export interface RFIDCardResult {
  success: boolean;
  epc?: string;
  tid?: string;
  user?: string;
  rssi?: number;
  error?: string;
}

type NFCTagCallback = (result: NFCTagResult) => void;
type RFIDCardCallback = (result: RFIDCardResult) => void;

// ─── NFC (ISO14443A via react-native-nfc-manager) ───────────────────────────

class NFCScannerModule {
  private isInitialized: boolean = false;
  private isScanning: boolean = false;
  private listeners: NFCTagCallback[] = [];

  async isSupported(): Promise<boolean> {
    try {
      return await NfcManager.isSupported();
    } catch {
      return false;
    }
  }

  async isEnabled(): Promise<boolean> {
    try {
      return await NfcManager.isEnabled();
    } catch {
      return false;
    }
  }

  async initialize(): Promise<boolean> {
    try {
      const supported = await this.isSupported();
      if (!supported) {
        throw new Error('NFC is not supported on this device');
      }
      await NfcManager.start();
      this.isInitialized = true;
      return true;
    } catch (error: any) {
      throw new Error(error.message || 'Failed to initialize NFC');
    }
  }

  async startScan(): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('NFC Manager not initialized');
    }
    if (this.isScanning) {
      return true;
    }
    try {
      this.isScanning = true;

      NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag: TagEvent) => {
        const result = this.parseTag(tag);
        this.notifyListeners(result);
      });

      await NfcManager.registerTagEvent({
        alertMessage: 'Hold your device near the NFC tag',
        invalidateAfterFirstRead: false,
        isReaderModeEnabled: true,
        readerModeFlags: Platform.OS === 'android' ? 0x1f : undefined,
      });

      return true;
    } catch (error: any) {
      this.isScanning = false;
      if (error.message?.includes('cancelled')) {
        this.notifyListeners({ success: false, error: 'Scan cancelled' });
      } else {
        this.notifyListeners({
          success: false,
          error: error.message || 'Failed to read NFC tag',
        });
      }
      return false;
    }
  }

  async stopScan(): Promise<boolean> {
    try {
      this.isScanning = false;
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
      await NfcManager.unregisterTagEvent();
      return true;
    } catch {
      return false;
    }
  }

  async cancelScan(): Promise<void> {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {}
  }

  private parseTag(tag: any): NFCTagResult {
    try {
      let tagIdHex: string | undefined;
      let tagIdDecimal: string | undefined;

      if (tag.id) {
        if (typeof tag.id === 'string') {
          tagIdHex = tag.id;
          try {
            tagIdDecimal = parseInt(tag.id.replace(/:/g, ''), 16).toString();
          } catch {
            tagIdDecimal = tag.id;
          }
        } else {
          tagIdHex = this.bytesToHex(tag.id);
          const bytes = Array.from(tag.id as number[]);
          let decimal = 0n;
          for (const byte of bytes) {
            decimal = (decimal << 8n) + BigInt(byte as number);
          }
          tagIdDecimal = decimal.toString();
        }
      } else {
        tagIdHex = `TAG-${Date.now()}`;
        tagIdDecimal = tagIdHex;
      }

      const result: NFCTagResult = {
        success: true,
        id: tagIdDecimal,
        idHex: tagIdHex,
        techTypes: tag.techTypes || [],
        ndefMessage: [],
        mifare: this.parseMifareInfo(tag),
      };

      if (tag.ndefMessage && Array.isArray(tag.ndefMessage)) {
        result.ndefMessage = tag.ndefMessage.map((record: any) => ({
          tnf: record.tnf,
          type: record.type ? this.bytesToString(record.type) : '',
          payload: record.payload ? this.decodeNdefPayload(record) : '',
          id: record.id ? this.bytesToString(record.id) : undefined,
        }));
      }

      return result;
    } catch {
      return { success: false, error: 'Failed to parse tag data' };
    }
  }

  private parseMifareInfo(tag: any): MifareInfo | undefined {
    const techTypes: string[] = tag.techTypes || [];
    const isMifareClassic = techTypes.some(t => t.includes('MifareClassic'));
    const isMifareUltralight = techTypes.some(t =>
      t.includes('MifareUltralight'),
    );
    const isNfcA = techTypes.some(t => t.includes('NfcA'));

    if (!isMifareClassic && !isMifareUltralight && !isNfcA) {
      return undefined;
    }

    const mifareInfo: MifareInfo = {};
    const sak = tag.sak;

    if (sak !== undefined) {
      switch (sak) {
        case 0x08:
        case 0x28:
        case 0x88:
          mifareInfo.type = 'MIFARE Classic 1K';
          mifareInfo.size = 1024;
          mifareInfo.sectorCount = 16;
          mifareInfo.blockCount = 64;
          break;
        case 0x09:
          mifareInfo.type = 'MIFARE Mini';
          mifareInfo.size = 320;
          mifareInfo.sectorCount = 5;
          mifareInfo.blockCount = 20;
          break;
        case 0x18:
        case 0x38:
        case 0x98:
          mifareInfo.type = 'MIFARE Classic 4K';
          mifareInfo.size = 4096;
          mifareInfo.sectorCount = 40;
          mifareInfo.blockCount = 256;
          break;
        default:
          mifareInfo.type = `NFC-A (SAK: 0x${sak.toString(16).toUpperCase()})`;
      }
    }

    return mifareInfo.type ? mifareInfo : undefined;
  }

  private decodeNdefPayload(record: any): string {
    try {
      const payload = record.payload;
      if (!payload || payload.length === 0) {
        return '';
      }
      const type = record.type ? this.bytesToString(record.type) : '';
      if (type === 'T') {
        const langCodeLength = payload[0] & 0x3f;
        return this.bytesToString(payload.slice(1 + langCodeLength));
      }
      if (type === 'U') {
        const prefixMap: { [k: number]: string } = {
          0x00: '',
          0x01: 'http://www.',
          0x02: 'https://www.',
          0x03: 'http://',
          0x04: 'https://',
          0x05: 'tel:',
          0x06: 'mailto:',
        };
        return (
          (prefixMap[payload[0]] || '') + this.bytesToString(payload.slice(1))
        );
      }
      return this.bytesToString(payload);
    } catch {
      return this.bytesToHex(record.payload);
    }
  }

  private bytesToHex(bytes: number[] | Uint8Array | string): string {
    if (typeof bytes === 'string') {
      return bytes;
    }
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(':');
  }

  private bytesToString(bytes: number[] | Uint8Array): string {
    if (!bytes || bytes.length === 0) {
      return '';
    }
    return String.fromCharCode(...Array.from(bytes));
  }

  addTagListener(callback: NFCTagCallback): { remove: () => void } {
    this.listeners.push(callback);
    return {
      remove: () => {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }

  private notifyListeners(result: NFCTagResult): void {
    this.listeners.forEach(cb => {
      try {
        cb(result);
      } catch {}
    });
  }

  removeAllListeners(): void {
    this.listeners = [];
  }

  async close(): Promise<boolean> {
    try {
      this.removeAllListeners();
      await this.stopScan();
      this.isInitialized = false;
      return true;
    } catch {
      return false;
    }
  }

  async goToNfcSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      await NfcManager.goToNfcSetting();
    }
  }

  isScanningActive(): boolean {
    return this.isScanning;
  }

  isAvailable(): boolean {
    return this.isInitialized;
  }
}

// ─── RFID (ISO14443A via native RFIDScanner module) ──────────────────────────

class RFIDCardScannerModule {
  private cardCallbacks: RFIDCardCallback[] = [];
  private cardListenerSub: { remove: () => void } | null = null;

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!RFIDScannerNative;
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('RFIDScanner native module not available');
    }
    await RFIDScannerNative.initialize();

    if (!this.cardListenerSub && rfidEventEmitter) {
      this.cardListenerSub = rfidEventEmitter.addListener(
        'onRFIDTagScanned',
        (data: any) => {
          const result: RFIDCardResult = {
            success: !!data.epc,
            epc: data.epc,
            tid: data.tid,
            user: data.user,
            rssi: data.rssi,
          };
          this.cardCallbacks.forEach(cb => cb(result));
        },
      );
    }
  }

  addCardListener(callback: RFIDCardCallback): { remove: () => void } {
    this.cardCallbacks.push(callback);
    return {
      remove: () => {
        this.cardCallbacks = this.cardCallbacks.filter(cb => cb !== callback);
      },
    };
  }

  async startInventory(): Promise<void> {
    await RFIDScannerNative.startInventory();
  }

  async stopInventory(): Promise<void> {
    await RFIDScannerNative.stopInventory();
  }

  async singleScan(): Promise<void> {
    await RFIDScannerNative.singleScan();
  }

  async close(): Promise<void> {
    try {
      await RFIDScannerNative.stopInventory();
    } catch {}
    try {
      await RFIDScannerNative.close();
    } catch {}
    this.cardListenerSub?.remove();
    this.cardListenerSub = null;
    this.cardCallbacks = [];
  }
}

export const nfcScannerModule = new NFCScannerModule();
export const rfidCardScannerModule = new RFIDCardScannerModule();
export default nfcScannerModule;
