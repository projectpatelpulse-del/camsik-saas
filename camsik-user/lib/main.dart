import 'dart:async';
import 'package:flutter/material.dart';
import 'app.dart';
import 'core/config/tenant_config_loader.dart';
import 'core/services/session_service.dart';

void main() {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    await SessionService.init();
    // Branding and theme are loaded before the first frame. Falls back to cache, then defaults.
    await TenantConfigLoader.load();
    FlutterError.onError = (FlutterErrorDetails details) {
      FlutterError.presentError(details);
      debugPrint('CamsikUser Error: ${details.exception}');
    };
    runApp(const CamsikUserApp());
  }, (error, stack) {
    debugPrint('CamsikUser Uncaught: $error\n$stack');
  });
}
