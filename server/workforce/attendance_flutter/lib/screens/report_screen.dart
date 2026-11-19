import 'package:flutter/material.dart';
import '../services/attendance_service.dart';
import '../services/network_tracking_service.dart';
import '../services/session_service.dart';
import '../theme/app_theme.dart';
import 'checked_out_screen.dart';

/// User MUST submit a report here before the checkout is finalized.
class ReportScreen extends StatefulWidget {
  final String sessionId;
  final String userName;

  const ReportScreen({super.key, required this.sessionId, required this.userName});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  final _formKey = GlobalKey<FormState>();
  final _reportController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _reportController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    try {
      // Checkout is allowed only while the phone is currently using an
      // approved office Wi-Fi/public IP. Do this BEFORE flushing an away
      // interval so a failed mobile-data checkout cannot falsely mark the
      // employee as reconnected. The Worker enforces the same rule again.
      final onApprovedOfficeNetwork = await AttendanceService.checkNetwork();
      if (!onApprovedOfficeNetwork) {
        throw AttendanceException(
          'Checkout is only allowed while connected to an approved office Wi-Fi network.',
        );
      }

      // Now that office Wi-Fi is verified, close any locally pending away
      // interval at the real return/checkout time before final checkout.
      await NetworkTrackingService.flushPendingInterval(widget.sessionId);

      await AttendanceService.submitReportAndCheckout(
        sessionId: widget.sessionId,
        reportContent: _reportController.text.trim(),
      );
      await NetworkTrackingService.stop(clearOpenInterval: true);
      await SessionService.clear();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const CheckedOutScreen()),
      );
    } on AttendanceException catch (e) {
      _showError(e.message);
    } catch (_) {
      _showError('Report submit nahi ho saki. Dobara koshish karein.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Report Jama Karayein')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Checkout se pehle apni report submit karna zaroori hai.',
                      style: TextStyle(color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 16),
                    Expanded(
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE3E5F0)),
                        ),
                        child: TextFormField(
                          controller: _reportController,
                          maxLines: null,
                          expands: true,
                          textAlignVertical: TextAlignVertical.top,
                          decoration: const InputDecoration(
                            hintText: 'Apni report yahan likhein...',
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            contentPadding: EdgeInsets.all(16),
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Report khali nahi ho sakti';
                            }
                            if (value.trim().length < 5) {
                              return 'Report thori tafseel se likhein';
                            }
                            return null;
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: _submitting ? null : _submit,
                        icon: _submitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.send),
                        label: Text(_submitting ? 'Submit ho raha hai...' : 'Report Submit Kar Ke Check Out Karein'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}