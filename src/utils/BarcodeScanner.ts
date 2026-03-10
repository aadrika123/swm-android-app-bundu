import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { BarcodeScanner } = NativeModules;

export interface ScanResult {
  success: boolean;
  data?: string;
  type?: string;
  error?: string;
}

class BarcodeScannerModule {
  private eventEmitter: NativeEventEmitter | null = null;
  private listeners: Array<{ remove: () => void }> = [];

  constructor() {
    if (Platform.OS === 'android' && BarcodeScanner) {
      this.eventEmitter = new NativeEventEmitter(BarcodeScanner);
    }
  }

  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BarcodeScanner) {
      throw new Error('BarcodeScanner is only available on Android');
    }
    return await BarcodeScanner.initialize();
  }

  async startScan(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BarcodeScanner) {
      throw new Error('BarcodeScanner is only available on Android');
    }
    return await BarcodeScanner.startScan();
  }

  async stopScan(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BarcodeScanner) {
      throw new Error('BarcodeScanner is only available on Android');
    }
    return await BarcodeScanner.stopScan();
  }

  async close(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BarcodeScanner) {
      throw new Error('BarcodeScanner is only available on Android');
    }
    this.removeAllListeners();
    return await BarcodeScanner.close();
  }

  addScanListener(callback: (result: ScanResult) => void): {
    remove: () => void;
  } {
    if (!this.eventEmitter) {
      console.warn('Barcode: Event emitter not available');
      return { remove: () => {} };
    }

    const subscription = this.eventEmitter.addListener(
      'onBarcodeScanned',
      (result: ScanResult) => {
        callback(result);
      },
    );
    this.listeners.push(subscription);
    return subscription;
  }

  removeAllListeners(): void {
    this.listeners.forEach(listener => listener.remove());
    this.listeners = [];
  }

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!BarcodeScanner;
  }
}

export const barcodeScannerModule = new BarcodeScannerModule();
export default barcodeScannerModule;
