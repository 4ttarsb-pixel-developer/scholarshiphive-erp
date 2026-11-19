import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../services/attendance_service.dart';
import '../services/session_service.dart';
import 'package:intl/intl.dart';
import 'login_screen.dart';

class ReceptionDashboardScreen extends StatefulWidget {
  final String userName;
  final String role;
  final String sessionId;

  const ReceptionDashboardScreen({
    super.key,
    required this.userName,
    required this.role,
    required this.sessionId,
  });

  @override
  State<ReceptionDashboardScreen> createState() =>
      _ReceptionDashboardScreenState();
}

class _ReceptionDashboardScreenState extends State<ReceptionDashboardScreen> {
  int _currentTab = 0; // 0 = Visitor Form, 1 = Visitor Logs, 2 = Consent Studio
  bool _isLoadingVisitors = false;
  String? _visitorLoadError;
  String? _consentLoadError;
  bool _isSubmittingVisitor = false;
  bool _isSubmittingConsent = false;
  List<dynamic> _visitors = [];
  List<dynamic> _consentForms = [];

  // Visitor Form Controllers
  final _fullNameCtrl = TextEditingController();
  final _contactCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _qualificationCtrl = TextEditingController();
  final _cgpaCtrl = TextEditingController();
  final _countryCtrl = TextEditingController();
  final _programCtrl = TextEditingController();
  final _referrerNameCtrl = TextEditingController();
  final _referrerContactCtrl = TextEditingController();
  final _relationshipCtrl = TextEditingController();
  final _counsellorCtrl = TextEditingController();
  final _remarksCtrl = TextEditingController();
  String _inquiryType = 'Walk-in';
  String _counsellingMethod = 'Walk-in';

  // Consent Form Controllers
  final _consentClientNameCtrl = TextEditingController();
  final _consentFamilyNameCtrl = TextEditingController();
  final _consentGenderCtrl = TextEditingController(text: 'Male');
  final _consentCityCtrl = TextEditingController(text: 'Lahore');
  final _consentCnicCtrl = TextEditingController();
  final _consentPhoneCtrl = TextEditingController();
  final _consentPassportCtrl = TextEditingController();
  final _consentAddressCtrl = TextEditingController();
  final _consentEduCtrl = TextEditingController();
  final _consentFeeCtrl = TextEditingController(text: '250000');
  String _selectedPolicyVariant = '50% Refundable (Standard)';

  final List<String> _variants = [
    '50% Refundable (Standard)',
    '30% Refundable (Regional Scholarship)',
    'Non-Refundable (Processing & Admin)',
    'IELTS & CENT-S Specific Variant',
  ];

  @override
  void initState() {
    super.initState();
    _fetchVisitors();
    _fetchConsents();
  }

