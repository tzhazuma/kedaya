package cn.shanghaitech.kedaya

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.huawei.hms.aaid.HmsInstanceId
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingChannel: String? = null
    private var pendingResult: MethodChannel.Result? = null
    private var pendingHmsAppId: String? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "kedaya/push").setMethodCallHandler { call, result ->
            when (call.method) {
                "registerFcm" -> requestPushRegistration("fcm", result, null)
                "registerHms" -> requestPushRegistration("hms", result, call.argument<String>("appId"))
                "unregisterFcm" -> {
                    FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener {
                        result.success(null)
                    }
                }
                "unregisterHms" -> {
                    val appId = call.argument<String>("appId")
                    if (appId.isNullOrBlank()) {
                        result.error("HMS_NOT_CONFIGURED", "HMS_APP_ID 未配置", null)
                    } else {
                        try {
                            HmsInstanceId.getInstance(this).deleteToken(appId, "HCM")
                            result.success(null)
                        } catch (error: Exception) {
                            result.error("HMS_UNREGISTER_FAILED", error.message, null)
                        }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun requestPushRegistration(channel: String, result: MethodChannel.Result, appId: String?) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingChannel = channel
            pendingResult = result
            pendingHmsAppId = appId
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4102)
            return
        }
        fetchToken(channel, result, appId)
    }

    private fun fetchToken(channel: String, result: MethodChannel.Result, appId: String?) {
        try {
            when (channel) {
                "fcm" -> FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { token -> result.success(token) }
                    .addOnFailureListener { error ->
                        result.error("FCM_NOT_CONFIGURED", error.message ?: "FCM 初始化失败，请检查 google-services.json", null)
                    }
                "hms" -> {
                    if (appId.isNullOrBlank()) {
                        result.error("HMS_NOT_CONFIGURED", "HMS_APP_ID 未配置", null)
                        return
                    }
                    Thread {
                        try {
                            val token = HmsInstanceId.getInstance(this).getToken(appId, "HCM")
                            runOnUiThread { result.success(token) }
                        } catch (error: Exception) {
                            runOnUiThread {
                                result.error("HMS_REGISTRATION_FAILED", error.message ?: "请检查 agconnect-services.json", null)
                            }
                        }
                    }.start()
                }
                else -> result.error("UNKNOWN_CHANNEL", channel, null)
            }
        } catch (error: Exception) {
            result.error("PUSH_NOT_CONFIGURED", error.message, null)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 4102) return
        val result = pendingResult ?: return
        val channel = pendingChannel ?: return
        pendingResult = null
        pendingChannel = null
        val appId = pendingHmsAppId
        pendingHmsAppId = null
        if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            fetchToken(channel, result, appId)
        } else {
            result.error("NOTIFICATION_PERMISSION_DENIED", "用户未允许系统通知", null)
        }
    }
}
