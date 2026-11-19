import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiConfig {
  // Unified Workforce ERP backend (Node.js + Express + PostgreSQL).
  // The Cloudflare Worker / D1 backend is retired: PostgreSQL is now the single
  // source of truth for attendance, so all builds must point at the Express API.
  //
  // Override at build/run time with --dart-define, for example:
  //   Chrome / Windows on the same PC : (default) http://localhost:4000
  //   Android emulator                : --dart-define=API_BASE_URL=http://10.0.2.2:4000
  //   Real phone on office Wi-Fi      : --dart-define=API_BASE_URL=http://<PC-LAN-IP>:4000
  //   Production                      : --dart-define=API_BASE_URL=https://your-domain
  // Do not add /api to API_BASE_URL.
  static const String serverBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000',
  );

  // Attendance API ka complete base path
  static const String baseUrl = '$serverBaseUrl/api/workforce/attendance';

  /// Header proving the caller holds an active attendance session. Required by
  /// the unified backend for reception, consent and announcement-feed endpoints
  /// (they were unauthenticated in the old Worker and exposed visitor CNIC data).
  static Map<String, String> sessionHeaders(
    String sessionId, {
    bool json = false,
  }) =>
      <String, String>{
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Attendance-Session': sessionId,
      };
}

class LoginResult {
  final bool success;
  final String sessionId;
  final String userName;
  final bool alreadyCheckedIn;

  LoginResult({
    required this.success,
    required this.sessionId,
    required this.userName,
    this.alreadyCheckedIn = false,
  });
}

class EligibilityResult {
  final bool eligible;
  final String? reason;

  EligibilityResult({required this.eligible, this.reason});
}

class AttendanceException implements Exception {
  final String message;

  AttendanceException(this.message);

  @override
  String toString() => message;
}

class AttendanceService {
  static const Duration _timeout = Duration(seconds: 10);

  static Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  static AttendanceException _mapError(Object e) {
    if (e is AttendanceException) {
      return e;
    }

    if (e is TimeoutException) {
      return AttendanceException(
        'Request timed out. Please try again.',
      );
    }

    if (e is FormatException) {
      return AttendanceException('The server returned an invalid response.');
    }

    return AttendanceException('Network or server issue: $e');
  }

