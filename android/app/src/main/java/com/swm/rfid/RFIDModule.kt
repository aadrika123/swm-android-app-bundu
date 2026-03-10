package com.swm.rfid

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.rscja.deviceapi.RFIDWithISO14443A

class RFIDModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val TAG = "RFIDModule"
    private var rfidReader: RFIDWithISO14443A? = null
    private var isInitialized = false
    private var isScanning = false
    private var scanThread: Thread? = null
    private var rfidReceiver: BroadcastReceiver? = null

    companion object {
        const val ACTION_RFID_RESULT = "com.rscja.scanner.RFID_RESULT"
        const val EXTRA_DATA = "data"
    }

    override fun getName(): String = "RFIDScanner"

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            if (isInitialized) {
                promise.resolve(true)
                return
            }

            Log.i(TAG, "Initializing RFID...")
            registerRfidReceiver()

            try {
                rfidReader = RFIDWithISO14443A.getInstance()
                if (rfidReader != null) {
                    val initResult = rfidReader?.init()
                    Log.i(TAG, "RFID ISO14443A init result: $initResult")
                }
            } catch (e: Exception) {
                Log.w(TAG, "ISO14443A init failed: ${e.message}")
            }

            isInitialized = true
            Log.i(TAG, "RFID initialized successfully")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize RFID scanner: ${e.message}", e)
            promise.reject("INIT_ERROR", e.message)
        }
    }

    private fun registerRfidReceiver() {
        if (rfidReceiver != null) return

        rfidReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent == null) return
                val action = intent.action ?: ""
                Log.i(TAG, "Received broadcast: $action")

                val data = intent.getStringExtra(EXTRA_DATA)
                    ?: intent.getStringExtra("epc")
                    ?: intent.getStringExtra("barcode_string")
                    ?: intent.getStringExtra("scan_data")
                    ?: intent.getStringExtra("scannerdata")
                    ?: intent.getStringExtra("value")
                    ?: ""

                if (data.isNotEmpty()) {
                    Log.i(TAG, "Scanner data received: $data")
                    val params = Arguments.createMap().apply {
                        putString("epc", data)
                        putString("tid", "")
                        putString("user", "")
                        putInt("rssi", 0)
                        putBoolean("success", true)
                    }
                    sendEvent("onRFIDTagScanned", params)
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(ACTION_RFID_RESULT)
            addAction("com.rscja.scanner.action.RFID_RESULT")
            addAction("com.rscja.scanner.action.UHF_RESULT")
            addAction("android.intent.action.RFID_DATA")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactApplicationContext.registerReceiver(rfidReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            reactApplicationContext.registerReceiver(rfidReceiver, filter)
        }

        Log.i(TAG, "RFID broadcast receiver registered")
    }

    private fun unregisterRfidReceiver() {
        rfidReceiver?.let {
            try {
                reactApplicationContext.unregisterReceiver(it)
                Log.i(TAG, "RFID broadcast receiver unregistered")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unregister receiver: ${e.message}")
            }
        }
        rfidReceiver = null
    }

    @ReactMethod
    fun startInventory(promise: Promise) {
        try {
            if (!isInitialized) {
                promise.reject("NOT_INITIALIZED", "RFID scanner not initialized")
                return
            }

            if (isScanning) {
                promise.resolve(true)
                return
            }

            isScanning = true

            if (rfidReader != null) {
                scanThread = Thread {
                    while (isScanning) {
                        try {
                            val entity = rfidReader?.request()
                            if (entity != null) {
                                val uid = entity.id ?: ""
                                if (uid.isNotEmpty()) {
                                    Log.i(TAG, "Card detected: $uid")
                                    val params = Arguments.createMap().apply {
                                        putString("epc", uid)
                                        putString("tid", "")
                                        putString("user", "")
                                        putInt("rssi", 0)
                                        putBoolean("success", true)
                                    }
                                    sendEvent("onRFIDTagScanned", params)
                                }
                            }
                            Thread.sleep(300)
                        } catch (e: InterruptedException) {
                            break
                        } catch (e: Exception) {
                            Log.w(TAG, "Scan error: ${e.message}")
                        }
                    }
                }
                scanThread?.start()
            }

            Log.i(TAG, "RFID inventory started")
            promise.resolve(true)
        } catch (e: Exception) {
            isScanning = false
            Log.e(TAG, "Failed to start inventory", e)
            promise.reject("INVENTORY_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopInventory(promise: Promise) {
        try {
            isScanning = false
            scanThread?.interrupt()
            scanThread = null
            Log.i(TAG, "Inventory stopped")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop inventory", e)
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun singleScan(promise: Promise) {
        try {
            if (!isInitialized) {
                promise.reject("NOT_INITIALIZED", "RFID scanner not initialized")
                return
            }

            Thread {
                try {
                    if (rfidReader != null) {
                        val entity = rfidReader?.request()
                        if (entity != null) {
                            val uid = entity.id ?: ""
                            if (uid.isNotEmpty()) {
                                Log.i(TAG, "Single scan result: $uid")
                                val params = Arguments.createMap().apply {
                                    putString("epc", uid)
                                    putString("tid", "")
                                    putString("user", "")
                                    putInt("rssi", 0)
                                    putBoolean("success", true)
                                }
                                sendEvent("onRFIDTagScanned", params)
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Single scan error: ${e.message}")
                }
            }.start()

            Log.i(TAG, "Single scan triggered")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to perform single scan", e)
            promise.reject("SCAN_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setPower(power: Int, promise: Promise) {
        Log.i(TAG, "Set power called (not applicable for ISO14443A)")
        promise.resolve(true)
    }

    @ReactMethod
    fun getReaderType(promise: Promise) {
        val type = if (rfidReader != null) "ISO14443A" else "BroadcastReceiver"
        promise.resolve(if (isInitialized) type else "NOT_INITIALIZED")
    }

    @ReactMethod
    fun close(promise: Promise) {
        try {
            isScanning = false
            scanThread?.interrupt()
            scanThread = null
            unregisterRfidReceiver()
            rfidReader?.free()
            rfidReader = null
            isInitialized = false
            Log.i(TAG, "RFID scanner closed")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to close RFID scanner", e)
            promise.reject("CLOSE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun sendEvent(eventName: String, params: com.facebook.react.bridge.WritableMap?) {
        try {
            if (reactApplicationContext.hasActiveReactInstance()) {
                reactApplicationContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
                Log.i(TAG, "Event '$eventName' sent to JS")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send event: ${e.message}")
        }
    }
}
