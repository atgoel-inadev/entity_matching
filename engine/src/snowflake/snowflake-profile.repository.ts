import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { IProfileRepository } from '../common/ports/profile-repository.port';
import type {
  Profile,
  FieldConfig,
  CreateProfileInput,
  UpdateProfileInput,
} from '../common/models/profile.model';
import { SnowflakeService } from './snowflake.service';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * SnowflakeProfileRepository implements IProfileRepository.
 * All SQL for profile and field management lives here.
 *
 * Data model:
 *  - resolution_profiles table: profile metadata
 *  - profile_fields table: one row per field per profile
 */
@Injectable()
export class SnowflakeProfileRepository implements IProfileRepository {
  private readonly logger = new Logger(SnowflakeProfileRepository.name);

  constructor(private readonly snowflakeService: SnowflakeService) {}

  /** {@inheritDoc IProfileRepository.findBySlug} */
  async findBySlug(slug: string): Promise<Profile | null> {
    const profileRows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT profile_id, profile_slug, profile_name, entity_type,
              default_threshold, is_active, source_system, external_id_field,
              allow_authoritative_create, config,
              created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at,
              (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = resolution_profiles.profile_id) AS entity_count
       FROM resolution_profiles
       WHERE profile_slug = ? AND is_active = TRUE`,
      [slug],
    );

    if (!profileRows[0]) return null;

    const fieldRows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT field_name, match_strategy, weight, is_required,
              is_primary_display, field_order, normalizer_options, strategy_options
       FROM profile_fields
       WHERE profile_id = ?
       ORDER BY field_order ASC`,
      [profileRows[0]['PROFILE_ID']],
    );

