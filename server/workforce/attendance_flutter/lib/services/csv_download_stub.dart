import 'package:flutter/services.dart';

Future<bool> downloadCsv(String filename, String contents) async {
  await Clipboard.setData(ClipboardData(text: contents));
  return false;
}
