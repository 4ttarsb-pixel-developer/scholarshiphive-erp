import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import '../services/attendance_service.dart';
import '../services/biometric_service.dart';
import '../services/device_service.dart';
import '../services/session_service.dart';
import '../theme/app_theme.dart';
import '../widgets/gradient_scaffold.dart';
import 'home_screen.dart';
import 'management_dashboard_screen.dart';
import 'reception_dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _loggingIn = false;
  String? _errorMessage;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin({bool requireBiometrics = false}) async {
    String username = _usernameController.text.trim();

    if (requireBiometrics) {
      if (username.isEmpty) {
        final savedUsername = await BiometricService.readSavedUsername();

        if (savedUsername == null || savedUsername.isEmpty) {
          if (mounted) {
            setState(() {
              _errorMessage =
                  'Fingerprint login is not registered yet. Sign in with your username and password first, then enable fingerprint sign-in from account settings.';
            });
          }
          return;
        }

        username = savedUsername;
        _usernameController.text = savedUsername;
      }
    } else if (!_formKey.currentState!.validate()) {
      return;
    }

    if (mounted) {
      setState(() {
        _loggingIn = true;
        _errorMessage = null;
      });
    }

    try {
      String? biometricToken;

      if (requireBiometrics) {
        if (!await BiometricService.isBiometricAvailable()) {
          throw AttendanceException(
            'Fingerprint authentication is unavailable on this device.',
          );
        }

        biometricToken = await BiometricService.readToken(username);
        if (biometricToken == null || biometricToken.isEmpty) {
          throw AttendanceException(
            'Fingerprint login is not registered for this account. Sign in with your password first and enable fingerprint sign-in.',
          );
        }

        final authenticated = await BiometricService.authenticateUser(
          reason: 'Scan your fingerprint to sign in',
        );

        if (!authenticated) {
          throw AttendanceException(
            'Fingerprint verification failed or was cancelled.',
          );
        }
      }

      final deviceId = await DeviceService.getDeviceId();
      final request = <String, dynamic>{
        'username': username,
        'deviceId': deviceId,
        if (requireBiometrics)
          'biometricToken': biometricToken
        else
          'password': _passwordController.text,
      };

      final res = await http.post(
        Uri.parse('${ApiConfig.serverBaseUrl}/api/attendance/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(request),
      );

      Map<String, dynamic> data;
      try {
        final decoded = jsonDecode(res.body);
        if (decoded is Map) {
          data = Map<String, dynamic>.from(decoded);
        } else {
          throw const FormatException();
        }
      } catch (_) {
        throw AttendanceException(
          'The server returned an invalid login response.',
        );
      }

      if (res.statusCode == 200 && data['success'] == true) {
        if (!mounted) return;

        final bool isManagement = data['isManagement'] ?? false;
        final bool isReception = data['isReception'] ?? false;
        final String role = data['role'] ?? 'Staff';
        final String userName = data['userName'] ?? username.toUpperCase();
        final String sessionId = data['sessionId'] ?? '';
        final String userTeam = data['team'] ?? 'Processing';
        final String checkInTime = data['checkInTime'] ?? '';
        final String? returnedAdminToken = data['adminToken'] as String?;

        await SessionService.save(
          SavedAppSession(
            kind: isManagement
                ? 'management'
                : isReception
                    ? 'reception'
                    : 'employee',
            userName: userName,
            role: role,
            sessionId: sessionId,
            team: userTeam,
            checkInTime: checkInTime,
            adminToken: returnedAdminToken ?? '',
          ),
        );

        if (isManagement) {
          final adminToken = returnedAdminToken;
          if (adminToken == null || adminToken.isEmpty) {
            setState(() {
              _errorMessage =
                  'Management sign-in did not return an admin session. Please try again.';
            });
            return;
          }

          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(
              builder: (_) => ManagementDashboardScreen(
                userName: userName,
                role: role,
                adminToken: adminToken,
              ),
            ),
            (route) => false,
          );
        } else if (isReception) {
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(
              builder: (_) => ReceptionDashboardScreen(
                userName: userName,
                role: role,
                sessionId: sessionId,
              ),
            ),
            (route) => false,
          );
        } else {
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(
              builder: (_) => HomeScreen(
                sessionId: sessionId,
                userName: userName,
                team: userTeam,
                checkInTime: checkInTime,
              ),
            ),
            (route) => false,
          );
        }
      } else {
        if (!mounted) return;
        setState(() {
          _errorMessage =
              data['message']?.toString() ??
              data['reason']?.toString() ??
              'Authentication failed.';
        });
      }
    } on AttendanceException catch (e) {
      if (mounted) {
        setState(() => _errorMessage = e.message);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = 'Connection error: ${e.toString()}');
      }
    } finally {
      if (mounted) {
        setState(() => _loggingIn = false);
      }
    }
  }

  void _showResultPopup({
    required String title,
    required String message,
    required IconData icon,
    required Color color,
  }) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: color,
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        content: Text(
          message,
          style: const TextStyle(fontSize: 13, height: 1.4),
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: color,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  // Shift Management Dialog (No Overflow on iPhone/Mobile + Blank Timing Field)
  Future<void> _showShiftDialog() async {
    final shiftUserCtrl = TextEditingController(
      text: _usernameController.text.trim(),
    );
    final shiftPassCtrl = TextEditingController(text: _passwordController.text);
    final customTimeCtrl =
        TextEditingController(); // <-- EMPTY BY DEFAULT (NO PRE-FILLED TEXT)
    // ERP PostgreSQL shift list is fetched before opening the dialog.
    // Do not fall back to hardcoded shift names if the server is offline.
    List<dynamic> availableShifts;
    try {
      final response = await http.get(
        Uri.parse('${ApiConfig.serverBaseUrl}/api/attendance/available-shifts'),
      ).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        throw Exception('Unable to load shifts (HTTP ${response.statusCode})');
      }
      final payload = jsonDecode(response.body) as Map<String, dynamic>;
      availableShifts = payload['shifts'] as List<dynamic>? ?? [];
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not load ERP shifts: $e')),
      );
      return;
    }
    if (!mounted) return;
    String selectedShift = availableShifts.isNotEmpty
        ? (availableShifts.first as Map<String, dynamic>)['name'].toString()
        : 'Custom';
    bool isSubmitting = false;

    await showDialog(
      context: context,
      builder: (ctx) {
        final screenWidth = MediaQuery.of(ctx).size.width;
        final dialogWidth = screenWidth > 460 ? 400.0 : screenWidth * 0.88;

        return StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            insetPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 24,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: const Row(
              children: [
                Icon(Icons.schedule_outlined, color: Colors.blueAccent),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Shift Management',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            content: SizedBox(
              width: dialogWidth,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Select working shift or submit custom hours for approval.',
                      style: TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                    const SizedBox(height: 14),

                    TextField(
                      controller: shiftUserCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Username',
                        prefixIcon: Icon(Icons.person_outline),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: shiftPassCtrl,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'Password',
                        prefixIcon: Icon(Icons.lock_outline),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),

                    DropdownButtonFormField<String>(
                      initialValue: selectedShift,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Shift Option',
                        prefixIcon: Icon(Icons.access_time),
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.fromLTRB(12, 16, 8, 16),
                      ),
                      items: [
                        ...availableShifts.map((shift) {
                          final row = shift as Map<String, dynamic>;
                          final name = row['name'].toString();
                          final start = row['start_time'].toString().substring(0, 5);
                          final end = row['end_time'].toString().substring(0, 5);
                          return DropdownMenuItem<String>(
                            value: name,
                            child: Text('$name ($start - $end)',
                              overflow: TextOverflow.ellipsis),
                          );
                        }),
                        const DropdownMenuItem<String>(
                          value: 'Custom',
                          child: Text('Custom Hours (Needs Approval)',
                            overflow: TextOverflow.ellipsis),
                        ),
                      ],
                      onChanged: (val) {
                        if (val != null) {
                          setDialogState(() => selectedShift = val);
                        }
                      },
                    ),
                    const SizedBox(height: 12),

                    if (selectedShift == 'Custom') ...[
                      TextField(
                        controller: customTimeCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Specify Custom Timing',
                          hintText: 'e.g. 10:00 AM - 07:00 PM',
                          prefixIcon: Icon(Icons.edit_calendar_outlined),
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Note: Custom shifts require management review before activation.',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.orange,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blueAccent,
                  foregroundColor: Colors.white,
                ),
                onPressed: isSubmitting
                    ? null
                    : () async {
                        final u = shiftUserCtrl.text.trim();
                        final p = shiftPassCtrl.text;
                        final customTime = customTimeCtrl.text.trim();

                        if (u.isEmpty || p.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Username and Password are required!',
                              ),
                            ),
                          );
                          return;
                        }

                        if (selectedShift == 'Custom' && customTime.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Please enter your custom hours timing!',
                              ),
                            ),
                          );
                          return;
                        }

                        setDialogState(() => isSubmitting = true);
                        bool dialogClosed = false;
                        try {
                          final res = await http.post(
                            Uri.parse(
                              '${ApiConfig.serverBaseUrl}/api/attendance/shift/select',
                            ),
                            headers: {'Content-Type': 'application/json'},
                            body: jsonEncode({
                              'username': u,
                              'password': p,
                              'shiftType': selectedShift,
                              'customTiming': selectedShift == 'Custom'
                                  ? customTime
                                  : null,
                            }),
                          );

                          if (ctx.mounted) {
                            dialogClosed = true;
                            Navigator.of(ctx).pop();
                          }
                          await Future<void>.delayed(
                            const Duration(milliseconds: 250),
                          );
                          if (!mounted) return;
                          final b = jsonDecode(res.body);

                          if (res.statusCode == 200) {
                            _showResultPopup(
                              title: 'Shift Confirmed',
                              message:
                                  b['message'] ??
                                  'Shift configured successfully.',
                              icon: Icons.check_circle_outline,
                              color: Colors.green,
                            );
                          } else {
                            _showResultPopup(
                              title: 'Failed',
                              message:
                                  b['message'] ?? 'Could not process shift.',
                              icon: Icons.error_outline,
                              color: Colors.red,
                            );
                          }
                        } catch (e) {
                          if (!dialogClosed && ctx.mounted) {
                            dialogClosed = true;
                            Navigator.of(ctx).pop();
                          }
                          await Future<void>.delayed(
                            const Duration(milliseconds: 250),
                          );
                          if (!mounted) return;
                          _showResultPopup(
                            title: 'Error',
                            message: e.toString(),
                            icon: Icons.error_outline,
                            color: Colors.red,
                          );
                        }
                      },
                child: const Text('Save Shift'),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showLeaveDialog() async {
    final leaveUserCtrl = TextEditingController(
      text: _usernameController.text.trim(),
    );
    final leavePassCtrl = TextEditingController(text: _passwordController.text);
    final deptCtrl = TextEditingController();
    final reasonCtrl = TextEditingController();
    DateTime selectedDate = DateTime.now();
    String selectedLeaveType = 'Half-Day Leave';
    bool obscureLeavePass = true;
    bool isSubmitting = false;

    await showDialog(
      context: context,
      builder: (ctx) {
        final screenWidth = MediaQuery.of(ctx).size.width;
        final dialogWidth = screenWidth > 480 ? 440.0 : screenWidth * 0.88;

        return StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            insetPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 24,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: const [
                    Icon(
                      Icons.assignment_outlined,
                      color: Colors.indigo,
                      size: 20,
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'SCHOLARSHIPHIVE EDUTANCY',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                          color: Colors.indigo,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'LEAVE APPLICATION FORM',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: Colors.black87,
                  ),
                ),
              ],
            ),
            content: SizedBox(
              width: dialogWidth,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Enter credentials and leave details for administrative approval.',
                      style: TextStyle(fontSize: 11, color: Colors.black54),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: leaveUserCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Employee Username',
                        hintText: 'e.g. ali, sara, reception',
                        prefixIcon: Icon(Icons.person_outline),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: leavePassCtrl,
                      obscureText: obscureLeavePass,
                      decoration: InputDecoration(
                        labelText: 'Employee Password (Signature)',
                        prefixIcon: const Icon(Icons.lock_outline),
                        border: const OutlineInputBorder(),
                        suffixIcon: IconButton(
                          icon: Icon(
                            obscureLeavePass
                                ? Icons.visibility_off
                                : Icons.visibility,
                          ),
                          onPressed: () => setDialogState(
                            () => obscureLeavePass = !obscureLeavePass,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: deptCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Department',
                        hintText: 'e.g. Processing, Counseling, Reception',
                        prefixIcon: Icon(Icons.badge_outlined),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),

                    DropdownButtonFormField<String>(
                      initialValue: selectedLeaveType,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Leave Category',
                        prefixIcon: Icon(Icons.timelapse_outlined),
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.fromLTRB(12, 16, 8, 16),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'Half-Day Leave',
                          child: Text('Half-Day Leave'),
                        ),
                        DropdownMenuItem(
                          value: 'Full-Day Leave',
                          child: Text('Full-Day Leave'),
                        ),
                      ],
                      onChanged: (val) {
                        if (val != null) {
                          setDialogState(() => selectedLeaveType = val);
                        }
                      },
                    ),
                    const SizedBox(height: 12),

                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey.shade400),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Date: ${DateFormat('yyyy-MM-dd').format(selectedDate)}',
                            style: const TextStyle(fontSize: 13),
                          ),
                          TextButton(
                            onPressed: () async {
                              final picked = await showDatePicker(
                                context: context,
                                initialDate: selectedDate,
                                firstDate: DateTime.now(),
                                lastDate: DateTime.now().add(
                                  const Duration(days: 30),
                                ),
                              );
                              if (picked != null) {
                                setDialogState(() => selectedDate = picked);
                              }
                            },
                            child: const Text('Change'),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: reasonCtrl,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: 'Reason for Leave',
                        prefixIcon: Icon(Icons.description_outlined),
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.indigo,
                  foregroundColor: Colors.white,
                ),
                onPressed: isSubmitting
                    ? null
                    : () async {
                        final u = leaveUserCtrl.text.trim();
                        final p = leavePassCtrl.text;
                        final dept = deptCtrl.text.trim().isEmpty
                            ? 'General'
                            : deptCtrl.text.trim();
                        final r = reasonCtrl.text.trim();

                        if (u.isEmpty || p.isEmpty || r.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('All fields are required!'),
                            ),
                          );
                          return;
                        }

                        setDialogState(() => isSubmitting = true);
                        bool dialogClosed = false;
                        try {
                          final formattedDate = DateFormat(
                            'yyyy-MM-dd',
                          ).format(selectedDate);
                          final res = await http.post(
                            Uri.parse(
                              '${ApiConfig.serverBaseUrl}/api/attendance/leave/apply',
                            ),
                            headers: {'Content-Type': 'application/json'},
                            body: jsonEncode({
                              'username': u,
                              'password': p,
                              'leaveType': selectedLeaveType,
                              'department': dept,
                              'reason': r,
                              'leaveDate': formattedDate,
                            }),
                          );

                          if (ctx.mounted) {
                            dialogClosed = true;
                            Navigator.of(ctx).pop();
                          }
                          await Future<void>.delayed(
                            const Duration(milliseconds: 250),
                          );
                          if (!mounted) return;

                          if (res.statusCode == 200) {
                            _showResultPopup(
                              title: 'Leave Submitted',
                              message:
                                  'Employee: $u\nCategory: $selectedLeaveType\nDate: $formattedDate\nSignature: Verified âœ“\nStatus: Pending Approval',
                              icon: Icons.check_circle_outline,
                              color: Colors.green,
                            );
                          } else {
                            final b = jsonDecode(res.body);
                            _showResultPopup(
                              title: 'Failed',
                              message: b['message'] ?? 'Submission failed.',
                              icon: Icons.error_outline,
                              color: Colors.red,
                            );
                          }
                        } catch (e) {
                          if (!dialogClosed && ctx.mounted) {
                            dialogClosed = true;
                            Navigator.of(ctx).pop();
                          }
                          await Future<void>.delayed(
                            const Duration(milliseconds: 250),
                          );
                          if (!mounted) return;
                          _showResultPopup(
                            title: 'Error',
                            message: e.toString(),
                            icon: Icons.error_outline,
                            color: Colors.red,
                          );
                        }
                      },
                child: const Text('Sign & Submit'),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showCheckStatusDialog() async {
    final statusUserCtrl = TextEditingController(
      text: _usernameController.text.trim(),
    );
    final statusPassCtrl = TextEditingController(
      text: _passwordController.text,
    );
    bool isChecking = false;

    await showDialog(
      context: context,
      builder: (ctx) {
        final screenWidth = MediaQuery.of(ctx).size.width;
        final dialogWidth = screenWidth > 440 ? 400.0 : screenWidth * 0.88;

        return StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            insetPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 24,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: const Row(
              children: [
                Icon(Icons.verified_user_outlined, color: Colors.teal),
                SizedBox(width: 8),
                Text(
                  'Check Leave Status',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            content: SizedBox(
              width: dialogWidth,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: statusUserCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Username',
                      prefixIcon: Icon(Icons.person_outline),
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: statusPassCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      prefixIcon: Icon(Icons.lock_outline),
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Close'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.teal,
                  foregroundColor: Colors.white,
                ),
                onPressed: isChecking
                    ? null
                    : () async {
                        final u = statusUserCtrl.text.trim().toLowerCase();
                        final p = statusPassCtrl.text;
                        if (u.isEmpty || p.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Username and Password are required!',
                              ),
                            ),
                          );
                          return;
                        }

                        setDialogState(() => isChecking = true);
                        bool dialogClosed = false;
                        try {
                          final res = await http.post(
                            Uri.parse(
                              '${ApiConfig.serverBaseUrl}/api/attendance/leave/status',
                            ),
                            headers: {'Content-Type': 'application/json'},
                            body: jsonEncode({'username': u, 'password': p}),
                          );

                          if (ctx.mounted) {
                            dialogClosed = true;
                            Navigator.of(ctx).pop();
                          }
                          await Future<void>.delayed(
                            const Duration(milliseconds: 250),
                          );
                          if (!mounted) return;

                          if (res.statusCode == 200) {
                            final data = jsonDecode(res.body);
                            final status = data['status'] ?? 'Pending';
                            _showResultPopup(
                              title: 'Status: $status',
                              message:
                                  'Employee: $u\nCategory: ${data['leaveType']}\nDate: ${data['leaveDate']}\nSupervisor Stamp:\n${data['supervisorSignature']}',
                              icon: status == 'Approved'
                                  ? Icons.check_circle_outline
                                  : Icons.hourglass_top,
                              color: status == 'Approved'
                                  ? Colors.green
                                  : Colors.orange,
                            );
                          } else {
                            final b = jsonDecode(res.body);
                            _showResultPopup(
                              title: 'Failed',
                              message: b['message'] ?? 'Record not found.',
                              icon: Icons.error_outline,
                              color: Colors.red,
                            );
                          }
                        } catch (e) {
                          if (!dialogClosed && ctx.mounted) {
                            dialogClosed = true;
                            Navigator.of(ctx).pop();
                          }
                          await Future<void>.delayed(
                            const Duration(milliseconds: 250),
                          );
                          if (!mounted) return;
                          _showResultPopup(
                            title: 'Error',
                            message: e.toString(),
                            icon: Icons.error_outline,
                            color: Colors.red,
                          );
                        }
                      },
                child: const Text('Check Status'),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      gradientColors: AppColors.primaryGradient,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 90,
                    height: 90,
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.15),
                          blurRadius: 12,
                        ),
                      ],
                    ),
                    child: ClipOval(
                      child: Image.asset(
                        'assets/images/app_logo.png',
                        fit: BoxFit.contain,
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'ScholarshipHive Portal',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Enter credentials to log in or manage requests',
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  const SizedBox(height: 20),
                  Container(
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
                        TextFormField(
                          controller: _usernameController,
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: 'Username',
                            prefixIcon: Icon(Icons.person_outline),
                          ),
                          validator: (value) =>
                              (value == null || value.trim().isEmpty)
                              ? 'Username is required'
                              : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          onFieldSubmitted: (_) =>
                              _handleLogin(requireBiometrics: false),
                          decoration: InputDecoration(
                            labelText: 'Password',
                            prefixIcon: const Icon(Icons.lock_outline),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_off
                                    : Icons.visibility,
                              ),
                              onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                            ),
                          ),
                          validator: (value) => (value == null || value.isEmpty)
                              ? 'Password is required'
                              : null,
                        ),
                        if (_errorMessage != null) ...[
                          const SizedBox(height: 12),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.error.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.error_outline,
                                  color: AppColors.error,
                                  size: 16,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _errorMessage!,
                                    style: const TextStyle(
                                      color: AppColors.error,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        const SizedBox(height: 20),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed: _loggingIn
                                ? null
                                : () => _handleLogin(requireBiometrics: false),
                            icon: _loggingIn
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(Icons.login),
                            label: Text(
                              _loggingIn ? 'Logging in...' : 'Sign In',
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          alignment: WrapAlignment.center,
                          children: [
                            TextButton.icon(
                              onPressed: _showShiftDialog,
                              icon: const Icon(
                                Icons.access_time,
                                color: Colors.blueAccent,
                                size: 15,
                              ),
                              label: const Text(
                                'Shift Select',
                                style: TextStyle(
                                  color: Colors.blueAccent,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: _showLeaveDialog,
                              icon: const Icon(
                                Icons.assignment_outlined,
                                color: Colors.indigo,
                                size: 15,
                              ),
                              label: const Text(
                                'Apply Leave',
                                style: TextStyle(
                                  color: Colors.indigo,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: _showCheckStatusDialog,
                              icon: const Icon(
                                Icons.verified_outlined,
                                color: Colors.teal,
                                size: 15,
                              ),
                              label: const Text(
                                'Status',
                                style: TextStyle(
                                  color: Colors.teal,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: const [
                            Expanded(child: Divider()),
                            Padding(
                              padding: EdgeInsets.symmetric(horizontal: 10),
                              child: Text(
                                'OR',
                                style: TextStyle(
                                  color: Colors.grey,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                            Expanded(child: Divider()),
                          ],
                        ),
                        const SizedBox(height: 12),
                        InkWell(
                          onTap: _loggingIn
                              ? null
                              : () => _handleLogin(requireBiometrics: true),
                          borderRadius: BorderRadius.circular(50),
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: Colors.blue.withValues(alpha: 0.1),
                              border: Border.all(
                                color: Colors.blue.withValues(alpha: 0.3),
                              ),
                            ),
                            child: const Icon(
                              Icons.fingerprint,
                              size: 36,
                              color: Colors.blue,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