    return this.mapRowsToProfile(profileRows[0], fieldRows);
  }

  /** {@inheritDoc IProfileRepository.findAll} */
  async findAll(includeInactive = false): Promise<Profile[]> {
    const whereClause = includeInactive ? '' : 'WHERE is_active = TRUE';

    const profileRows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT profile_id, profile_slug, profile_name, entity_type,
              default_threshold, is_active, source_system, external_id_field,
              allow_authoritative_create, config,
              created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at,
              (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = resolution_profiles.profile_id) AS entity_count
       FROM resolution_profiles ${whereClause}
       ORDER BY created_at DESC`,
      [],
    );

    const profiles = await Promise.all(
      profileRows.map(async (row) => {
        const fieldRows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
          `SELECT field_name, match_strategy, weight, is_required,
                  is_primary_display, field_order, normalizer_options, strategy_options
           FROM profile_fields
           WHERE profile_id = ?
           ORDER BY field_order ASC`,
          [row['PROFILE_ID']],
        );
        return this.mapRowsToProfile(row, fieldRows);
      }),
    );

    return profiles;
  }

  /** {@inheritDoc IProfileRepository.create} */
  async create(input: CreateProfileInput): Promise<Profile> {
    const profileId = uuidv4();
    const metadataJson = JSON.stringify(input.metadata ?? {});

    await this.snowflakeService.executeQuery(
      `INSERT INTO resolution_profiles
         (profile_id, profile_slug, profile_name, entity_type, default_threshold,
          source_system, external_id_field, allow_authoritative_create, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?))`,
      [
        profileId, input.slug, input.name, input.entityType,
        input.defaultThreshold, input.sourceSystem ?? null,
        input.externalIdField ?? null,
        input.allowAuthoritativeCreate ?? true,
        metadataJson,
      ],
    );

    if (input.fields?.length) {
      for (const field of input.fields) {
        await this.insertField(profileId, field);
      }
    }

    const profile = await this.findBySlug(input.slug);
    if (!profile) throw new Error(`Failed to retrieve created profile ${input.slug}`);
    return profile;
  }

  /** {@inheritDoc IProfileRepository.update} */
  async update(slug: string, updates: UpdateProfileInput): Promise<Profile> {
    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP()'];
    const binds: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('profile_name = ?');
      binds.push(updates.name);
    }
    if (updates.defaultThreshold !== undefined) {
      setClauses.push('default_threshold = ?');
      binds.push(updates.defaultThreshold);
    }
    if (updates.isActive !== undefined) {
      setClauses.push('is_active = ?');
      binds.push(updates.isActive);
    }
    if (updates.allowAuthoritativeCreate !== undefined) {
      setClauses.push('allow_authoritative_create = ?');
      binds.push(updates.allowAuthoritativeCreate);
    }

    binds.push(slug);

    await this.snowflakeService.executeQuery(
      `UPDATE resolution_profiles SET ${setClauses.join(', ')} WHERE profile_slug = ?`,
      binds,
    );

    const profile = await this.findBySlug(slug);
    if (!profile) throw new Error(`Profile ${slug} not found after update`);
    return profile;
  }

  /** {@inheritDoc IProfileRepository.softDelete} */
  async softDelete(slug: string): Promise<void> {
    await this.snowflakeService.executeQuery(
      `UPDATE resolution_profiles SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP()
       WHERE profile_slug = ?`,
      [slug],
    );
  }

  /** {@inheritDoc IProfileRepository.addField} */
  async addField(slug: string, field: FieldConfig): Promise<Profile> {
    const profileRows = await this.snowflakeService.executeQuery<{ PROFILE_ID: string }>(
      `SELECT profile_id FROM resolution_profiles WHERE profile_slug = ?`,
      [slug],
    );
    const profileId = profileRows[0]?.PROFILE_ID;
    if (!profileId) throw new Error(`Profile ${slug} not found`);

    await this.insertField(profileId, field);

    const profile = await this.findBySlug(slug);
    if (!profile) throw new Error(`Profile ${slug} not found after field add`);
    return profile;
  }

  /** {@inheritDoc IProfileRepository.updateField} */
  async updateField(
    slug: string,
    fieldName: string,
    updates: Partial<FieldConfig>,
  ): Promise<Profile> {
    const setClauses: string[] = [];
    const binds: unknown[] = [];

    if (updates.matchStrategy !== undefined) {
      setClauses.push('match_strategy = ?');
      binds.push(updates.matchStrategy);
    }
    if (updates.weight !== undefined) {
      setClauses.push('weight = ?');
      binds.push(updates.weight);
    }

    if (setClauses.length === 0) {
      return (await this.findBySlug(slug))!;
    }

    binds.push(slug, fieldName);

    await this.snowflakeService.executeQuery(
      `UPDATE profile_fields pf
       JOIN resolution_profiles rp ON rp.profile_id = pf.profile_id
       SET ${setClauses.join(', ')}
       WHERE rp.profile_slug = ? AND pf.field_name = ?`,
      binds,
    );

    const profile = await this.findBySlug(slug);
    if (!profile) throw new Error(`Profile ${slug} not found after field update`);
    return profile;
  }

  /** {@inheritDoc IProfileRepository.removeField} */
  async removeField(slug: string, fieldName: string): Promise<Profile> {
    await this.snowflakeService.executeQuery(
      `DELETE FROM profile_fields
       WHERE profile_id = (SELECT profile_id FROM resolution_profiles WHERE profile_slug = ?)
         AND field_name = ?`,
      [slug, fieldName],
    );

    const profile = await this.findBySlug(slug);
    if (!profile) throw new Error(`Profile ${slug} not found after field removal`);
    return profile;
  }

  private async insertField(profileId: string, field: FieldConfig): Promise<void> {
    const normalizersJson = JSON.stringify(field.normalizerOptions ?? {});
    const strategyOptionsJson = JSON.stringify(field.strategyOptions ?? {});

    await this.snowflakeService.executeQuery(
      `INSERT INTO profile_fields
         (profile_id, field_name, match_strategy, weight, is_required,
          is_primary_display, field_order, normalizer_options, strategy_options)
       VALUES (?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?))`,
      [
        profileId, field.fieldName, field.matchStrategy, field.weight,
        field.isRequired, field.isPrimaryDisplay, field.fieldOrder,
        normalizersJson, strategyOptionsJson,
      ],
    );
  }

  private mapRowsToProfile(
    row: Record<string, unknown>,
    fieldRows: Record<string, unknown>[],
  ): Profile {
    const fields: FieldConfig[] = fieldRows.map((fr) => ({
      fieldName: fr['FIELD_NAME'] as string,
      matchStrategy: fr['MATCH_STRATEGY'] as FieldConfig['matchStrategy'],
      weight: fr['WEIGHT'] as number,
      isRequired: Boolean(fr['IS_REQUIRED']),
      isPrimaryDisplay: Boolean(fr['IS_PRIMARY_DISPLAY']),
      isFastPath: fr['MATCH_STRATEGY'] === 'EXACT' && (fr['WEIGHT'] as number) >= RESOLUTION_CONSTANTS.FAST_PATH_MIN_WEIGHT,
      fieldOrder: fr['FIELD_ORDER'] as number,
      normalizerOptions: typeof fr['NORMALIZER_OPTIONS'] === 'string'
        ? JSON.parse(fr['NORMALIZER_OPTIONS'])
        : fr['NORMALIZER_OPTIONS'] ?? undefined,
      strategyOptions: typeof fr['STRATEGY_OPTIONS'] === 'string'
        ? JSON.parse(fr['STRATEGY_OPTIONS'])
        : fr['STRATEGY_OPTIONS'] ?? undefined,
    }));

    return {
      id: row['PROFILE_ID'] as string,
      slug: row['PROFILE_SLUG'] as string,
      name: row['PROFILE_NAME'] as string,
      entityType: row['ENTITY_TYPE'] as string,
      defaultThreshold: row['DEFAULT_THRESHOLD'] as number,
      fields,
      fastPathFields: fields
        .filter((f) => f.isFastPath)
        .map((f) => f.fieldName),
      semanticFields: fields
        .filter((f) => f.matchStrategy === 'SEMANTIC' || f.matchStrategy === 'HYBRID')
        .map((f) => f.fieldName),
      isActive: Boolean(row['IS_ACTIVE']),
      sourceSystem: row['SOURCE_SYSTEM'] as string | undefined,
      externalIdField: row['EXTERNAL_ID_FIELD'] as string | undefined,
      allowAuthoritativeCreate: Boolean(row['ALLOW_AUTHORITATIVE_CREATE']),
      metadata: typeof row['CONFIG'] === 'string'
        ? JSON.parse(row['CONFIG'])
        : row['CONFIG'] ?? {},
      entityCount: Number(row['ENTITY_COUNT'] ?? 0),
      createdAt: new Date(row['CREATED_AT'] as string),
      updatedAt: new Date(row['UPDATED_AT'] as string),
    };
  }
}
