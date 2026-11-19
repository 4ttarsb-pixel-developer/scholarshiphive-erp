import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'services/attendance_service.dart';
import 'services/csv_download.dart';

class AdminDashboardScreen extends StatefulWidget {
  final String userName;
  final String role;
  final String adminToken;

  const AdminDashboardScreen({
    super.key,
    required this.userName,
    required this.role,
    required this.adminToken,
  });

  @override
  State<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState
    extends State<AdminDashboardScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  final _searchController = TextEditingController();
  final _fromDateController = TextEditingController();
  final _toDateController = TextEditingController();

  Map<String, dynamic> _summary = {};

  List<dynamic> _recentActivity = [];
  List<dynamic> _attendanceRecords = [];
  List<dynamic> _users = [];
  List<dynamic> _ipLogs = [];
  List<dynamic> _officeNetworks = [];

  final _networkNameController = TextEditingController();
  final _networkIpController = TextEditingController();
  bool _savingNetwork = false;

  String _selectedUser = '';
  String _selectedStatus = '';
  String _appliedSearch = '';

  int _lastTabIndex = 0;

  bool _isLoading = true;
  bool _isExporting = false;

  String? _errorMessage;

  Map<String, String> get _headers => {
        'Accept': 'application/json',
        'Authorization': 'Bearer ${widget.adminToken}',
      };

  // ============================================================
  // INIT
  // ============================================================

  @override
  void initState() {
    super.initState();

    _tabController = TabController(
      length: 5,
      vsync: this,
    );

    _tabController.addListener(() {
      if (_tabController.indexIsChanging ||
          !mounted ||
          _lastTabIndex == _tabController.index) {
        return;
      }

      _lastTabIndex = _tabController.index;

      final validStatuses = switch (_lastTabIndex) {
        1 => {
            '',
            'Present',
            'Checked Out',
          },
        3 => {
            '',
            'Allowed',
            'Denied',
          },
        _ => {''},
      };

      if (!validStatuses.contains(_selectedStatus)) {
        setState(() {
          _selectedStatus = '';
        });

        _loadData();
      } else {
        setState(() {});
      }
    });

    _loadData();
  }

  // ============================================================
  // DISPOSE
  // ============================================================

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    _fromDateController.dispose();
    _toDateController.dispose();
    _networkNameController.dispose();
    _networkIpController.dispose();

