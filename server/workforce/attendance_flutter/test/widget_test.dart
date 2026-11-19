import 'package:flutter_test/flutter_test.dart';

import 'package:attendance_app_final/main.dart';

void main() {
  testWidgets('Attendance app starts with its configured Flutter root', (
    tester,
  ) async {
    await tester.pumpWidget(const AttendanceApp());

    expect(find.byType(AttendanceApp), findsOneWidget);
  });
}