  static Map<String, dynamic> _decodeResponse(http.Response response) {
    if (response.body.trim().isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded = jsonDecode(response.body);

    if (decoded is Map) {
      return Map<String, dynamic>.from(decoded);
    }

    throw AttendanceException('The server returned an unexpected response.');
  }

  static Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body,
  ) async {
    try {
      final Uri url = Uri.parse('${ApiConfig.baseUrl}$path');

      debugPrintApi('POST $url');

      final response = await http
          .post(url, headers: _headers, body: jsonEncode(body))
          .timeout(_timeout);

      debugPrintApi('STATUS ${response.statusCode}');

      debugPrintApi('BODY ${response.body}');

      final Map<String, dynamic> decoded = _decodeResponse(response);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return decoded;
      }

      final String message =
          decoded['message']?.toString() ??
          decoded['reason']?.toString() ??
          'Server error ${response.statusCode}';

      throw AttendanceException(message);
    } catch (e) {
      throw _mapError(e);
    }
  }

  static Future<bool> checkNetwork() async {
    try {
      final url = Uri.parse('${ApiConfig.baseUrl}/check-network');
      debugPrintApi('GET $url');

      final response = await http.get(url, headers: _headers).timeout(_timeout);
      debugPrintApi('STATUS ${response.statusCode}');

      final data = _decodeResponse(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message =
            data['message']?.toString() ??
            'Network check failed (${response.statusCode}).';
        throw AttendanceException(message);
      }

      if (data['allowed'] is bool) {
        return data['allowed'] as bool;
      }
    } catch (e) {
      throw _mapError(e);
    }

    throw AttendanceException('The network check returned an invalid response.');
  }

  static Future<LoginResult> login({
    required String username,
    String? password,
    String? deviceId,
    String? biometricToken,
  }) async {
    final request = <String, dynamic>{
      'username': username.trim(),
      'password': password,
      'deviceId': deviceId ?? 'chrome-browser',
    };
    if (biometricToken != null) {
      request['biometricToken'] = biometricToken;
    }
    final Map<String, dynamic> data = await _post('/login', request);

    return LoginResult(
      success: data['success'] == true,
      sessionId: data['sessionId']?.toString() ?? '',
      userName:
          data['userName']?.toString() ??
          data['username']?.toString() ??
          username.toUpperCase(),
      alreadyCheckedIn: data['alreadyCheckedIn'] == true,
    );
  }

  static Future<String> registerBiometric({
    required String username,
    required String password,
    required String deviceId,
  }) async {
    final data = await _post('/register-biometric', <String, dynamic>{
      'username': username.trim(),
      'password': password,
      'deviceId': deviceId,
    });
    final token = data['token']?.toString();
    if (data['success'] != true || token == null || token.isEmpty) {
      throw AttendanceException(
        'Server did not return a biometric registration token.',
      );
    }
    return token;
  }

  static Future<void> changePassword({
    required String username,
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      final Uri url = Uri.parse('${ApiConfig.baseUrl}/change-password');

      debugPrintApi('POST $url');

      final response = await http
          .post(
            url,
            headers: _headers,
            body: jsonEncode(<String, String>{
              'username': username.trim(),
              'currentPassword': currentPassword,
              'newPassword': newPassword,
            }),
          )
          .timeout(_timeout);

      debugPrintApi('STATUS ${response.statusCode}');

      final Map<String, dynamic> data = _decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final String message =
            data['message']?.toString() ??
            'Server error ${response.statusCode}';

        throw AttendanceException(message);
      }
    } catch (e) {
      throw _mapError(e);
    }
  }


  static Future<bool> isSessionActive(String sessionId) async {
    if (sessionId.trim().isEmpty) return false;
    try {
      final url = Uri.parse(
        '${ApiConfig.baseUrl}/session-status?sessionId=${Uri.encodeQueryComponent(sessionId.trim())}',
      );
      final response = await http.get(url, headers: _headers).timeout(_timeout);
      final data = _decodeResponse(response);
      return response.statusCode == 200 && data['active'] == true;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> validateAdminSession(String adminToken) async {
    if (adminToken.trim().isEmpty) return false;
    try {
      final url = Uri.parse('${ApiConfig.serverBaseUrl}/api/workforce/admin/session');
      final response = await http.get(
        url,
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer ${adminToken.trim()}',
        },
      ).timeout(_timeout);
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<void> recordNetworkInterval({
    required String sessionId,
    required String deviceId,
    required DateTime disconnectedAt,
    required DateTime reconnectedAt,
  }) async {
    await _post('/network-interval', <String, dynamic>{
      'sessionId': sessionId,
      'deviceId': deviceId,
      'disconnectedAt': disconnectedAt.toIso8601String(),
      'reconnectedAt': reconnectedAt.toIso8601String(),
    });
  }

  static Future<EligibilityResult> verifyForCheckout(String sessionId) async {
    final Map<String, dynamic> data = await _post(
      '/verify-checkout',
      <String, dynamic>{'sessionId': sessionId},
    );

    return EligibilityResult(
      eligible: data['eligible'] == true,
      reason: data['reason']?.toString() ?? data['message']?.toString(),
    );
  }

  static Future<void> submitReportAndCheckout({
    required String sessionId,
    required String reportContent,
  }) async {
    await _post('/submit-report', <String, dynamic>{
      'sessionId': sessionId,
      'reportContent': reportContent,
    });
  }
}

// Simple debug helper.
// Web aur Android dono par safe hai.
void debugPrintApi(String message) {
  // ignore: avoid_print
  print('[Attendance API] $message');
}