  @override
  void dispose() {
    _fullNameCtrl.dispose();
    _contactCtrl.dispose();
    _emailCtrl.dispose();
    _qualificationCtrl.dispose();
    _cgpaCtrl.dispose();
    _countryCtrl.dispose();
    _programCtrl.dispose();
    _referrerNameCtrl.dispose();
    _referrerContactCtrl.dispose();
    _relationshipCtrl.dispose();
    _counsellorCtrl.dispose();
    _remarksCtrl.dispose();

    _consentClientNameCtrl.dispose();
    _consentFamilyNameCtrl.dispose();
    _consentGenderCtrl.dispose();
    _consentCityCtrl.dispose();
    _consentCnicCtrl.dispose();
    _consentPhoneCtrl.dispose();
    _consentPassportCtrl.dispose();
    _consentAddressCtrl.dispose();
    _consentEduCtrl.dispose();
    _consentFeeCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchVisitors() async {
    if (mounted) {
      setState(() {
        _isLoadingVisitors = true;
        _visitorLoadError = null;
      });
    }
    try {
      final res = await http
          .get(
            Uri.parse('${ApiConfig.serverBaseUrl}/api/workforce/reception/visitor/list'),
            headers: ApiConfig.sessionHeaders(widget.sessionId),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) {
        throw Exception('Server returned HTTP ${res.statusCode}.');
      }

      final data = jsonDecode(res.body);
      if (data is! List) {
        throw const FormatException('Visitor list response was not a list.');
      }

      if (mounted) setState(() => _visitors = data);
    } catch (error) {
      if (mounted) {
        setState(
          () => _visitorLoadError = 'Could not load visitor logs: $error',
        );
      }
    } finally {
      if (mounted) setState(() => _isLoadingVisitors = false);
    }
  }

  Future<void> _fetchConsents() async {
    try {
      final res = await http
          .get(
            Uri.parse('${ApiConfig.serverBaseUrl}/api/workforce/consent/list'),
            headers: ApiConfig.sessionHeaders(widget.sessionId),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) {
        throw Exception('Server returned HTTP ${res.statusCode}.');
      }

      final data = jsonDecode(res.body);
      if (data is! List) {
        throw const FormatException('Consent list response was not a list.');
      }

      if (mounted) {
        setState(() {
          _consentForms = data;
          _consentLoadError = null;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _consentLoadError = 'Could not load consent forms: $error',
        );
      }
    }
  }

  void _resetVisitorForm() {
    _fullNameCtrl.clear();
    _contactCtrl.clear();
    _emailCtrl.clear();
    _qualificationCtrl.clear();
    _cgpaCtrl.clear();
    _countryCtrl.clear();
    _programCtrl.clear();
    _referrerNameCtrl.clear();
    _referrerContactCtrl.clear();
    _relationshipCtrl.clear();
    _counsellorCtrl.clear();
    _remarksCtrl.clear();
    setState(() {
      _inquiryType = 'Walk-in';
      _counsellingMethod = 'Walk-in';
    });
  }

  Future<void> _submitVisitorForm() async {
    if (_isSubmittingVisitor) return;
    final name = _fullNameCtrl.text.trim();
    final contact = _contactCtrl.text.trim();

    if (name.isEmpty || contact.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Visitor Full Name and Contact Number are required!'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isSubmittingVisitor = true);
    try {
      final res = await http
          .post(
            Uri.parse(
              '${ApiConfig.serverBaseUrl}/api/workforce/reception/visitor/register',
            ),
            headers: ApiConfig.sessionHeaders(widget.sessionId, json: true),
            body: jsonEncode({
              'fullName': name,
              'contactNumber': contact,
              'emailAddress': _emailCtrl.text.trim(),
              'lastQualification': _qualificationCtrl.text.trim(),
              'cgpaOrPercentage': _cgpaCtrl.text.trim(),
              'interestedCountry': _countryCtrl.text.trim(),
              'interestedProgram': _programCtrl.text.trim(),
              'referrerName': _referrerNameCtrl.text.trim(),
              'referrerContact': _referrerContactCtrl.text.trim(),
              'relationshipWithVisitor': _relationshipCtrl.text.trim(),
              'counsellorName': _counsellorCtrl.text.trim().isEmpty
                  ? 'Muazzam'
                  : _counsellorCtrl.text.trim(),
              'inquiryVisitType': _inquiryType,
              'counsellingMethod': _counsellingMethod,
              'finalRemarks': _remarksCtrl.text.trim(),
              'registeredBy': widget.userName.toLowerCase(),
            }),
          )
          .timeout(const Duration(seconds: 12));

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw Exception('Server returned HTTP ${res.statusCode}.');
      }

      if (!mounted) return;
      _resetVisitorForm();
      await _fetchVisitors();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Visitor Form Submitted & Logged Successfully ✓'),
            backgroundColor: Colors.teal,
          ),
        );
        setState(() => _currentTab = 1);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Submission failed: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmittingVisitor = false);
    }
  }

  void _populateFromVisitor(dynamic rawItem) {
    final Map<String, dynamic> item = rawItem is Map<String, dynamic>
        ? rawItem
        : (rawItem is Map
              ? Map<String, dynamic>.from(rawItem)
              : <String, dynamic>{});

    final name = (item['fullName'] ?? item['FullName'] ?? '').toString();
    final phone = (item['contactNumber'] ?? item['ContactNumber'] ?? '')
        .toString();
    final qual = (item['lastQualification'] ?? item['LastQualification'] ?? '')
        .toString()
        .trim();
    final cgpa = (item['cgpaOrPercentage'] ?? item['CgpaOrPercentage'] ?? '')
        .toString()
        .trim();
    final prog = (item['interestedProgram'] ?? item['InterestedProgram'] ?? '')
        .toString()
        .trim();
    final educationDetails = [
      if (qual.isNotEmpty) qual,
      if (cgpa.isNotEmpty) cgpa,
      if (prog.isNotEmpty) 'Program: $prog',
    ].join(' • ');

    setState(() {
      _consentClientNameCtrl.text = name;
      _consentPhoneCtrl.text = phone;
      _consentEduCtrl.text = educationDetails;
      _currentTab = 2; // Direct switch to Consent Studio
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Auto-filled details for $name ✓'),
        backgroundColor: Colors.teal,
      ),
    );
  }

  Widget _responsiveFields(List<Widget> fields) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 560) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < fields.length; i++) ...[
                if (i > 0) const SizedBox(height: 10),
                fields[i],
              ],
            ],
          );
        }

        return Row(
          children: [
            for (var i = 0; i < fields.length; i++) ...[
              if (i > 0) const SizedBox(width: 10),
              Expanded(child: fields[i]),
            ],
          ],
        );
      },
    );
  }

  void _selectPortalTab(int index) {
    setState(() => _currentTab = index);
    if (index == 1) _fetchVisitors();
    if (index == 2) _fetchConsents();
  }

  Widget _buildPortalTab(int index, IconData icon, String label) {
    final isSelected = _currentTab == index;
    return InkWell(
      onTap: () => _selectPortalTab(index),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: isSelected ? Colors.white : Colors.transparent,
              width: 3.5,
            ),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              color: isSelected ? Colors.white : Colors.white60,
              size: 18,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: isSelected ? Colors.white : Colors.white60,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submitAndSendConsentForm() async {
    if (_isSubmittingConsent) return;
    final clientName = _consentClientNameCtrl.text.trim();
    if (clientName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Applicant Client Full Name is required!'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isSubmittingConsent = true);
    try {
      final res = await http
          .post(
            Uri.parse('${ApiConfig.serverBaseUrl}/api/workforce/consent/create-or-send'),
            headers: ApiConfig.sessionHeaders(widget.sessionId, json: true),
            body: jsonEncode({
              'clientFullName': clientName,
              'familyName': _consentFamilyNameCtrl.text.trim(),
              'gender': _consentGenderCtrl.text.trim(),
              'domicileCity': _consentCityCtrl.text.trim(),
              'cnicNumber': _consentCnicCtrl.text.trim(),
              'phoneNumber': _consentPhoneCtrl.text.trim(),
              'passportNumber': _consentPassportCtrl.text.trim(),
              'fullAddress': _consentAddressCtrl.text.trim(),
              'qualificationDetails': _consentEduCtrl.text.trim(),
              'policyVariant': _selectedPolicyVariant,
              'totalPackageFee':
                  int.tryParse(_consentFeeCtrl.text.trim()) ?? 250000,
              'counselorName': 'Muazzam',
            }),
          )
          .timeout(const Duration(seconds: 12));

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw Exception('Server returned HTTP ${res.statusCode}.');
      }

      final b = jsonDecode(res.body);
      await _fetchConsents();

      if (mounted) {
        _showPrintDialog(
          clientName: clientName,
          counselor: b['counselorName'] ?? 'Muazzam',
          signature: b['signature'] ?? 'Digitally Authorized by Muazzam',
          variant: _selectedPolicyVariant,
          fee: _consentFeeCtrl.text.trim(),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmittingConsent = false);
    }
  }

  void _showPrintDialog({
    required String clientName,
    required String counselor,
    required String signature,
    required String variant,
    required String fee,
  }) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.print_outlined, color: Colors.indigo),
            SizedBox(width: 8),
            Text(
              'Consent Form Ready for Print / Archive',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 500),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.indigo.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SCHOLARSHIPHIVE EDUTANCY (SMC-PRIVATE) LIMITED',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.indigo,
                      ),
                    ),
                    const Text(
                      'Corporate Unique ID: 0224047 • Johar Town, Lahore',
                      style: TextStyle(fontSize: 11, color: Colors.black54),
                    ),
                    const Divider(),
                    Text(
                      'Applicant: $clientName',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                      ),
                    ),
                    Text('Terms Variant: $variant'),
                    Text('Total Package: $fee PKR'),
                    const SizedBox(height: 6),
                    Text(
                      'Pre-Authorized Counselor: $counselor',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.teal,
                      ),
                    ),
                    Text(
                      'Stamp: $signature',
                      style: const TextStyle(
                        fontSize: 11,
                        fontStyle: FontStyle.italic,
                        color: Colors.black87,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'This official consent form has been issued and stored in the database. You can now print an official copy for hard-file records.',
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close'),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.indigo,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Triggering Browser Print Dialog... ✓'),
                  backgroundColor: Colors.indigo,
                ),
              );
            },
            icon: const Icon(Icons.print),
            label: const Text('Print Consent Form'),
          ),
        ],
      ),
    );
  }

  Future<void> _checkoutVisitor(dynamic idVal) async {
    final id = int.tryParse(idVal.toString()) ?? 0;
    if (id <= 0) return;
    try {
      final res = await http
          .post(
            Uri.parse(
              '${ApiConfig.serverBaseUrl}/api/workforce/reception/visitor/checkout/$id',
            ),
            headers: ApiConfig.sessionHeaders(widget.sessionId),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw Exception('Server returned HTTP ${res.statusCode}.');
      }
      await _fetchVisitors();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not check out visitor: $error'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final todayDate = DateFormat('dd-MM-yyyy').format(DateTime.now());

    return Scaffold(
      backgroundColor: const Color(0xFFF4F6F9),
      appBar: AppBar(
        title: Text(
          'Reception Portal (${widget.userName})',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        backgroundColor: Colors.teal.shade700,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh Records',
            onPressed: () {
              _fetchVisitors();
              _fetchConsents();
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign Out',
            onPressed: () async {
              await SessionService.clear();
              if (!context.mounted) return;
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
                (route) => false,
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final compact = constraints.maxWidth < 520;
              final tabs = [
                (0, Icons.assignment_outlined, 'Visitor Form'),
                (1, Icons.people_outline, 'Visitor Logs (${_visitors.length})'),
                (
                  2,
                  Icons.draw_outlined,
                  'Consent Studio (${_consentForms.length})',
                ),
              ];

              return Container(
                color: Colors.teal.shade800,
                child: compact
                    ? SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            for (final tab in tabs)
                              SizedBox(
                                width: 150,
                                child: _buildPortalTab(tab.$1, tab.$2, tab.$3),
                              ),
                          ],
                        ),
                      )
                    : Row(
                        children: [
                          for (final tab in tabs)
                            Expanded(
                              child: _buildPortalTab(tab.$1, tab.$2, tab.$3),
                            ),
                        ],
                      ),
              );
            },
          ),

          // Main View Content
          Expanded(
            child: _currentTab == 0
                ? _buildVisitorFormView(todayDate)
                : _currentTab == 1
                ? _buildVisitorLogView()
                : _buildConsentStudioView(todayDate),
          ),
        ],
      ),
    );
  }

  // TAB 1: VISITOR FORM
  Widget _buildVisitorFormView(String todayDate) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final bool isMobile = constraints.maxWidth < 650;

        return SingleChildScrollView(
          padding: EdgeInsets.symmetric(
            horizontal: isMobile ? 12 : 24,
            vertical: isMobile ? 14 : 24,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 820),
              child: Card(
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: EdgeInsets.all(isMobile ? 16 : 28),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'SCHOLARSHIPHIVE EDUTANCY',
                                  style: TextStyle(
                                    fontSize: isMobile ? 14 : 16,
                                    fontWeight: FontWeight.w900,
                                    color: Colors.teal.shade800,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'NEW CLIENT/VISITOR FORM',
                                  style: TextStyle(
                                    fontSize: isMobile ? 15 : 18,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.teal.shade50,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.teal.shade200),
                            ),
                            child: Text(
                              'Date: $todayDate',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 12,
                                color: Colors.teal.shade900,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      const Divider(),
                      const SizedBox(height: 8),

                      const Text(
                        'Visitor Information',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.teal,
                        ),
                      ),
                      const SizedBox(height: 10),
                      _responsiveFields([
                        TextField(
                          controller: _fullNameCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Full Name *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _contactCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Contact Number *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _emailCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Email Address',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      _responsiveFields([
                        TextField(
                          controller: _qualificationCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Last Degree',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _cgpaCtrl,
                          decoration: const InputDecoration(
                            labelText: 'CGPA / %',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 10),
                      _responsiveFields([
                        TextField(
                          controller: _countryCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Interested Country',
                            hintText: 'e.g. Italy, UK',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _programCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Interested Program',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 20),

                      const Text(
                        'Reference Details',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.teal,
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _referrerNameCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Name of Referrer',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      _responsiveFields([
                        TextField(
                          controller: _referrerContactCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Referrer Contact',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _relationshipCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Relationship with Visitor',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 20),

                      const Text(
                        'Counselling Information',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.teal,
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _counsellorCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Counsellor Name',
                          hintText: 'e.g. Muazzam, Ali, Sara',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),

                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children:
                            [
                              'Walk-in',
                              'Call',
                              'WhatsApp',
                              'Referral',
                              'Other',
                            ].map((type) {
                              return ChoiceChip(
                                label: Text(
                                  type,
                                  style: const TextStyle(fontSize: 12),
                                ),
                                selected: _inquiryType == type,
                                selectedColor: Colors.teal.shade100,
                                onSelected: (_) =>
                                    setState(() => _inquiryType = type),
                              );
                            }).toList(),
                      ),
                      const SizedBox(height: 10),

                      TextField(
                        controller: _remarksCtrl,
                        maxLines: 2,
                        decoration: const InputDecoration(
                          labelText: 'Final remarks after Counselling',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 24),

                      SizedBox(
                        height: 52,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.teal.shade700,
                            foregroundColor: Colors.white,
                            minimumSize: const Size(0, 52),
                          ),
                          onPressed: _isSubmittingVisitor
                              ? null
                              : _submitVisitorForm,
                          icon: _isSubmittingVisitor
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.check_circle_outline),
                          label: Text(
                            _isSubmittingVisitor
                                ? 'Submitting...'
                                : 'Submit Visitor Form',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  // TAB 2: VISITOR LOG VIEW (100% Guaranteed Non-Crashing Card Layout)
  Widget _buildVisitorLogView() {
    if (_isLoadingVisitors && _visitors.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_visitorLoadError != null && _visitors.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.cloud_off_outlined,
                size: 48,
                color: Colors.grey,
              ),
              const SizedBox(height: 12),
              Text(
                _visitorLoadError!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black54),
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _fetchVisitors,
                icon: const Icon(Icons.refresh),
                label: const Text('Try Again'),
              ),
            ],
          ),
        ),
      );
    }

    if (_visitors.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.co_present_outlined, size: 64, color: Colors.grey),
            const SizedBox(height: 14),
            const Text(
              'No registered visitors found.',
              style: TextStyle(
                color: Colors.black54,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.teal.shade700,
                foregroundColor: Colors.white,
              ),
              onPressed: () => setState(() => _currentTab = 0),
              child: const Text('Register First Visitor'),
            ),
          ],
        ),
      );
    }

    return Column(
      children: [
        if (_isLoadingVisitors) const LinearProgressIndicator(minHeight: 2),
        if (_visitorLoadError != null)
          MaterialBanner(
            content: Text(_visitorLoadError!),
            leading: const Icon(Icons.error_outline, color: Colors.red),
            actions: [
              TextButton(onPressed: _fetchVisitors, child: const Text('Retry')),
            ],
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _fetchVisitors,
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              itemCount: _visitors.length,
              itemBuilder: (ctx, i) {
                final dynamic raw = _visitors[i];
                final Map<String, dynamic> item = raw is Map<String, dynamic>
                    ? raw
                    : (raw is Map
                          ? Map<String, dynamic>.from(raw)
                          : <String, dynamic>{});

                final id = item['id'] ?? item['Id'] ?? 0;
                final name = (item['fullName'] ?? item['FullName'] ?? 'Visitor')
                    .toString();
                final contact =
                    (item['contactNumber'] ?? item['ContactNumber'] ?? 'N/A')
                        .toString();
                final prog =
                    (item['interestedProgram'] ??
                            item['InterestedProgram'] ??
                            'General')
                        .toString();
                final country =
                    (item['interestedCountry'] ??
                            item['InterestedCountry'] ??
                            '')
                        .toString();
                final counsellor =
                    (item['counsellorName'] ??
                            item['CounsellorName'] ??
                            'Muazzam')
                        .toString();
                final inTime =
                    (item['checkInTime'] ?? item['CheckInTime'] ?? 'N/A')
                        .toString();
                final outTime = item['checkOutTime'] ?? item['CheckOutTime'];
                final status =
                    (item['status'] ?? item['Status'] ?? 'Checked In')
                        .toString();
                final bool isInside = status == 'Checked In';

                final details = Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$name ${country.isNotEmpty ? "($country)" : ""}',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Contact: $contact • Program: $prog',
                      style: const TextStyle(
                        fontSize: 13,
                        color: Colors.black87,
                      ),
                    ),
                    Text(
                      'Counsellor: $counsellor',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.black54,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'In: $inTime ${outTime != null ? "• Out: ${outTime.toString()}" : ""}',
                      style: const TextStyle(fontSize: 11, color: Colors.grey),
                    ),
                  ],
                );
                final actions = [
                  if (isInside)
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.orange,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 36),
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                      ),
                      onPressed: () => _checkoutVisitor(id),
                      child: const Text('Check Out'),
                    )
                  else
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'Checked Out',
                        style: TextStyle(
                          color: Colors.grey,
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.indigo,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(0, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    onPressed: () => _populateFromVisitor(item),
                    icon: const Icon(Icons.draw, size: 16),
                    label: const Text('Create Consent'),
                  ),
                ];

                return Card(
                  elevation: 2,
                  margin: const EdgeInsets.only(bottom: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final avatar = CircleAvatar(
                          radius: 22,
                          backgroundColor: isInside
                              ? Colors.teal.shade50
                              : Colors.grey.shade200,
                          child: Icon(
                            Icons.person,
                            color: isInside ? Colors.teal : Colors.grey,
                          ),
                        );

                        if (constraints.maxWidth < 560) {
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  avatar,
                                  const SizedBox(width: 12),
                                  Expanded(child: details),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                alignment: WrapAlignment.end,
                                children: actions,
                              ),
                            ],
                          );
                        }

                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            avatar,
                            const SizedBox(width: 14),
                            Expanded(child: details),
                            const SizedBox(width: 12),
                            Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                actions[0],
                                const SizedBox(height: 8),
                                actions[1],
                              ],
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  // TAB 3: OFFICIAL ITALY CONSENT STUDIO
  Widget _buildConsentStudioView(String todayDate) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isMobile = constraints.maxWidth < 650;
        final heading = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'SCHOLARSHIPHIVE EDUTANCY (SMC-PRIVATE) LIMITED',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                color: Colors.indigo.shade800,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 2),
            const Text(
              'ITALY ADMISSION CONSENT FORM STUDIO',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ],
        );
        final dateBadge = Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.indigo.shade50,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            'Date: $todayDate',
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              color: Colors.indigo,
            ),
          ),
        );
        return SingleChildScrollView(
          padding: EdgeInsets.symmetric(
            horizontal: isMobile ? 12 : 20,
            vertical: isMobile ? 14 : 20,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 860),
              child: Card(
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: EdgeInsets.all(isMobile ? 16 : 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (isMobile) ...[
                        heading,
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: dateBadge,
                        ),
                      ] else
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(child: heading),
                            const SizedBox(width: 12),
                            dateBadge,
                          ],
                        ),
                      const SizedBox(height: 12),
                      const Divider(),
                      const SizedBox(height: 10),
                      if (_consentLoadError != null) ...[
                        MaterialBanner(
                          content: Text(_consentLoadError!),
                          leading: const Icon(
                            Icons.error_outline,
                            color: Colors.red,
                          ),
                          actions: [
                            TextButton(
                              onPressed: _fetchConsents,
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                      ],

                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.teal.shade50,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: Colors.teal.shade200),
                        ),
                        child: Row(
                          children: const [
                            Icon(Icons.verified_user, color: Colors.teal),
                            SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Authorized Counselor: Muazzam (Official Representative)\nSignature Stamp: Digitally Verified & Authorized by Muazzam (Auto-Saved)',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.teal,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),

                      const Text(
                        '1. Client Personal Profile (Editable)',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.indigo,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _responsiveFields([
                        TextField(
                          controller: _consentClientNameCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Applicant Full Name *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _consentFamilyNameCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Father / Family Name',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 10),
                      _responsiveFields([
                        TextField(
                          controller: _consentCnicCtrl,
                          decoration: const InputDecoration(
                            labelText: 'CNIC / National ID',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _consentPhoneCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Contact Phone Number',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        TextField(
                          controller: _consentPassportCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Passport Number',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _consentAddressCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Full Residential Address',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _consentEduCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Academic Qualification / Prior Degree',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 20),

                      const Text(
                        '2. Terms, Installments & Policy Variant',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.indigo,
                        ),
                      ),
                      const SizedBox(height: 8),
                      LayoutBuilder(
                        builder: (context, fieldConstraints) {
                          final compact = fieldConstraints.maxWidth < 560;
                          final variant = DropdownButtonFormField<String>(
                            initialValue: _selectedPolicyVariant,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Select Consent Agreement Variant',
                              border: OutlineInputBorder(),
                            ),
                            items: _variants
                                .map(
                                  (v) => DropdownMenuItem(
                                    value: v,
                                    child: Text(
                                      v,
                                      style: const TextStyle(fontSize: 12),
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: (val) =>
                                setState(() => _selectedPolicyVariant = val!),
                          );
                          final fee = TextField(
                            controller: _consentFeeCtrl,
                            decoration: const InputDecoration(
                              labelText: 'Total Fee (PKR)',
                              border: OutlineInputBorder(),
                            ),
                          );
                          if (compact) {
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                variant,
                                const SizedBox(height: 10),
                                fee,
                              ],
                            );
                          }
                          return Row(
                            children: [
                              Expanded(flex: 2, child: variant),
                              const SizedBox(width: 10),
                              Expanded(child: fee),
                            ],
                          );
                        },
                      ),
                      const SizedBox(height: 10),

                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade100,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          '• 1st Advance: 100,000 PKR (Policy refund criteria applied)\n• 2nd Installment: 100,000 PKR upon University Admission Letter\n• 3rd Installment: 30,000 PKR before 15 July 2027\n• 4th Installment: 20,000 PKR (3 days before visa file submission)\n• Italian Embassy rule: 6-month bank statement 35 Lacs PKR with tax returns.',
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.4,
                            color: Colors.black87,
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),

                      SizedBox(
                        height: 52,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.indigo.shade700,
                            foregroundColor: Colors.white,
                            minimumSize: const Size(0, 52),
                          ),
                          onPressed: _isSubmittingConsent
                              ? null
                              : _submitAndSendConsentForm,
                          icon: _isSubmittingConsent
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.send),
                          label: Text(
                            _isSubmittingConsent
                                ? 'Sending...'
                                : 'Send & Issue Consent Form',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),

                      const Text(
                        'Issued & Archived Consent Documents',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 10),
                      _consentForms.isEmpty
                          ? const Text(
                              'No consent forms issued yet.',
                              style: TextStyle(
                                color: Colors.grey,
                                fontSize: 12,
                              ),
                            )
                          : ListView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: _consentForms.length,
                              itemBuilder: (ctx, i) {
                                final dynamic raw = _consentForms[i];
                                final Map<String, dynamic> cf =
                                    raw is Map<String, dynamic>
                                    ? raw
                                    : (raw is Map
                                          ? Map<String, dynamic>.from(raw)
                                          : <String, dynamic>{});

                                final client =
                                    (cf['clientFullName'] ??
                                            cf['ClientFullName'] ??
                                            'Client')
                                        .toString();
                                final variant =
                                    (cf['policyVariant'] ??
                                            cf['PolicyVariant'] ??
                                            '')
                                        .toString();
                                final counselor =
                                    (cf['counselorName'] ??
                                            cf['CounselorName'] ??
                                            'Muazzam')
                                        .toString();
                                final fee =
                                    (cf['totalPackageFee'] ??
                                            cf['TotalPackageFee'] ??
                                            '250000')
                                        .toString();
                                final date =
                                    (cf['createdAt'] ?? cf['CreatedAt'] ?? '')
                                        .toString();
                                final sig =
                                    (cf['representativeSignature'] ??
                                            cf['RepresentativeSignature'] ??
                                            'Digitally Authorized by Muazzam')
                                        .toString();

                                final printButton = OutlinedButton.icon(
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.indigo,
                                    minimumSize: const Size(0, 36),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                    ),
                                  ),
                                  onPressed: () {
                                    _showPrintDialog(
                                      clientName: client,
                                      counselor: counselor,
                                      signature: sig,
                                      variant: variant,
                                      fee: fee,
                                    );
                                  },
                                  icon: const Icon(Icons.print, size: 16),
                                  label: const Text('Print'),
                                );

                                return Card(
                                  elevation: 1,
                                  margin: const EdgeInsets.only(bottom: 8),
                                  child: LayoutBuilder(
                                    builder: (context, constraints) {
                                      if (constraints.maxWidth < 560) {
                                        return Padding(
                                          padding: const EdgeInsets.all(12),
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.stretch,
                                            children: [
                                              Row(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  const Icon(
                                                    Icons.description,
                                                    color: Colors.indigo,
                                                  ),
                                                  const SizedBox(width: 10),
                                                  Expanded(
                                                    child: Text(
                                                      '$client — $variant',
                                                      style: const TextStyle(
                                                        fontWeight:
                                                            FontWeight.bold,
                                                        fontSize: 13,
                                                      ),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                              const SizedBox(height: 6),
                                              Text(
                                                'Counselor: $counselor • Total: $fee PKR • Date: $date',
                                              ),
                                              const SizedBox(height: 8),
                                              Align(
                                                alignment:
                                                    Alignment.centerRight,
                                                child: printButton,
                                              ),
                                            ],
                                          ),
                                        );
                                      }
                                      return ListTile(
                                        leading: const Icon(
                                          Icons.description,
                                          color: Colors.indigo,
                                        ),
                                        title: Text(
                                          '$client — $variant',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 13,
                                          ),
                                        ),
                                        subtitle: Text(
                                          'Counselor: $counselor • Total: $fee PKR • Date: $date',
                                        ),
                                        trailing: printButton,
                                      );
                                    },
                                  ),
                                );
                              },
                            ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