    super.dispose();
  }

  // ============================================================
  // URI
  // ============================================================

  Uri _uri(
    String path, [
    Map<String, String>? parameters,
  ]) {
    return Uri.parse(
      '${ApiConfig.serverBaseUrl}$path',
    ).replace(
      queryParameters:
          parameters == null || parameters.isEmpty
              ? null
              : parameters,
    );
  }

  // ============================================================
  // FILTERS
  // ============================================================

  Map<String, String> get _filters {
    final query = <String, String>{};

    if (_selectedUser.isNotEmpty) {
      query['username'] = _selectedUser;
    }

    if (_fromDateController.text.isNotEmpty) {
      query['fromDate'] = _fromDateController.text;
    }

    if (_toDateController.text.isNotEmpty) {
      query['toDate'] = _toDateController.text;
    }

    if (_selectedStatus.isNotEmpty) {
      query['status'] = _selectedStatus;
    }

    if (_appliedSearch.isNotEmpty) {
      query['search'] = _appliedSearch;
    }

    return query;
  }

  // ============================================================
  // GET
  // ============================================================

  Future<http.Response> _get(
    String path, [
    Map<String, String>? parameters,
  ]) async {
    final response = await http
        .get(
          _uri(path, parameters),
          headers: _headers,
        )
        .timeout(
          const Duration(seconds: 12),
        );

    if (response.statusCode < 200 ||
        response.statusCode >= 300) {
      throw _responseError(response);
    }

    return response;
  }

  // ============================================================
  // SERVER ERROR
  // ============================================================

  String _responseError(
    http.Response response,
  ) {
    try {
      final body = jsonDecode(response.body);

      if (body is Map<String, dynamic>) {
        return body['message']?.toString() ??
            body['reason']?.toString() ??
            'Server returned HTTP ${response.statusCode}.';
      }
    } on FormatException {
      return 'Server returned HTTP ${response.statusCode}.';
    }

    return 'Server returned HTTP ${response.statusCode}.';
  }

  // ============================================================
  // LOAD DATA
  // ============================================================

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait([
        _get(
          '/api/workforce/admin/dashboard',
        ),
        _get(
          '/api/workforce/admin/attendance',
          _filters,
        ),
        _get(
          '/api/workforce/admin/users',
          {
            'search': _appliedSearch,
          },
        ),
        _get(
          '/api/workforce/admin/ip-logs',
          _filters,
        ),
        _get(
          '/api/workforce/admin/networks',
        ),
      ]);

      if (!mounted) return;

      setState(() {
        _summary =
            jsonDecode(
              results[0].body,
            ) as Map<String, dynamic>;

        _attendanceRecords =
            jsonDecode(
              results[1].body,
            ) as List<dynamic>;

        _users =
            jsonDecode(
              results[2].body,
            ) as List<dynamic>;

        _ipLogs =
            jsonDecode(
              results[3].body,
            ) as List<dynamic>;

        _officeNetworks =
            jsonDecode(
              results[4].body,
            ) as List<dynamic>;

        _recentActivity =
            _summary['recentActivity']
                    as List<dynamic>? ??
                [];
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _errorMessage = error.toString();
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ============================================================
  // DATE PICKER
  // ============================================================

  Future<void> _chooseDate(
    TextEditingController controller,
  ) async {
    final initialDate =
        DateTime.tryParse(
          controller.text,
        ) ??
        DateTime.now();

    final selected = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );

    if (selected == null) {
      return;
    }

    controller.text =
        '${selected.year.toString().padLeft(4, '0')}-'
        '${selected.month.toString().padLeft(2, '0')}-'
        '${selected.day.toString().padLeft(2, '0')}';
  }

  // ============================================================
  // APPLY FILTERS
  // ============================================================

  Future<void> _applyFilters() async {
    final fromDate =
        DateTime.tryParse(
          _fromDateController.text,
        );

    final toDate =
        DateTime.tryParse(
          _toDateController.text,
        );

    if ((_fromDateController.text.isNotEmpty &&
            fromDate == null) ||
        (_toDateController.text.isNotEmpty &&
            toDate == null)) {
      _showMessage(
        'Enter valid dates using YYYY-MM-DD.',
      );

      return;
    }

    if (fromDate != null &&
        toDate != null &&
        fromDate.isAfter(toDate)) {
      _showMessage(
        'The start date must be on or before the end date.',
      );

      return;
    }

    setState(() {
      _appliedSearch =
          _searchController.text.trim();
    });

    await _loadData();
  }

  // ============================================================
  // RESET FILTERS
  // ============================================================

  Future<void> _resetFilters() async {
    _searchController.clear();
    _fromDateController.clear();
    _toDateController.clear();

    setState(() {
      _selectedUser = '';
      _selectedStatus = '';
      _appliedSearch = '';
    });

    await _loadData();
  }

  // ============================================================
  // EXPORT ATTENDANCE
  // ============================================================

  Future<void> _exportAttendance() async {
    setState(() {
      _isExporting = true;
    });

    try {
      final response = await _get(
        '/api/workforce/admin/attendance/export',
        _filters,
      );

      final filename =
          'attendance-${DateTime.now().toIso8601String().substring(0, 10)}.csv';

      final downloaded = await downloadCsv(
        filename,
        response.body,
      );

      if (mounted) {
        _showMessage(
          downloaded
              ? 'Attendance CSV exported.'
              : 'CSV copied to clipboard; download is available in the web dashboard.',
        );
      }
    } catch (error) {
      if (mounted) {
        _showMessage(
          'CSV export failed: $error',
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isExporting = false;
        });
      }
    }
  }

  // ============================================================
  // RESET DEVICE
  // ============================================================

  Future<void> _resetDevice(
    dynamic user,
  ) async {
    final bindingId = int.tryParse(
      '${user['deviceBindingId'] ?? ''}',
    );

    if (bindingId == null) {
      _showMessage(
        'This user has no registered device to reset.',
      );

      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text(
          'Reset registered device?',
        ),
        content: Text(
          'Remove the device binding for ${user['username']}? '
          'They will register a device on their next login.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(
              dialogContext,
              false,
            ),
            child: const Text(
              'Cancel',
            ),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.red,
            ),
            onPressed: () => Navigator.pop(
              dialogContext,
              true,
            ),
            child: const Text(
              'Reset device',
            ),
          ),
        ],
      ),
    );

    if (confirmed != true) {
      return;
    }

    try {
      final response = await http
          .post(
            _uri(
              '/api/workforce/admin/devices/$bindingId/reset',
            ),
            headers: _headers,
          )
          .timeout(
            const Duration(seconds: 12),
          );

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw _responseError(response);
      }

      await _loadData();

      if (mounted) {
        _showMessage(
          'Device registration reset.',
        );
      }
    } catch (error) {
      if (mounted) {
        _showMessage(
          'Device reset failed: $error',
        );
      }
    }
  }

  // ============================================================
  // SNACKBAR
  // ============================================================

  void _showMessage(
    String message,
  ) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  // ============================================================
  // DATE FIELD
  // ============================================================

  Widget _buildDateField(
    String label,
    TextEditingController controller, {
    double width = 176,
  }) {
    return SizedBox(
      width: width,
      child: TextField(
        controller: controller,
        readOnly: true,
        onTap: () => _chooseDate(
          controller,
        ),
        decoration: InputDecoration(
          labelText: label,
          hintText: 'YYYY-MM-DD',
          suffixIcon: IconButton(
            tooltip: 'Choose $label',
            onPressed: () => _chooseDate(
              controller,
            ),
            icon: const Icon(
              Icons.calendar_month,
            ),
          ),
          border: const OutlineInputBorder(),
          isDense: true,
        ),
      ),
    );
  }

  // ============================================================
  // FILTER BAR
  // ============================================================

  Widget _buildFilterBar({
    required bool includeDates,
    required bool logs,
  }) {
    return Card(
      margin: const EdgeInsets.fromLTRB(
        16,
        12,
        16,
        8,
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (
            context,
            constraints,
          ) {
            final compact =
                constraints.maxWidth < 520;

            final pairedWidth =
                (constraints.maxWidth - 10) / 2;

            final fieldWidth = compact
                ? constraints.maxWidth
                : constraints.maxWidth < 820
                    ? pairedWidth
                    : null;

            return Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment:
                  WrapCrossAlignment.center,
              children: [
                if (includeDates) ...[
                  _buildDateField(
                    'From date',
                    _fromDateController,
                    width: fieldWidth ?? 176,
                  ),
                  _buildDateField(
                    'To date',
                    _toDateController,
                    width: fieldWidth ?? 176,
                  ),
                ],

                if (includeDates)
                  SizedBox(
                    width: fieldWidth ?? 160,
                    child:
                        DropdownButtonFormField<
                            String>(
                      isExpanded: true,
                      initialValue:
                          _selectedStatus,
                      decoration:
                          const InputDecoration(
                        labelText: 'Status',
                        border:
                            OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text(
                            'All statuses',
                          ),
                        ),
                        if (logs) ...[
                          const DropdownMenuItem(
                            value: 'Allowed',
                            child: Text(
                              'Allowed',
                            ),
                          ),
                          const DropdownMenuItem(
                            value: 'Denied',
                            child: Text(
                              'Denied',
                            ),
                          ),
                        ] else ...[
                          const DropdownMenuItem(
                            value: 'Present',
                            child: Text(
                              'Present',
                            ),
                          ),
                          const DropdownMenuItem(
                            value: 'Checked Out',
                            child: Text(
                              'Checked out',
                            ),
                          ),
                        ],
                      ],
                      onChanged: (value) {
                        setState(() {
                          _selectedStatus =
                              value ?? '';
                        });
                      },
                    ),
                  ),

                if (includeDates)
                  SizedBox(
                    width: fieldWidth ?? 180,
                    child:
                        DropdownButtonFormField<
                            String>(
                      isExpanded: true,
                      initialValue:
                          _selectedUser,
                      decoration:
                          const InputDecoration(
                        labelText: 'User',
                        border:
                            OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text(
                            'All users',
                          ),
                        ),

                        if (_selectedUser
                                .isNotEmpty &&
                            !_users.any(
                              (user) =>
                                  user['username'] ==
                                  _selectedUser,
                            ))
                          DropdownMenuItem(
                            value:
                                _selectedUser,
                            child: Text(
                              _selectedUser,
                              overflow:
                                  TextOverflow
                                      .ellipsis,
                            ),
                          ),

                        ..._users.map(
                          (user) =>
                              DropdownMenuItem<
                                  String>(
                            value: user[
                                        'username']
                                    ?.toString() ??
                                '',
                            child: Text(
                              user['username']
                                      ?.toString() ??
                                  '',
                              overflow:
                                  TextOverflow
                                      .ellipsis,
                            ),
                          ),
                        ),
                      ],
                      onChanged: (value) {
                        setState(() {
                          _selectedUser =
                              value ?? '';
                        });
                      },
                    ),
                  ),

                SizedBox(
                  width: fieldWidth ?? 220,
                  child: TextField(
                    controller:
                        _searchController,
                    decoration:
                        const InputDecoration(
                      labelText: 'Search',
                      hintText:
                          'User, IP, device, action...',
                      prefixIcon:
                          Icon(Icons.search),
                      border:
                          OutlineInputBorder(),
                      isDense: true,
                    ),
                    onSubmitted: (_) =>
                        _applyFilters(),
                  ),
                ),

                FilledButton.icon(
                  onPressed: _applyFilters,
                  icon: const Icon(
                    Icons.search,
                  ),
                  label: const Text(
                    'Apply Filter',
                  ),
                ),

                OutlinedButton.icon(
                  onPressed: _resetFilters,
                  icon: const Icon(
                    Icons.restart_alt,
                  ),
                  label: const Text(
                    'Reset',
                  ),
                ),

                IconButton(
                  tooltip: 'Refresh data',
                  onPressed: _loadData,
                  icon: const Icon(
                    Icons.refresh,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  // ============================================================
  // SUMMARY
  // SAME SIZE CARDS
  // ============================================================

  Widget _buildSummary() {
    final cards = [
      (
        'Total users',
        '${_summary['totalUsers'] ?? 0}',
        Icons.people_alt_outlined,
        Colors.indigo,
      ),
      (
        'Present now',
        '${_summary['presentUsers'] ?? 0}',
        Icons.how_to_reg,
        Colors.green,
      ),
      (
        'Checked out today',
        '${_summary['checkedOutToday'] ?? 0}',
        Icons.logout,
        Colors.blue,
      ),
      (
        'Activity today',
        '${_summary['activityToday'] ?? 0}',
        Icons.security,
        Colors.deepOrange,
      ),
    ];

    return LayoutBuilder(
      builder: (
        context,
        constraints,
      ) {
        final compact =
            constraints.maxWidth < 600;

        final cardWidth = compact
            ? (constraints.maxWidth - 12) / 2
            : 225.0;

        final cardHeight =
            compact ? 118.0 : 120.0;

        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: cards.map(
            (card) {
              return SizedBox(
                width: cardWidth,
                height: cardHeight,
                child: Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding:
                        EdgeInsets.symmetric(
                      horizontal:
                          compact ? 12 : 18,
                      vertical:
                          compact ? 12 : 14,
                    ),
                    child: Row(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .center,
                      children: [
                        CircleAvatar(
                          radius:
                              compact ? 16 : 20,
                          backgroundColor:
                              card.$4.withValues(
                            alpha: 0.12,
                          ),
                          child: Icon(
                            card.$3,
                            color: card.$4,
                            size:
                                compact ? 18 : 24,
                          ),
                        ),

                        SizedBox(
                          width:
                              compact ? 10 : 14,
                        ),

                        Expanded(
                          child: Column(
                            mainAxisAlignment:
                                MainAxisAlignment
                                    .center,
                            crossAxisAlignment:
                                CrossAxisAlignment
                                    .start,
                            children: [
                              SizedBox(
                                height: 38,
                                child: Align(
                                  alignment:
                                      Alignment
                                          .centerLeft,
                                  child: Text(
                                    card.$1,
                                    maxLines: 2,
                                    overflow:
                                        TextOverflow
                                            .ellipsis,
                                    style:
                                        TextStyle(
                                      color:
                                          Colors
                                              .black54,
                                      fontSize:
                                          compact
                                              ? 12
                                              : 14,
                                      height:
                                          1.15,
                                    ),
                                  ),
                                ),
                              ),

                              const SizedBox(
                                height: 4,
                              ),

                              Text(
                                card.$2,
                                maxLines: 1,
                                overflow:
                                    TextOverflow
                                        .ellipsis,
                                style: TextStyle(
                                  fontSize:
                                      compact
                                          ? 22
                                          : 24,
                                  height: 1,
                                  fontWeight:
                                      FontWeight
                                          .bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ).toList(),
        );
      },
    );
  }

  // ============================================================
  // OVERVIEW TAB
  // ============================================================

  Widget _buildOverview() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Text(
            'Today at a glance',
            style: Theme.of(
              context,
            ).textTheme.titleLarge,
          ),

          const SizedBox(height: 12),

          _buildSummary(),

          const SizedBox(height: 24),

          Text(
            'Recent login and security activity',
            style: Theme.of(
              context,
            ).textTheme.titleLarge,
          ),

          const SizedBox(height: 8),

          if (_recentActivity.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'No recent login or security activity.',
              ),
            )
          else
            _buildLogsTable(
              _recentActivity,
            ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  // ============================================================
  // ATTENDANCE TAB
  //
  // IMPORTANT:
  // Filter + records are inside SAME vertical scroll.
  // So when user scrolls records, filter box also moves upward.
  // ============================================================

  Widget _buildAttendanceTab() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.stretch,
        children: [
          _buildFilterBar(
            includeDates: true,
            logs: false,
          ),

          const SizedBox(height: 4),

          _buildAttendanceTable(
            _attendanceRecords,
          ),

          const SizedBox(height: 30),
        ],
      ),
    );
  }

  // ============================================================
  // USERS TAB
  //
  // Search/filter also scrolls with users table.
  // ============================================================

  Widget _buildUsersTab() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.stretch,
        children: [
          _buildFilterBar(
            includeDates: false,
            logs: false,
          ),

          const SizedBox(height: 4),

          _buildUsersTable(),

          const SizedBox(height: 30),
        ],
      ),
    );
  }

  // ============================================================
  // LOGIN / IP LOG TAB
  //
  // Filter + logs also scroll together.
  // ============================================================

  Widget _buildLogsTab() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.stretch,
        children: [
          _buildFilterBar(
            includeDates: true,
            logs: true,
          ),

          const SizedBox(height: 4),

          _buildLogsTable(
            _ipLogs,
          ),

          const SizedBox(height: 30),
        ],
      ),
    );
  }

  // ============================================================
  // ATTENDANCE TABLE
  // ============================================================

  Widget _buildAttendanceTable(
    List<dynamic> records,
  ) {
    if (records.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(30),
        child: Center(
          child: Text(
            'No attendance records match these filters.',
          ),
        ),
      );
    }

    return _dataTable(
      columns: const [
        'Employee',
        'Date',
        'Check-in',
        'Check-out',
        'Total span',
        'Network away',
        'Actual office time',
        'Status',
        'Check-in IP',
        'Check-out IP',
        'Device ID',
        'Report',
      ],
      rows: records.map(
        (record) {
          return [
            '${record['fullName'] ?? record['user'] ?? '-'} '
                '(${record['user'] ?? '-'})',
            '${record['date'] ?? '-'}',
            '${record['checkIn'] ?? '-'}',
            '${record['checkOut'] ?? '-'}',
            '${record['totalSpanText'] ?? '0m'}',
            '${record['networkAwayText'] ?? '0m'}',
            '${record['actualOfficeTimeText'] ?? '0m'}',
            '${record['status'] ?? '-'}',
            '${record['checkInIp'] ?? '-'}',
            '${record['checkOutIp'] ?? '-'}',
            '${record['deviceId'] ?? '-'}',
            '${record['report'] ?? '-'}',
          ];
        },
      ).toList(),
    );
  }

  // ============================================================
  // USERS TABLE
  // ============================================================

  Widget _buildUsersTable() {
    if (_users.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(30),
        child: Center(
          child: Text(
            'No registered users found.',
          ),
        ),
      );
    }

    return _dataTable(
      columns: const [
        'Username',
        'Full name',
        'Email',
        'Team',
        'Role',
        'Device',
        'IP address',
        'Registered',
        'Action',
      ],
      rows: _users.map(
        (user) {
          final bindingId =
              int.tryParse(
            '${user['deviceBindingId'] ?? ''}',
          );

          return [
            '${user['username'] ?? '-'}',
            '${user['fullName'] ?? '-'}',
            '${user['email'] ?? ''}'.isEmpty
                ? 'Not provided'
                : '${user['email']}',
            '${user['team'] ?? '-'}',
            '${user['role'] ?? '-'}',
            '${user['deviceId'] ?? 'Not registered'}',
            '${user['ipAddress'] ?? '-'}',
            '${user['registeredAt'] ?? '-'}',

            bindingId == null
                ? const Text(
                    'No device',
                    style: TextStyle(
                      color: Colors.black54,
                    ),
                  )
                : IconButton(
                    tooltip:
                        'Reset registered device',
                    color: Colors.red,
                    onPressed: () =>
                        _resetDevice(
                      user,
                    ),
                    icon: const Icon(
                      Icons.phonelink_erase,
                    ),
                  ),
          ];
        },
      ).toList(),
    );
  }

  // ============================================================
  // OFFICE WI-FI / PUBLIC IP MANAGEMENT
  // ============================================================

  Future<void> _loadCurrentOfficeIp() async {
    try {
      final response = await _get('/api/workforce/admin/networks/current-ip');
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final ip = (data['suggestedRule'] ?? data['publicIp'] ?? '').toString();
      if (!mounted) return;
      setState(() => _networkIpController.text = ip);
      _showMessage('Current office IP/range loaded.');
    } catch (error) {
      if (mounted) _showMessage('Could not detect current IP: $error');
    }
  }

  Future<void> _addOfficeNetwork() async {
    final name = _networkNameController.text.trim();
    final ip = _networkIpController.text.trim();
    if (name.isEmpty || ip.isEmpty) {
      _showMessage('Enter network name and public IP/range.');
      return;
    }
    setState(() => _savingNetwork = true);
    try {
      final response = await http.post(
        _uri('/api/workforce/admin/networks'),
        headers: {..._headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'name': name, 'publicIp': ip}),
      ).timeout(const Duration(seconds: 12));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw _responseError(response);
      }
      _networkNameController.clear();
      _networkIpController.clear();
      await _loadData();
      if (mounted) _showMessage('Office Wi-Fi added successfully.');
    } catch (error) {
      if (mounted) _showMessage('Could not add Office Wi-Fi: $error');
    } finally {
      if (mounted) setState(() => _savingNetwork = false);
    }
  }

  Future<void> _deleteOfficeNetwork(dynamic network) async {
    final id = int.tryParse('${network['id'] ?? ''}');
    if (id == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete Office Wi-Fi?'),
        content: Text('Remove ${network['name']} (${network['publicIp']})?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final response = await http.delete(
        _uri('/api/workforce/admin/networks/$id'),
        headers: _headers,
      ).timeout(const Duration(seconds: 12));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw _responseError(response);
      }
      await _loadData();
      if (mounted) _showMessage('Office Wi-Fi removed.');
    } catch (error) {
      if (mounted) _showMessage('Could not remove Office Wi-Fi: $error');
    }
  }

  Widget _buildOfficeNetworksTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Office Wi-Fi / IP Management',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Add approved office public IPs. IPv6 is stored as a /64 office range so phones on the same office Wi-Fi can match reliably.',
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _networkNameController,
                    decoration: const InputDecoration(
                      labelText: 'Network name',
                      hintText: 'Main Office WiFi',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.wifi),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _networkIpController,
                    decoration: const InputDecoration(
                      labelText: 'Public IP / range',
                      hintText: 'IPv4 or IPv6 /64',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.public),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _loadCurrentOfficeIp,
                        icon: const Icon(Icons.my_location),
                        label: const Text('Use My Current IP'),
                      ),
                      FilledButton.icon(
                        onPressed: _savingNetwork ? null : _addOfficeNetwork,
                        icon: const Icon(Icons.add),
                        label: Text(_savingNetwork ? 'Adding...' : 'Add Wi-Fi'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_officeNetworks.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: Text('No approved Office Wi-Fi added yet.')),
              ),
            )
          else
            ..._officeNetworks.map(
              (network) => Card(
                child: ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.wifi)),
                  title: Text('${network['name'] ?? 'Office WiFi'}'),
                  subtitle: Text(
                    'Approved IP/range: ${network['publicIp'] ?? '-'}\nAdded: ${network['createdAt'] ?? '-'}',
                  ),
                  isThreeLine: true,
                  trailing: IconButton(
                    tooltip: 'Delete approved network',
                    color: Colors.red,
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => _deleteOfficeNetwork(network),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ============================================================
  // LOG TABLE
  // ============================================================

  Widget _buildLogsTable(
    List<dynamic> logs,
  ) {
    if (logs.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(30),
        child: Center(
          child: Text(
            'No login or security logs match these filters.',
          ),
        ),
      );
    }

    return _dataTable(
      columns: const [
        'Time',
        'Username',
        'Action',
        'IP address',
        'Status',
      ],
      rows: logs.map(
        (log) {
          return [
            '${log['time'] ?? '-'}',
            '${log['username'] ?? '-'}',
            '${log['action'] ?? '-'}',
            '${log['ip'] ?? '-'}',
            log['allowed'] == true
                ? 'Allowed'
                : 'Denied',
          ];
        },
      ).toList(),
    );
  }

  // ============================================================
  // DATA TABLE
  //
  // IMPORTANT:
  // Vertical scrolling removed from this widget.
  //
  // Parent tabs now handle vertical scrolling so filter and
  // table move together.
  //
  // Horizontal scrolling remains for wide tables.
  // ============================================================

  Widget _dataTable({
    required List<String> columns,
    required List<List<dynamic>> rows,
  }) {
    return Align(
      alignment: Alignment.topLeft,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: columns
              .map(
                (column) => DataColumn(
                  label: Text(
                    column,
                  ),
                ),
              )
              .toList(),
          rows: rows
              .map(
                (row) => DataRow(
                  cells: row
                      .map(
                        (value) => DataCell(
                          value is Widget
                              ? value
                              : ConstrainedBox(
                                  constraints:
                                      const BoxConstraints(
                                    maxWidth: 260,
                                  ),
                                  child: Text(
                                    '$value',
                                    overflow:
                                        TextOverflow
                                            .ellipsis,
                                  ),
                                ),
                        ),
                      )
                      .toList(),
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  // ============================================================
  // BUILD
  // ============================================================

  @override
  Widget build(
    BuildContext context,
  ) {
    final tabIndex =
        _tabController.index;

    final showingAttendance =
        tabIndex == 1;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Attendance Administration • ${widget.userName}',
        ),

        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: const [
            Tab(
              icon: Icon(
                Icons.dashboard_outlined,
              ),
              text: 'Overview',
            ),
            Tab(
              icon: Icon(
                Icons.fact_check_outlined,
              ),
              text:
                  'Attendance & Reports',
            ),
            Tab(
              icon: Icon(
                Icons.devices_outlined,
              ),
              text:
                  'Users & Devices',
            ),
            Tab(
              icon: Icon(
                Icons.security_outlined,
              ),
              text:
                  'Login & IP Logs',
            ),
            Tab(
              icon: Icon(
                Icons.wifi_outlined,
              ),
              text: 'Office Wi-Fi',
            ),
          ],
        ),

        actions: [
          if (showingAttendance)
            IconButton(
              tooltip:
                  'Export filtered attendance as CSV',
              onPressed:
                  _isExporting
                      ? null
                      : _exportAttendance,
              icon: _isExporting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child:
                          CircularProgressIndicator(
                        strokeWidth: 2,
                      ),
                    )
                  : const Icon(
                      Icons.download,
                    ),
            ),

          IconButton(
            tooltip: 'Refresh',
            onPressed: _loadData,
            icon: const Icon(
              Icons.refresh,
            ),
          ),
        ],
      ),

      body: Column(
        children: [
          // ====================================================
          // ERROR
          // ====================================================

          if (_errorMessage != null)
            MaterialBanner(
              content: Text(
                _errorMessage!,
              ),
              leading: const Icon(
                Icons.error_outline,
                color: Colors.red,
              ),
              actions: [
                TextButton(
                  onPressed: _loadData,
                  child: const Text(
                    'Retry',
                  ),
                ),
              ],
            ),

          // ====================================================
          // BODY
          // ====================================================

          Expanded(
            child: _isLoading
                ? const Center(
                    child:
                        CircularProgressIndicator(),
                  )
                : TabBarView(
                    controller:
                        _tabController,
                    children: [
                      // Overview
                      _buildOverview(),

                      // Attendance + filter scroll together
                      _buildAttendanceTab(),

                      // Users + search scroll together
                      _buildUsersTab(),

                      // Logs + filters scroll together
                      _buildLogsTab(),

                      // Office Wi-Fi / approved IPs
                      _buildOfficeNetworksTab(),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}