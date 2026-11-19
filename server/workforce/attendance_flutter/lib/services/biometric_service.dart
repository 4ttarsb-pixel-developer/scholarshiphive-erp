import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

class BiometricService {
  static final LocalAuthentication _auth = LocalAuthentication();

  static const FlutterSecureStorage _secureStorage =
      FlutterSecureStorage();

  // ============================================================
  // STORAGE KEYS
  // ============================================================

  static const String _savedUsernameKey =
      'employee_biometric_saved_username';

  static String _tokenKey(String username) =>
      'employee_biometric_token_${username.trim().toLowerCase()}';

  // ============================================================
  // CHECK BIOMETRIC
  // ============================================================

  static Future<bool> isBiometricAvailable() async {
    if (kIsWeb) return false;

    try {
      final bool canCheck =
          await _auth.canCheckBiometrics;

      final availableBiometrics =
          await _auth.getAvailableBiometrics();

      return canCheck &&
          availableBiometrics.isNotEmpty;
    } catch (e) {
      debugPrint(
        'Biometric check error: $e',
      );

      return false;
    }
  }

  // ============================================================
  // AUTHENTICATE FINGERPRINT
  // ============================================================

  static Future<bool> authenticateUser({
    String reason =
        'Scan your fingerprint to verify your identity',
  }) async {
    if (kIsWeb) return false;

    try {
      final bool available =
          await isBiometricAvailable();

      if (!available) {
        debugPrint(
          'No biometrics enrolled or available on this device.',
        );

        return false;
      }

      final bool authenticated =
          await _auth.authenticate(
        localizedReason: reason,

        // Sirf fingerprint / biometric.
        // PIN/password fallback nahi.
        biometricOnly: true,

        // App background mein jane ke baad bhi
        // authentication properly continue/retry ho.
        persistAcrossBackgrounding: true,
      );

      return authenticated;
    } catch (e) {
      debugPrint(
        'Biometric authentication error: $e',
      );

      return false;
    }
  }

  // ============================================================
  // SAVE BIOMETRIC TOKEN
  // ============================================================

  static Future<void> saveToken(
    String username,
    String token,
  ) async {
    final cleanUsername =
        username.trim();

    if (cleanUsername.isEmpty ||
        token.isEmpty) {
      return;
    }

    // Employee ka secure biometric token save.
    await _secureStorage.write(
      key: _tokenKey(cleanUsername),
      value: token,
    );

    // Latest registered biometric account ka username
    // bhi locally save karte hain.
    //
    // Is wajah se next login par employee ko
    // username dobara type nahi karna padega.
    await _secureStorage.write(
      key: _savedUsernameKey,
      value: cleanUsername,
    );
  }

  // ============================================================
  // READ BIOMETRIC TOKEN
  // ============================================================

  static Future<String?> readToken(
    String username,
  ) async {
    final cleanUsername =
        username.trim();

    if (cleanUsername.isEmpty) {
      return null;
    }

    return _secureStorage.read(
      key: _tokenKey(cleanUsername),
    );
  }

  // ============================================================
  // READ SAVED BIOMETRIC USERNAME
  // ============================================================

  static Future<String?>
      readSavedUsername() async {
    final username =
        await _secureStorage.read(
      key: _savedUsernameKey,
    );

    if (username == null ||
        username.trim().isEmpty) {
      return null;
    }

    return username.trim();
  }

  // ============================================================
  // CHECK IF BIOMETRIC LOGIN REGISTERED
  // ============================================================

  static Future<bool>
      hasBiometricLogin() async {
    final username =
        await readSavedUsername();

    if (username == null ||
        username.isEmpty) {
      return false;
    }

    final token =
        await readToken(username);

    return token != null &&
        token.isNotEmpty;
  }

  // ============================================================
  // REMOVE BIOMETRIC LOGIN
  // ============================================================

  static Future<void>
      removeBiometricLogin({
    String? username,
  }) async {
    final targetUsername =
        username?.trim().isNotEmpty == true
            ? username!.trim()
            : await readSavedUsername();

    if (targetUsername != null &&
        targetUsername.isNotEmpty) {
      await _secureStorage.delete(
        key: _tokenKey(
          targetUsername,
        ),
      );
    }

    final savedUsername =
        await readSavedUsername();

    if (savedUsername != null &&
        (targetUsername == null ||
            savedUsername
                    .toLowerCase() ==
                targetUsername
                    .toLowerCase())) {
      await _secureStorage.delete(
        key: _savedUsernameKey,
      );
    }
  }
}