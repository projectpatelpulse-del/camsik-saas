import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/api_constants.dart';
import 'tenant_config.dart';

/// Loads the tenant configuration once at startup.
///
/// Order:
///   1. Fetch `/api/tenant-config` for this build's tenant (TENANT_SLUG build define).
///   2. On success, cache the JSON and use it.
///   3. On network failure, use the last cached config.
///   4. If the tenant is not found or suspended (404), use the platform fallback and clear the cache,
///      so a suspended storefront does not keep showing old branding.
class TenantConfigLoader {
  TenantConfigLoader._();

  /// Set per build: `flutter build apk --dart-define=TENANT_SLUG=recyclepro`.
  static const String tenantSlug = String.fromEnvironment('TENANT_SLUG', defaultValue: 'camsik');
  static const String _cacheKey = 'camsik_tenant_config_json';

  static Future<TenantConfig> load({Dio? dio, Duration timeout = const Duration(seconds: 4)}) async {
    final prefs = await SharedPreferences.getInstance();
    final client = dio ?? Dio(BaseOptions(connectTimeout: timeout, receiveTimeout: timeout));

    try {
      final res = await client.get<dynamic>(
        '${ApiConstants.baseUrl}/tenant-config',
        queryParameters: {'tenant': tenantSlug},
      );
      final data = res.data;
      if (data is Map && data['success'] == true && data['config'] is Map) {
        final json = Map<String, dynamic>.from(data['config'] as Map);
        await prefs.setString(_cacheKey, jsonEncode(json));
        return TenantConfig.current = TenantConfig.fromJson(json);
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        await prefs.remove(_cacheKey);
        return TenantConfig.current = TenantConfig.fallback;
      }
      // Other network errors fall through to the cache.
    } catch (_) {
      // Malformed response: fall through to the cache.
    }

    final cached = prefs.getString(_cacheKey);
    if (cached != null) {
      try {
        return TenantConfig.current = TenantConfig.fromJson(
          Map<String, dynamic>.from(jsonDecode(cached) as Map),
        );
      } catch (_) {
        await prefs.remove(_cacheKey);
      }
    }
    return TenantConfig.current = TenantConfig.fallback;
  }
}
