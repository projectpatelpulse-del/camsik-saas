import 'package:camsik_user/core/config/tenant_config.dart';
import 'package:camsik_user/core/config/tenant_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseHexColor', () {
    test('accepts #RRGGBB and returns an opaque colour', () {
      expect(parseHexColor('#10B981'), const Color(0xFF10B981));
    });

    test('rejects anything that is not exactly #RRGGBB', () {
      expect(parseHexColor('red'), isNull);
      expect(parseHexColor('#abc'), isNull);
      expect(parseHexColor('javascript:alert(1)'), isNull);
      expect(parseHexColor(null), isNull);
      expect(parseHexColor(0xFF000000), isNull);
    });
  });

  group('TenantConfig.fromJson', () {
    test('parses a full server response', () {
      final cfg = TenantConfig.fromJson({
        'slug': 'recyclepro',
        'name': 'ReCycle Pro India',
        'brandName': 'ReCycle Pro',
        'tagline': 'Sell smart',
        'supportEmail': 'care@recyclepro.test',
        'supportPhone': '+91 98765 00001',
        'whatsappNumber': '919876500001',
        'currencySymbol': '₹',
        'country': 'India',
        'features': {'buyback': true, 'rentals': false, 'bad': 'yes'},
        'theme': {
          'primary': '#10B981',
          'secondary': '#0F172A',
          'accent': '#059669',
          'headingFont': 'Outfit',
          'bodyFont': 'Inter',
          'borderRadius': '16px',
          'isDarkTheme': false,
        },
        'version': 4,
      });

      expect(cfg.brandName, 'ReCycle Pro');
      expect(cfg.theme.primary, const Color(0xFF10B981));
      expect(cfg.theme.borderRadius, 16);
      expect(cfg.theme.headingFont, 'Outfit');
      expect(cfg.hasFeature('buyback'), isTrue);
      expect(cfg.hasFeature('rentals'), isFalse);
      expect(cfg.features.containsKey('bad'), isFalse, reason: 'non-boolean flags are dropped');
      expect(cfg.version, 4);
    });

    test('bad or missing values fall back to safe defaults', () {
      final cfg = TenantConfig.fromJson({
        'brandName': '   ',
        'theme': {'primary': 'not-a-colour', 'borderRadius': '9999px'},
        'whatsappNumber': 'call me',
      });

      expect(cfg.brandName, TenantConfig.fallback.brandName, reason: 'blank text uses the default');
      expect(cfg.theme.primary, TenantTheme.defaults.primary);
      expect(cfg.theme.borderRadius, TenantTheme.defaults.borderRadius, reason: 'out-of-range radius is ignored');
      expect(cfg.whatsappNumber, isNull, reason: 'invalid number hides WhatsApp');
    });

    test('an empty response still yields a usable config', () {
      final cfg = TenantConfig.fromJson(<String, dynamic>{});
      expect(cfg.slug, 'camsik');
      expect(cfg.theme.primary, TenantTheme.defaults.primary);
    });
  });

  group('contact links', () {
    test('WhatsApp link is built from the tenant number and pre-fills the brand name', () {
      final cfg = TenantConfig.fromJson({'brandName': 'ReCycle Pro', 'whatsappNumber': '+91 98765 00001'.replaceAll(' ', '')});
      expect(cfg.whatsappUrl, 'https://wa.me/919876500001');
      expect(cfg.whatsappMessageUrl, startsWith('https://wa.me/919876500001?text='));
      expect(cfg.whatsappMessageUrl, contains('ReCycle%20Pro'));
    });

    test('without WhatsApp the message link falls back to tel:', () {
      final cfg = TenantConfig.fromJson({'whatsappNumber': null, 'supportPhone': '+91 98765 00001'});
      expect(cfg.whatsappUrl, isNull);
      expect(cfg.whatsappMessageUrl, 'tel:+919876500001');
      expect(cfg.telUrl, 'tel:+919876500001');
    });

    test('the fallback config keeps the original Camsik numbers', () {
      expect(TenantConfig.fallback.whatsappUrl, 'https://wa.me/918976000010');
      expect(TenantConfig.fallback.contactPhone, '+918976000010');
    });
  });

  test('theme builder uses tenant colours for the primary button and app bar', () {
    final cfg = TenantConfig.fromJson({
      'theme': {'primary': '#10B981', 'secondary': '#0F172A', 'accent': '#059669'},
    });
    final theme = buildTenantTheme(cfg);
    expect(theme.colorScheme.primary, const Color(0xFF10B981));
    expect(theme.appBarTheme.backgroundColor, const Color(0xFF0F172A));
    expect(theme.elevatedButtonTheme.style?.backgroundColor?.resolve({}), const Color(0xFF10B981));
  });
}
