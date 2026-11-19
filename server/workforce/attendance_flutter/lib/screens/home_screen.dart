import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/attendance_service.dart';
import '../services/biometric_service.dart';
import '../services/device_service.dart';
import '../services/network_tracking_service.dart';
import '../services/session_service.dart';
import '../theme/app_theme.dart';
import '../widgets/gradient_scaffold.dart';
import 'login_screen.dart';
import 'report_screen.dart';

class HomeScreen extends StatefulWidget {
  final String sessionId;
  final String userName;
  final String team;
  final String checkInTime;

  const HomeScreen({
    super.key,
    required this.sessionId,
    required this.userName,
    this.checkInTime = '',
    this.team = 'Processing',
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  bool _checkingOut = false;
  List<dynamic> _notices = [];
  int _unreadCount = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    NetworkTrackingService.start(widget.sessionId);
    _fetchEmployeeNotices();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      NetworkTrackingService.checkNow();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _fetchEmployeeNotices() async {
    try {
      final uri = Uri.parse(
        '${ApiConfig.serverBaseUrl}/api/workforce/notes/feed/${Uri.encodeComponent(widget.userName.toLowerCase())}',
      ).replace(queryParameters: {'team': widget.team.toLowerCase()});
      final res = await http.get(
        uri,
        headers: ApiConfig.sessionHeaders(widget.sessionId),
      );

      if (res.statusCode == 200 && mounted) {
        final list = jsonDecode(res.body) as List<dynamic>;
        setState(() {
          _notices = list;
          _unreadCount = list.length;
        });

        // Show popup once on login if new notices exist
        if (_notices.isNotEmpty) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _showLatestAnnouncementAlert();
          });
        }
      }
    } catch (_) {
      // Ignore background network fetch issues
    }
  }

  void _showLatestAnnouncementAlert() {
    if (_notices.isEmpty) return;
    final latest = _notices.first;

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.campaign, color: Colors.indigo, size: 28),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Notice Alert',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              latest['title'] ?? '',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              latest['content'] ?? '',
              style: const TextStyle(fontSize: 14, height: 1.4),
            ),
            const SizedBox(height: 12),
            Text(
              'Published by: ${latest['authorRole'] ?? 'Management'} (${latest['createdAt'] ?? ''})',
              style: const TextStyle(fontSize: 11, color: Colors.grey),
            ),
          ],
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.indigo,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              setState(() {
                if (_unreadCount > 0) _unreadCount--;
              });
            },
            child: const Text('Acknowledged'),
          ),
        ],
      ),
    );
  }

  void _showNoticesBottomSheet() {
    // Clear unread badge counter upon viewing announcements
    setState(() {
      _unreadCount = 0;
    });

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.75,
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Expanded(
                    child: Row(
                      children: [
                        Icon(Icons.campaign, color: Colors.indigo, size: 24),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Official Announcements',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const Divider(),
              Expanded(
                child: _notices.isEmpty
                    ? const Center(
                        child: Text(
                          'No announcements at this time.',
                          style: TextStyle(color: Colors.grey),
                        ),
                      )
                    : ListView.builder(
                        itemCount: _notices.length,
                        itemBuilder: (ctx, i) {
                          final item = _notices[i];
                          return Card(
                            elevation: 1,
                            margin: const EdgeInsets.only(bottom: 12),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          item['title'] ?? '',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 15,
                                          ),
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 6,
                                          vertical: 2,
                                        ),
                                        decoration: BoxDecoration(
                                          color: Colors.indigo.shade50,
                                          borderRadius: BorderRadius.circular(
                                            4,
                                          ),
                                        ),
                                        child: Text(
                                          item['authorRole'] ?? 'Management',
                                          style: TextStyle(
                                            fontSize: 10,
                                            color: Colors.indigo.shade800,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    item['content'] ?? '',
                                    style: const TextStyle(
                                      fontSize: 13,
                                      height: 1.4,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    item['createdAt'] ?? '',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: Colors.grey,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _handleCheckOutTap() async {
    setState(() => _checkingOut = true);
    try {
      final result = await AttendanceService.verifyForCheckout(
        widget.sessionId,
      );
      if (!mounted) return;

      if (!result.eligible) {
        _showSnack(
          'You must be connected to the registered network to check out.',
          isError: true,
        );
        return;
      }

      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ReportScreen(
            sessionId: widget.sessionId,
            userName: widget.userName,
          ),
        ),
      );
    } on AttendanceException catch (e) {
      _showSnack(e.message, isError: true);
    } catch (_) {
      _showSnack(
        'An unexpected error occurred. Please try again.',
        isError: true,
      );
    } finally {
      if (mounted) setState(() => _checkingOut = false);
    }
  }

  void _showSnack(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? AppColors.error : AppColors.success,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  String get _formattedTime {
    if (widget.checkInTime.length < 5) return '--:--';
    return widget.checkInTime.substring(0, 5);
  }

  Future<void> _showChangePasswordDialog() async {
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    String? errorMessage;
    bool isSaving = false;
    bool isRegisteringBiometric = false;
    bool fingerprintReady = false;

    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            insetPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 24,
            ),
            title: const Text('Change Password'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: currentPasswordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Current password',
                    ),
                  ),
                  TextField(
                    controller: newPasswordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'New password',
                    ),
                  ),
                  TextField(
                    controller: confirmPasswordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Confirm new password',
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Divider(),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Fingerprint sign-in',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Scan your fingerprint here, then press Save. It is stored with this employee account.',
                    style: TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: isSaving || isRegisteringBiometric
                          ? null
                          : () async {
                              setDialogState(() {
                                isRegisteringBiometric = true;
                                errorMessage = null;
                              });

                              try {
                                if (!await BiometricService.isBiometricAvailable()) {
                                  throw AttendanceException(
                                    'Fingerprint authentication is unavailable on this device.',
                                  );
                                }
                                if (!await BiometricService.authenticateUser(
                                  reason:
                                      'Register fingerprint sign-in for your account',
                                )) {
                                  throw AttendanceException(
                                    'Fingerprint verification failed.',
                                  );
                                }

                                if (dialogContext.mounted) {
                                  setDialogState(() {
                                    fingerprintReady = true;
                                    errorMessage = null;
                                  });
                                }
                              } catch (error) {
                                if (dialogContext.mounted) {
                                  setDialogState(
                                    () => errorMessage = error.toString(),
                                  );
                                }
                              } finally {
                                if (dialogContext.mounted) {
                                  setDialogState(
                                    () => isRegisteringBiometric = false,
                                  );
                                }
                              }
                            },
                      icon: isRegisteringBiometric
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(
                              fingerprintReady
                                  ? Icons.check_circle
                                  : Icons.fingerprint,
                              color: fingerprintReady
                                  ? AppColors.success
                                  : null,
                            ),
                      label: Text(
                        isRegisteringBiometric
                            ? 'Scanning...'
                            : fingerprintReady
                            ? 'Fingerprint captured'
                            : 'Scan Fingerprint',
                      ),
                    ),
                  ),
                  if (errorMessage != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      errorMessage!,
                      style: const TextStyle(color: AppColors.error),
                    ),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: isSaving || isRegisteringBiometric
                    ? null
                    : () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: isSaving || isRegisteringBiometric
                    ? null
                    : () async {
                        final currentPassword = currentPasswordController.text;
                        final newPassword = newPasswordController.text;
                        final confirmPassword = confirmPasswordController.text;
                        final wantsPasswordChange =
                            newPassword.isNotEmpty || confirmPassword.isNotEmpty;

                        if (currentPassword.isEmpty) {
                          setDialogState(() {
                            errorMessage = 'Current password is required.';
                          });
                          return;
                        }

                        if (!wantsPasswordChange && !fingerprintReady) {
                          setDialogState(() {
                            errorMessage =
                                'Scan your fingerprint or enter a new password, then press Save.';
                          });
                          return;
                        }

                        if (wantsPasswordChange &&
                            (newPassword.isEmpty || confirmPassword.isEmpty)) {
                          setDialogState(() {
                            errorMessage = 'Complete all password fields.';
                          });
                          return;
                        }

                        if (wantsPasswordChange && newPassword != confirmPassword) {
                          setDialogState(() {
                            errorMessage = 'New passwords do not match.';
                          });
                          return;
                        }

                        setDialogState(() {
                          isSaving = true;
                          errorMessage = null;
                        });

                        try {
                          if (fingerprintReady) {
                            final deviceId = await DeviceService.getDeviceId();
                            final token = await AttendanceService.registerBiometric(
                              username: widget.userName,
                              password: currentPassword,
                              deviceId: deviceId,
                            );
                            await BiometricService.saveToken(
                              widget.userName,
                              token,
                            );
                          }

                          if (wantsPasswordChange) {
                            await AttendanceService.changePassword(
                              username: widget.userName,
                              currentPassword: currentPassword,
                              newPassword: newPassword,
                            );
                          }

                          if (!dialogContext.mounted) return;
                          Navigator.of(dialogContext).pop();
                          if (mounted) {
                            final message = fingerprintReady && wantsPasswordChange
                                ? 'Password changed and fingerprint saved for this account.'
                                : fingerprintReady
                                ? 'Fingerprint saved. You can check in with your fingerprint.'
                                : 'Password changed successfully.';
                            _showSnack(message);
                          }
                        } on AttendanceException catch (error) {
                          if (dialogContext.mounted) {
                            setDialogState(() {
                              errorMessage = error.message;
                              isSaving = false;
                            });
                          }
                        } catch (error) {
                          if (dialogContext.mounted) {
                            setDialogState(() {
                              errorMessage = error.toString();
                              isSaving = false;
                            });
                          }
                        }
                      },
                child: isSaving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save'),
              ),
            ],
          ),
        ),
      );
    } finally {
      // Wait for the dialog reverse animation to finish before disposing
      // controllers that were attached to TextFields in that route.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      currentPasswordController.dispose();
      newPasswordController.dispose();
      confirmPasswordController.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      gradientColors: AppColors.primaryGradient,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Header with bell badge and logout
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        IconButton(
                          icon: const Icon(
                            Icons.notifications_outlined,
                            color: Colors.white,
                            size: 28,
                          ),
                          tooltip: 'Announcements',
                          onPressed: _showNoticesBottomSheet,
                        ),
                        if (_unreadCount > 0)
                          Positioned(
                            right: 4,
                            top: 4,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.redAccent,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: Colors.white,
                                  width: 1.5,
                                ),
                              ),
                              child: Text(
                                '$_unreadCount',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(
                        Icons.lock_outline,
                        color: Colors.white70,
                      ),
                      tooltip: 'Change Password',
                      onPressed: _showChangePasswordDialog,
                    ),
                    IconButton(
                      icon: const Icon(Icons.logout, color: Colors.white70),
                      tooltip: 'Sign Out',
                      onPressed: () async {
                        await NetworkTrackingService.stop();
                        await SessionService.clear();
                        if (!context.mounted) return;
                        Navigator.of(context).pushAndRemoveUntil(
                          MaterialPageRoute(
                            builder: (_) => const LoginScreen(),
                          ),
                          (route) => false,
                        );
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 8),

                const CircleAvatar(
                  radius: 38,
                  backgroundColor: Colors.white24,
                  child: Icon(Icons.person, color: Colors.white, size: 38),
                ),
                const SizedBox(height: 14),
                Text(
                  'Welcome, ${widget.userName}!',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 28),

                // Clean Check-In Status Card
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.08),
                        blurRadius: 15,
                        offset: const Offset(0, 5),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.success.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(
                              Icons.check_circle,
                              color: AppColors.success,
                            ),
                          ),
                          const SizedBox(width: 14),
                          const Expanded(
                            child: Text(
                              'You Are Checked In',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      const Divider(height: 1),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Check-in Time',
                            style: TextStyle(color: AppColors.textMuted),
                          ),
                          Text(
                            _formattedTime,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 28),

                // Check-Out Button
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _checkingOut ? null : _handleCheckOutTap,
                    icon: _checkingOut
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.logout),
                    label: Text(_checkingOut ? 'Checking Out...' : 'Check Out'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.accent,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
