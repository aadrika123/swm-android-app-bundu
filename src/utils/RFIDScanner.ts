import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { UHFUARTScanner } = NativeModules;
const uhfEventEmitter =
  Platform.OS === 'android' ? new NativeEventEmitter(UHFUARTScanner) : null;

export interface RFIDTagResult {
  success: boolean;
  epc?: string;
  tid?: string;
  user?: string;
  rssi?: string;
  timestamp?: number;
  error?: string;
}

// Memory bank constants (same as SDK)
export const UHF_BANK = {
  RESERVED: 0,
  EPC: 1,
  TID: 2,
  USER: 3,
};

type TagCallback = (result: RFIDTagResult) => void;
type TriggerCallback = () => void;

class RFIDScannerModule {
  private tagCallbacks: TagCallback[] = [];
  private tagListenerSub: { remove: () => void } | null = null;
  private triggerPressedSub: { remove: () => void } | null = null;
  private triggerReleasedSub: { remove: () => void } | null = null;
  private triggerPressedCallbacks: TriggerCallback[] = [];
  private triggerReleasedCallbacks: TriggerCallback[] = [];

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!UHFUARTScanner;
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('UHF UART Scanner not available');
    }

    await UHFUARTScanner.initialize();

    if (!this.tagListenerSub && uhfEventEmitter) {
      this.tagListenerSub = uhfEventEmitter.addListener(
        'onUHFTagRead',
        (data: any) => {
          const result: RFIDTagResult = {
            success: !!data.epc,
            epc: data.epc,
            tid: data.tid,
            user: data.user,
            rssi: data.rssi,
            timestamp: Date.now(),
          };
          this.tagCallbacks.forEach(cb => cb(result));
        },
      );
    }

    if (!this.triggerPressedSub && uhfEventEmitter) {
      this.triggerPressedSub = uhfEventEmitter.addListener(
        'onTriggerPressed',
        () => this.triggerPressedCallbacks.forEach(cb => cb()),
      );
    }

    if (!this.triggerReleasedSub && uhfEventEmitter) {
      this.triggerReleasedSub = uhfEventEmitter.addListener(
        'onTriggerReleased',
        () => this.triggerReleasedCallbacks.forEach(cb => cb()),
      );
    }
  }

  addTagListener(callback: TagCallback): { remove: () => void } {
    this.tagCallbacks.push(callback);
    return {
      remove: () => {
        this.tagCallbacks = this.tagCallbacks.filter(cb => cb !== callback);
      },
    };
  }

  addTriggerPressedListener(callback: TriggerCallback): { remove: () => void } {
    this.triggerPressedCallbacks.push(callback);
    return {
      remove: () => {
        this.triggerPressedCallbacks = this.triggerPressedCallbacks.filter(
          cb => cb !== callback,
        );
      },
    };
  }

  addTriggerReleasedListener(callback: TriggerCallback): {
    remove: () => void;
  } {
    this.triggerReleasedCallbacks.push(callback);
    return {
      remove: () => {
        this.triggerReleasedCallbacks = this.triggerReleasedCallbacks.filter(
          cb => cb !== callback,
        );
      },
    };
  }

  async startInventory(): Promise<void> {
    await UHFUARTScanner.startInventory();
  }

  async stopInventory(): Promise<void> {
    await UHFUARTScanner.stopInventory();
  }

  async singleScan(): Promise<boolean> {
    return await UHFUARTScanner.inventorySingleTag();
  }

  async setPower(power: number): Promise<boolean> {
    return await UHFUARTScanner.setPower(power);
  }

  async getPower(): Promise<number> {
    return await UHFUARTScanner.getPower();
  }

  async readData(
    password: string,
    bank: number,
    ptr: number,
    len: number,
  ): Promise<string | null> {
    return await UHFUARTScanner.readData(password, bank, ptr, len);
  }

  async writeData(
    password: string,
    bank: number,
    ptr: number,
    len: number,
    data: string,
  ): Promise<boolean> {
    return await UHFUARTScanner.writeData(password, bank, ptr, len, data);
  }

  async setFilter(
    bank: number,
    ptr: number,
    len: number,
    data: string,
  ): Promise<boolean> {
    return await UHFUARTScanner.setFilter(bank, ptr, len, data);
  }

  async clearFilter(): Promise<boolean> {
    return await UHFUARTScanner.clearFilter();
  }

  async setFrequencyMode(mode: number): Promise<boolean> {
    return await UHFUARTScanner.setFrequencyMode(mode);
  }

  async getFrequencyMode(): Promise<number> {
    return await UHFUARTScanner.getFrequencyMode();
  }

  async setEPCMode(): Promise<boolean> {
    return await UHFUARTScanner.setEPCMode();
  }

  async setEPCAndTIDMode(): Promise<boolean> {
    return await UHFUARTScanner.setEPCAndTIDMode();
  }

  async setEPCAndTIDUserMode(offset: number, len: number): Promise<boolean> {
    return await UHFUARTScanner.setEPCAndTIDUserMode(offset, len);
  }

  async getRFLink(): Promise<number> {
    return await UHFUARTScanner.getRFLink();
  }

  async setRFLink(index: number): Promise<boolean> {
    return await UHFUARTScanner.setRFLink(index);
  }

  async getVersion(): Promise<string> {
    return await UHFUARTScanner.getVersion();
  }

  async close(): Promise<void> {
    try {
      await UHFUARTScanner.stopInventory();
    } catch {}
    try {
      await UHFUARTScanner.free();
    } catch {}
    this.tagListenerSub?.remove();
    this.tagListenerSub = null;
    this.triggerPressedSub?.remove();
    this.triggerPressedSub = null;
    this.triggerReleasedSub?.remove();
    this.triggerReleasedSub = null;
    this.tagCallbacks = [];
    this.triggerPressedCallbacks = [];
    this.triggerReleasedCallbacks = [];
  }
}

export const rfidScannerModule = new RFIDScannerModule();
export default rfidScannerModule;
