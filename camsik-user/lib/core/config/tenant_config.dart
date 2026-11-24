import 'package:flutter/material.dart';

/// Parses "#RRGGBB" into an opaque [Color]. Anything else returns null so callers can fall back.
Color? parseHexColor(Object? value) {
  if (value is! String) return null;
  final hex = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(value);
  if (hex == null) return null;
  return Color(0xFF000000 | int.parse(hex.group(1)!, radix: 16));
}

/// Theme values the app uses at runtime. Built from the tenant config, with defaults.
class TenantTheme {
  final Color primary;
  final Color secondary;
  final Color accent;
  final Color surface;
  final double borderRadius;
  final String headingFont;
  final String bodyFont;
  final bool isDarkTheme;

  const TenantTheme({
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.surface,
    required this.borderRadius,
    required this.headingFont,
    required this.bodyFont,
    required this.isDarkTheme,
  });

  /// Platform default (the original Camsik look).
  static const TenantTheme defaults = TenantTheme(
    primary: Color(0xFF059669),
    secondary: Color(0xFF0F172A),
    accent: Color(0xFF4F46E5),
    surface: Color(0xFFF8FAFC),
    borderRadius: 20,
    headingFont: 'Roboto',
    bodyFont: 'Roboto',
    isDarkTheme: false,
  );
}

/// Public configuration for one tenant, as served by `/api/tenant-config`.
/// Contains no secrets. Every field has a safe default, so a partial or old response still works.
class TenantConfig {
  final String slug;
  final String name;
  final String brandName;
  final String tagline;
  final String logoUrl;
  final String supportEmail;
  final String supportPhone;
  final String? whatsappNumber;
  final String currencySymbol;
  final String country;
  final Map<String, bool> features;
  final TenantTheme theme;
  final int version;

  const TenantConfig({
    required this.slug,
    required this.name,
    required this.brandName,
    required this.tagline,
    required this.logoUrl,
    required this.supportEmail,
    required this.supportPhone,
    required this.whatsappNumber,
    required this.currencySymbol,
    required this.country,
    required this.features,
    required this.theme,
    required this.version,
  });

  /// Used when no tenant config can be loaded and nothing is cached. Matches the original Camsik app.
  static const TenantConfig fallback = TenantConfig(
    slug: 'camsik',
    name: 'Camsik',
    brandName: 'Camsik',
    tagline: '',
    logoUrl: '',
    supportEmail: '',
    supportPhone: '+918976000010',
    whatsappNumber: '918976000010',
    currencySymbol: '₹',
    country: 'India',
    features: {},
    theme: TenantTheme.defaults,
    version: 0,
  );

  /// The config in use for this app run. Set once at startup by the loader.
  static TenantConfig current = fallback;

  factory TenantConfig.fromJson(Map<String, dynamic> json) {
    String text(String key, String def) {
      final v = json[key];
      return v is String && v.trim().isNotEmpty ? v.trim() : def;
    }

    final rawTheme = json['theme'] is Map ? Map<String, dynamic>.from(json['theme'] as Map) : <String, dynamic>{};
    final rawFeatures = json['features'] is Map ? Map<String, dynamic>.from(json['features'] as Map) : <String, dynamic>{};

    final whatsappRaw = json['whatsappNumber'];
    final whatsapp = whatsappRaw is String && RegExp(r'^\+?[0-9]{8,15}$').hasMatch(whatsappRaw)
        ? whatsappRaw.replaceAll('+', '')
        : null;

    final radius = rawTheme['borderRadius'] is String
        ? double.tryParse((rawTheme['borderRadius'] as String).replaceAll('px', ''))
        : null;

    final d = TenantTheme.defaults;
    return TenantConfig(
      slug: text('slug', fallback.slug),
      name: text('name', fallback.name),
      brandName: text('brandName', fallback.brandName),
      tagline: text('tagline', ''),
      logoUrl: text('logoUrl', ''),
      supportEmail: text('supportEmail', ''),
      supportPhone: text('supportPhone', fallback.supportPhone),
      whatsappNumber: whatsapp,
      currencySymbol: text('currencySymbol', fallback.currencySymbol),
      country: text('country', fallback.country),
      features: {
        for (final e in rawFeatures.entries)
          if (e.value is bool) e.key: e.value as bool,
      },
      theme: TenantTheme(
        primary: parseHexColor(rawTheme['primary']) ?? d.primary,
        secondary: parseHexColor(rawTheme['secondary']) ?? d.secondary,
        accent: parseHexColor(rawTheme['accent']) ?? d.accent,
        surface: d.surface,
        borderRadius: radius != null && radius >= 0 && radius <= 40 ? radius : d.borderRadius,
        headingFont: rawTheme['headingFont'] is String ? rawTheme['headingFont'] as String : d.headingFont,
        bodyFont: rawTheme['bodyFont'] is String ? rawTheme['bodyFont'] as String : d.bodyFont,
        isDarkTheme: rawTheme['isDarkTheme'] == true,
      ),
      version: json['version'] is int ? json['version'] as int : 0,
    );
  }

  /// Feature flag lookup. Unknown flags default to [defaultValue].
  bool hasFeature(String key, {bool defaultValue = true}) => features[key] ?? defaultValue;

  /// Number shown to customers (spaces removed so it works in tel: links).
  String get contactPhone => supportPhone.replaceAll(' ', '');

  String get telUrl => 'tel:$contactPhone';

  String? get whatsappUrl => whatsappNumber == null ? null : 'https://wa.me/$whatsappNumber';

  /// Pre-filled WhatsApp support link for this tenant. Falls back to the phone link when WhatsApp is off.
  String get whatsappMessageUrl {
    if (whatsappUrl == null) return telUrl;
    final message = Uri.encodeComponent('Hi $brandName Support, I need help with my order');
    return '$whatsappUrl?text=$message';
  }
}
