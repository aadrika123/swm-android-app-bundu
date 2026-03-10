package com.swm

import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.swm.uhf.UHFUARTModule

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "JNAC"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // Handheld trigger button keycodes (Chainway devices)
  private fun isTriggerKey(keyCode: Int): Boolean =
      keyCode == 139 || keyCode == 280 || keyCode == 293

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    Log.d("MainActivity", "onKeyDown keyCode=$keyCode repeatCount=${event?.repeatCount}")
    if (isTriggerKey(keyCode) && event?.repeatCount == 0) {
      UHFUARTModule.emitTriggerEvent("onTriggerPressed")
      return true
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
    Log.d("MainActivity", "onKeyUp keyCode=$keyCode")
    if (isTriggerKey(keyCode)) {
      UHFUARTModule.emitTriggerEvent("onTriggerReleased")
      return true
    }
    return super.onKeyUp(keyCode, event)
  }
}
