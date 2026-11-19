import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

class SavedAppSession {
  final String kind;
  final String userName;
  final String role;
  final String sessionId;
  final String team;
  final String checkInTime;
  final String adminToken;

  const SavedAppSession({
    required this.kind,
    required this.userName,
    required this.role,
    required this.sessionId,
    required this.team,
    required this.checkInTime,
    required this.adminToken,
  });

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind,
        'userName': userName,
        'role': role,
        'sessionId': sessionId,
        'team': team,
        'checkInTime': checkInTime,
        'adminToken': adminToken,
      };

  factory SavedAppSession.fromJson(Map<String, dynamic> json) {
    return SavedAppSession(
      kind: json['kind']?.toString() ?? 'employee',
      userName: json['userName']?.toString() ?? '',
      role: json['role']?.toString() ?? 'Staff',
      sessionId: json['sessionId']?.toString() ?? '',
      team: json['team']?.toString() ?? 'General',
      checkInTime: json['checkInTime']?.toString() ?? '',
      adminToken: json['adminToken']?.toString() ?? '',
    );
  }
}

class SessionService {
  static const String _key = 'attendance_active_app_session_v1';

  static Future<void> save(SavedAppSession session) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(session.toJson()));
  }

  static Future<SavedAppSession?> read() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        return SavedAppSession.fromJson(Map<String, dynamic>.from(decoded));
      }
    } catch (_) {}
    return null;
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
