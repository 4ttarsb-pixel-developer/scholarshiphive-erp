import 'package:flutter/material.dart';

import '../services/attendance_service.dart';
import '../services/session_service.dart';
import '../services/network_tracking_service.dart';
import '../theme/app_theme.dart';
import '../widgets/gradient_scaffold.dart';
import 'blocked_screen.dart';
import 'login_screen.dart';
import 'home_screen.dart';
import 'management_dashboard_screen.dart';
import 'reception_dashboard_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

enum _SplashState { checking, error }

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  _SplashState _state = _SplashState.checking;

  String _errorMessage = '';

  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    )..repeat(reverse: true);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _runCheck();
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _runCheck() async {
    if (!mounted) return;

    setState(() {
      _state = _SplashState.checking;
      _errorMessage = '';
    });

    try {
      debugPrint('SPLASH: Network check start');

      final bool allowed = await AttendanceService.checkNetwork();

      debugPrint('SPLASH: Network check result = $allowed');

      if (!mounted) return;

      if (allowed) {
        final saved = await SessionService.read();
        if (!mounted) return;

        if (saved != null) {
          bool valid = false;
          if (saved.kind == 'management') {
            valid = await AttendanceService.validateAdminSession(saved.adminToken);
          } else {
            valid = await AttendanceService.isSessionActive(saved.sessionId);
          }

          if (!mounted) return;
          if (valid) {
            Widget destination;
            if (saved.kind == 'management') {
              destination = ManagementDashboardScreen(
                userName: saved.userName,
                role: saved.role,
                adminToken: saved.adminToken,
              );
            } else if (saved.kind == 'reception') {
              destination = ReceptionDashboardScreen(
                userName: saved.userName,
                role: saved.role,
                sessionId: saved.sessionId,
              );
            } else {
              destination = HomeScreen(
                sessionId: saved.sessionId,
                userName: saved.userName,
                team: saved.team,
                checkInTime: saved.checkInTime,
              );
            }
            Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => destination),
              (route) => false,
            );
            return;
          }
          await SessionService.clear();
        }

        debugPrint('SPLASH: Opening LoginScreen');
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
          (route) => false,
        );
        return;
      }

      debugPrint('SPLASH: Network blocked');

      final savedOutsideNetwork = await SessionService.read();
      if (savedOutsideNetwork != null &&
          savedOutsideNetwork.kind == 'employee' &&
          savedOutsideNetwork.sessionId.isNotEmpty) {
        await NetworkTrackingService.markDisconnected(
          savedOutsideNetwork.sessionId,
        );
      }
      if (!mounted) return;

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const BlockedScreen()),
        (route) => false,
      );
    } on AttendanceException catch (e) {
      debugPrint('SPLASH AttendanceException: ${e.message}');

      if (!mounted) return;

      setState(() {
        _state = _SplashState.error;
        _errorMessage = e.message;
      });
    } catch (e, stackTrace) {
      debugPrint('SPLASH Unexpected Error: $e');

      debugPrint('SPLASH StackTrace: $stackTrace');

      if (!mounted) return;

      setState(() {
        _state = _SplashState.error;
        _errorMessage = 'Unexpected error: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      gradientColors: AppColors.primaryGradient,
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600),
              child: _state == _SplashState.checking
                  ? _buildChecking()
                  : _buildError(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildChecking() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ScaleTransition(
          scale: Tween<double>(begin: 0.85, end: 1.0).animate(
            CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
          ),
          child: Container(
            width: 96,
            height: 96,
            padding: const EdgeInsets.all(6),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: ClipOval(
              child: Image.asset(
                'assets/images/app_logo.png',
                fit: BoxFit.contain,
              ),
            ),
          ),
        ),
        const SizedBox(height: 28),
        const Text(
          'Checking network connection...',
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        const Text(
          'Please wait a moment',
          style: TextStyle(color: Colors.white70, fontSize: 14),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildError() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 96,
          height: 96,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.15),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.error_outline, color: Colors.white, size: 48),
        ),
        const SizedBox(height: 24),
        Text(
          _errorMessage.isEmpty
              ? 'Network verification failed.'
              : _errorMessage,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w500,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _runCheck,
            icon: const Icon(Icons.refresh),
            label: const Text('Dobara Koshish Karein'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.primary,
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ),
      ],
    );
  }
}

