import 'csv_download_stub.dart'
    if (dart.library.html) 'csv_download_web.dart'
    as platform;

Future<bool> downloadCsv(String filename, String contents) {
  return platform.downloadCsv(filename, contents);
}
