import 'package:flutter/material.dart';

import 'tenant_config.dart';

/// Builds the app's [ThemeData] from the tenant theme. With the platform defaults this matches the
/// original Camsik look. Structure is unchanged; only colours and radius come from the tenant.
ThemeData buildTenantTheme(TenantConfig config) {
  final t = config.theme;
  final radius = t.borderRadius;
  const border = Color(0xFFE2E8F0);

  return ThemeData(
    useMaterial3: true,
    fontFamily: t.bodyFont,
    colorScheme: ColorScheme.fromSeed(
      seedColor: t.primary,
      primary: t.primary,
      secondary: t.accent,
      surface: t.surface,
      brightness: t.isDarkTheme ? Brightness.dark : Brightness.light,
    ),
    scaffoldBackgroundColor: t.surface,
    cardTheme: CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
      color: Colors.white,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: t.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius * 0.7),
        borderSide: BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius * 0.7),
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius * 0.7),
        borderSide: BorderSide(color: t.primary, width: 1.8),
      ),
      hintStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        elevation: 0,
        backgroundColor: t.primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius * 0.7)),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: t.secondary,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
  );
}
