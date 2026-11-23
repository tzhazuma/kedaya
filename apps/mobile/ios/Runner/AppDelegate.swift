import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var pushToken: String?
  private var pendingTokenResult: FlutterResult?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = window?.rootViewController as! FlutterViewController
    let channel = FlutterMethodChannel(name: "kedaya/push", binaryMessenger: controller.binaryMessenger)
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else { return }
      switch call.method {
      case "registerApns":
        self.pendingTokenResult = result
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
          if let error {
            result(FlutterError(code: "APNS_PERMISSION_ERROR", message: error.localizedDescription, details: nil))
            self.pendingTokenResult = nil
            return
          }
          if !granted {
            result(FlutterError(code: "APNS_PERMISSION_DENIED", message: "用户未允许通知", details: nil))
            self.pendingTokenResult = nil
            return
          }
          DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
          }
        }
      case "unregister":
        UIApplication.shared.unregisterForRemoteNotifications()
        self.pushToken = nil
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    pushToken = token
    pendingTokenResult?(token)
    pendingTokenResult = nil
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    pendingTokenResult?(FlutterError(code: "APNS_REGISTRATION_FAILED", message: error.localizedDescription, details: nil))
    pendingTokenResult = nil
  }
}
