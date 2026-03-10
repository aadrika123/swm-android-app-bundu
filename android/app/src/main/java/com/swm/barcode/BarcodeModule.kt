package com.swm.barcode

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.rscja.barcode.BarcodeDecoder
import com.rscja.barcode.BarcodeFactory
import com.rscja.deviceapi.entity.BarcodeEntity

class BarcodeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val TAG = "BarcodeModule"
    private var barcodeDecoder: BarcodeDecoder? = null
    private var isInitialized = false

    @Volatile
    private var isScanning = false

    override fun getName(): String = "BarcodeScanner"

    @ReactMethod
    fun initialize(promise: Promise) {
        try {
            if (isInitialized) {
                promise.resolve(true)
                return
            }

            barcodeDecoder = BarcodeFactory.getInstance().barcodeDecoder

            val activity = reactApplicationContext.currentActivity
            if (activity != null) {
                barcodeDecoder?.open(activity)

                barcodeDecoder?.setDecodeCallback { barcodeEntity: BarcodeEntity ->
                    Log.i(TAG, "Decode callback triggered, resultCode: ${barcodeEntity.resultCode}, isScanning: $isScanning")

                    if (!isScanning) {
                        Log.i(TAG, "Ignoring callback - not scanning")
                        return@setDecodeCallback
                    }

                    if (barcodeEntity.resultCode == BarcodeDecoder.DECODE_SUCCESS) {
                        val data = barcodeEntity.barcodeData
                        if (!data.isNullOrEmpty()) {
                            Log.i(TAG, "Barcode decoded successfully: $data")
                            isScanning = false
                            val params = Arguments.createMap().apply {
                                putString("data", data)
                                putString("type", "BARCODE")
                                putBoolean("success", true)
                            }
                            Log.i(TAG, "Sending onBarcodeScanned event with data: $data")
                            sendEvent("onBarcodeScanned", params)
                        }
                    }
                }

                isInitialized = true
                Log.i(TAG, "Barcode scanner initialized successfully")
                promise.resolve(true)
            } else {
                promise.reject("INIT_ERROR", "No activity available")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize barcode scanner", e)
            promise.reject("INIT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun startScan(promise: Promise) {
        try {
            if (!isInitialized || barcodeDecoder == null) {
                promise.reject("NOT_INITIALIZED", "Scanner not initialized. Call initialize() first.")
                return
            }
            isScanning = true
            barcodeDecoder?.startScan()
            Log.i(TAG, "Scan started, isScanning=true")
            promise.resolve(true)
        } catch (e: Exception) {
            isScanning = false
            Log.e(TAG, "Failed to start scan", e)
            promise.reject("SCAN_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopScan(promise: Promise) {
        try {
            isScanning = false
            barcodeDecoder?.stopScan()
            Log.i(TAG, "Scan stopped, isScanning=false")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop scan", e)
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun close(promise: Promise) {
        try {
            barcodeDecoder?.close()
            isInitialized = false
            barcodeDecoder = null
            Log.i(TAG, "Barcode scanner closed")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to close barcode scanner", e)
            promise.reject("CLOSE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for NativeEventEmitter
    }

    private fun sendEvent(eventName: String, params: com.facebook.react.bridge.WritableMap?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
