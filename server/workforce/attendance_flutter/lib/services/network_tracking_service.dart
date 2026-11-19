import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'attendance_service.dart';
import 'device_service.dart';

class NetworkTrackingService {
  static Timer? _timer;
  static String? _sessionId;
  static bool _checking = false;

  static String _key(String sessionId) =>
      'network_disconnect_started_${sessionId.trim()}';

  static Future<void> start(String sessionId) async {
    if (sessionId.trim().isEmpty) return;
    _sessionId = sessionId.trim();
    _timer?.cancel();
    await checkNow();
    _timer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => checkNow(),
    );
  }

  static Future<void> markDisconnected(String sessionId) async {
    if (sessionId.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final key = _key(sessionId.trim());
    final existing = prefs.getString(key);
    if (existing == null || existing.isEmpty) {
      await prefs.setString(key, DateTime.now().toIso8601String());
    }
  }

  static Future<void> checkNow() async {
    final sessionId = _sessionId;
    if (sessionId == null || sessionId.isEmpty || _checking) return;
    _checking = true;
    try {
      bool connected = false;
      try {
        connected = await AttendanceService.checkNetwork();
      } catch (_) {
        connected = false;
      }

      final prefs = await SharedPreferences.getInstance();
      final key = _key(sessionId);
      final startedRaw = prefs.getString(key);

      if (!connected) {
        if (startedRaw == null || startedRaw.isEmpty) {
          await prefs.setString(key, DateTime.now().toIso8601String());
        }
        return;
      }

      if (startedRaw == null || startedRaw.isEmpty) return;

      final disconnectedAt = DateTime.tryParse(startedRaw);
      if (disconnectedAt == null) {
        await prefs.remove(key);
        return;
      }

      final reconnectedAt = DateTime.now();
      if (!reconnectedAt.isAfter(disconnectedAt)) {
        await prefs.remove(key);
        return;
      }

      final deviceId = await DeviceService.getDeviceId();
      await AttendanceService.recordNetworkInterval(
        sessionId: sessionId,
        deviceId: deviceId,
        disconnectedAt: disconnectedAt,
        reconnectedAt: reconnectedAt,
      );
      await prefs.remove(key);
    } catch (e) {
      debugPrint('Network tracking error: $e');
    } finally {
      _checking = false;
    }
  }

  static Future<void> flushPendingInterval(String sessionId) async {
    final cleanSessionId = sessionId.trim();
    if (cleanSessionId.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final key = _key(cleanSessionId);
    final startedRaw = prefs.getString(key);
    if (startedRaw == null || startedRaw.isEmpty) return;

    final disconnectedAt = DateTime.tryParse(startedRaw);
    if (disconnectedAt == null) {
      await prefs.remove(key);
      return;
    }

    final checkoutAt = DateTime.now();
    if (!checkoutAt.isAfter(disconnectedAt)) {
      await prefs.remove(key);
      return;
    }

    final deviceId = await DeviceService.getDeviceId();
    await AttendanceService.recordNetworkInterval(
      sessionId: cleanSessionId,
      deviceId: deviceId,
      disconnectedAt: disconnectedAt,
      reconnectedAt: checkoutAt,
    );
    await prefs.remove(key);
  }

  static Future<void> stop({bool clearOpenInterval = false}) async {
    _timer?.cancel();
    _timer = null;
    final sessionId = _sessionId;
    _sessionId = null;
    if (clearOpenInterval && sessionId != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_key(sessionId));
    }
  }
}
