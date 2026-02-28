import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * SnakeCaseResponseInterceptor converts all outgoing response keys from camelCase
 * to snake_case so that the React UI (which expects snake_case) works without
 * any client-side transformation.
 *
 * Additional Profile-specific enrichment:
 *  - Adds `profile_slug` alias for `slug`
 *  - Adds `profile_name` alias for `name`
 *  - Adds `entity_count: 0` placeholder when missing
 *  - Derives `field_label` from `field_name` when missing
 */
@Injectable()
export class SnakeCaseResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.transform(data)));
  }

  private transform(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.transform(item));
    }

    if (data !== null && typeof data === 'object' && !(data instanceof Date)) {
      const obj = data as Record<string, unknown>;
      const snake: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(obj)) {
        snake[this.toSnakeCase(key)] = this.transform(val);
      }

      // Profile-specific: add UI-expected aliases + derived fields
      // Detected by the presence of both 'slug' and 'entity_type' in the transformed object
      if ('slug' in snake && 'entity_type' in snake) {
        snake['profile_slug'] = snake['slug'];
        snake['profile_name'] = snake['name'];
        if (!('entity_count' in snake)) {
          snake['entity_count'] = 0;
        }
        // Enrich each FieldConfig with field_label derived from field_name
        if (Array.isArray(snake['fields'])) {
          snake['fields'] = (snake['fields'] as Record<string, unknown>[]).map((f) => ({
            ...f,
            field_label: f['field_label'] ?? this.humanize(String(f['field_name'] ?? '')),
          }));
        }
      }

      return snake;
    }

    return data;
  }

  /** Converts camelCase or PascalCase to snake_case. */
  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  /** Converts snake_case field names to a human-readable label. */
  private humanize(fieldName: string): string {
    return fieldName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
