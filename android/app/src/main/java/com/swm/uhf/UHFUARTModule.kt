package com.swm.uhf

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.UHFTAGInfo
import com.rscja.deviceapi.interfaces.IUHFInventoryCallback

class UHFUARTModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private var instance: UHFUARTModule? = null

        fun emitTriggerEvent(eventName: String) {
            instance?.let { module ->
                try {
                    module.reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(eventName, Arguments.createMap())
                } catch (e: Exception) {
                    Log.w("UHFUARTModule", "Failed to emit trigger event: ${e.message}")
                }
            }
        }
    }

    private val TAG = "UHFUARTModule"
    private var mReader: RFIDWithUHFUART? = null
    private var isInitialized = false
    private var isScanning = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val toneGenerator: ToneGenerator? = try {
        ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
    } catch (e: Exception) { null }

    init {
        instance = this
    }

    override fun getName(): String = "UHFUARTScanner"

    @ReactMethod
    fun initialize(promise: Promise) {
        if (isInitialized && mReader != null) {
            promise.resolve(true)
            return
        }

        Thread {
            try {
                Log.i(TAG, "Initializing UHF UART reader...")
                mReader = RFIDWithUHFUART.getInstance()
                if (mReader == null) {
                    mainHandler.post {
                        promise.reject("INIT_ERROR", "Failed to get RFIDWithUHFUART instance")
                    }
                    return@Thread
                }

                var ctx: android.content.Context? = reactApplicationContext.currentActivity
                var retries = 0
                while (ctx == null && retries < 10) {
                    Thread.sleep(300)
                    ctx = reactApplicationContext.currentActivity
                    retries++
                    Log.i(TAG, "Waiting for Activity... attempt $retries")
                }
                if (ctx == null) {
                    ctx = reactApplicationContext
                    Log.w(TAG, "Activity not available, using application context")
                } else {
                    Log.i(TAG, "Using Activity context")
                }

                val result = mReader!!.init(ctx)
                Log.i(TAG, "UHF UART init result: $result")

                isInitialized = true
                mainHandler.post { promise.resolve(true) }
            } catch (e: Exception) {
                Log.e(TAG, "UHF UART init failed: ${e.message}", e)
                mainHandler.post { promise.reject("INIT_ERROR", e.message) }
            }
        }.start()
    }

    @ReactMethod
    fun free(promise: Promise) {
        try {
            isScanning = false
            mReader?.let {
                it.stopInventory()
                it.free()
            }
            mReader = null
            isInitialized = false
            Log.i(TAG, "UHF UART reader freed")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error freeing reader: ${e.message}", e)
            promise.reject("FREE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun inventorySingleTag(promise: Promise) {
        if (!ensureInitialized(promise)) return

        Thread {
            try {
                val tagInfo: UHFTAGInfo? = mReader?.inventorySingleTag()
                if (tagInfo != null) {
                    val params = Arguments.createMap().apply {
                        putString("epc", tagInfo.epc ?: "")
                        putString("tid", tagInfo.tid ?: "")
                        putString("user", tagInfo.user ?: "")
                        putString("rssi", tagInfo.rssi ?: "")
                        putBoolean("success", true)
                    }
                    sendEvent("onUHFTagRead", params)
                    mainHandler.post { promise.resolve(true) }
                } else {
                    mainHandler.post { promise.resolve(false) }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Single tag scan error: ${e.message}", e)
                mainHandler.post { promise.reject("SCAN_ERROR", e.message) }
            }
        }.start()
    }

    @ReactMethod
    fun startInventory(promise: Promise) {
        if (!ensureInitialized(promise)) return

        if (isScanning) {
            promise.resolve(true)
            return
        }

        try {
            mReader?.setInventoryCallback(object : IUHFInventoryCallback {
                override fun callback(tagInfo: UHFTAGInfo?) {
                    if (tagInfo == null) return
                    val params = Arguments.createMap().apply {
                        putString("epc", tagInfo.epc ?: "")
                        putString("tid", tagInfo.tid ?: "")
                        putString("user", tagInfo.user ?: "")
                        putString("rssi", tagInfo.rssi ?: "")
                        putBoolean("success", true)
                    }
                    sendEvent("onUHFTagRead", params)
                }
            })

            val started = mReader?.startInventoryTag() ?: false
            if (started) {
                isScanning = true
                Log.i(TAG, "UHF inventory started")
                promise.resolve(true)
            } else {
                Log.w(TAG, "Failed to start UHF inventory")
                promise.reject("INVENTORY_ERROR", "startInventoryTag() returned false")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Start inventory error: ${e.message}", e)
            promise.reject("INVENTORY_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopInventory(promise: Promise) {
        try {
            if (isScanning) {
                val stopped = mReader?.stopInventory() ?: false
                isScanning = false
                Log.i(TAG, "UHF inventory stopped: $stopped")
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Stop inventory error: ${e.message}", e)
            promise.reject("STOP_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setPower(power: Int, promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val result = mReader?.setPower(power) ?: false
            Log.i(TAG, "Set power $power: $result")
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("POWER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getPower(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val power = mReader?.power ?: -1
            promise.resolve(power)
        } catch (e: Exception) {
            promise.reject("POWER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun readData(password: String, bank: Int, ptr: Int, len: Int, promise: Promise) {
        if (!ensureInitialized(promise)) return
        Thread {
            try {
                val data = mReader?.readData(password, bank, ptr, len)
                if (data != null && data.isNotEmpty()) {
                    mainHandler.post { promise.resolve(data) }
                } else {
                    mainHandler.post { promise.resolve(null) }
                }
            } catch (e: Exception) {
                mainHandler.post { promise.reject("READ_ERROR", e.message) }
            }
        }.start()
    }

    @ReactMethod
    fun writeData(password: String, bank: Int, ptr: Int, len: Int, data: String, promise: Promise) {
        if (!ensureInitialized(promise)) return
        Thread {
            try {
                val result = mReader?.writeData(password, bank, ptr, len, data) ?: false
                mainHandler.post { promise.resolve(result) }
            } catch (e: Exception) {
                mainHandler.post { promise.reject("WRITE_ERROR", e.message) }
            }
        }.start()
    }

    @ReactMethod
    fun setFilter(bank: Int, ptr: Int, len: Int, data: String, promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val result = mReader?.setFilter(bank, ptr, len, data) ?: false
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("FILTER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearFilter(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val empty = ""
            val r1 = mReader?.setFilter(RFIDWithUHFUART.Bank_EPC, 0, 0, empty) ?: false
            val r2 = mReader?.setFilter(RFIDWithUHFUART.Bank_TID, 0, 0, empty) ?: false
            val r3 = mReader?.setFilter(RFIDWithUHFUART.Bank_USER, 0, 0, empty) ?: false
            promise.resolve(r1 && r2 && r3)
        } catch (e: Exception) {
            promise.reject("FILTER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setFrequencyMode(mode: Int, promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val result = mReader?.setFrequencyMode(mode) ?: false
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("FREQ_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getFrequencyMode(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val mode = mReader?.frequencyMode ?: -1
            promise.resolve(mode)
        } catch (e: Exception) {
            promise.reject("FREQ_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setEPCMode(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            mReader?.setEPCMode()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("MODE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setEPCAndTIDMode(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            mReader?.setEPCAndTIDMode()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("MODE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setEPCAndTIDUserMode(offset: Int, len: Int, promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            mReader?.setEPCAndTIDUserMode(offset, len)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("MODE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setRFLink(index: Int, promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val result = mReader?.setRFLink(index) ?: false
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("RFLINK_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getRFLink(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val link = mReader?.rfLink ?: -1
            promise.resolve(link)
        } catch (e: Exception) {
            promise.reject("RFLINK_ERROR", e.message)
        }
    }

    @ReactMethod
    fun lockMem(password: String, lockCode: String, promise: Promise) {
        if (!ensureInitialized(promise)) return
        Thread {
            try {
                val result = mReader?.lockMem(password, lockCode) ?: false
                mainHandler.post { promise.resolve(result) }
            } catch (e: Exception) {
                mainHandler.post { promise.reject("LOCK_ERROR", e.message) }
            }
        }.start()
    }

    @ReactMethod
    fun killTag(password: String, promise: Promise) {
        if (!ensureInitialized(promise)) return
        Thread {
            try {
                val result = mReader?.killTag(password) ?: false
                mainHandler.post { promise.resolve(result) }
            } catch (e: Exception) {
                mainHandler.post { promise.reject("KILL_ERROR", e.message) }
            }
        }.start()
    }

    @ReactMethod
    fun getVersion(promise: Promise) {
        if (!ensureInitialized(promise)) return
        try {
            val version = mReader?.version ?: ""
            promise.resolve(version)
        } catch (e: Exception) {
            promise.reject("VERSION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun ensureInitialized(promise: Promise): Boolean {
        if (!isInitialized || mReader == null) {
            promise.reject("NOT_INITIALIZED", "UHF reader not initialized. Call initialize() first.")
            return false
        }
        return true
    }

    private fun sendEvent(eventName: String, params: com.facebook.react.bridge.WritableMap?) {
        try {
            if (reactApplicationContext.hasActiveReactInstance()) {
                reactApplicationContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
            }
            if (eventName == "onUHFTagRead") {
                toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, 100)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send event: ${e.message}")
        }
    }
}
