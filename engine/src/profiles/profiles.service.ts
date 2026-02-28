import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IProfileRepository } from '../common/ports/profile-repository.port';
import type { ICacheProvider } from '../common/ports/cache-provider.port';
import type {
  Profile,
  FieldConfig,
  CreateProfileInput,
  UpdateProfileInput,
} from '../common/models/profile.model';
import { INJECTION_TOKENS } from '../common/tokens/injection-tokens';
import { ProfileNotFoundError, FieldNotFoundError } from '../common/errors/domain-errors';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * ProfilesService manages resolution profile CRUD and field configuration.
 *
 * Profile data is cached in the L0/L1 cache with a short TTL (default 60s)
 * since profiles are read on every resolve request but updated rarely.
 */
@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);
  private readonly profileCacheTtl: number;

  constructor(
    @Inject(INJECTION_TOKENS.PROFILE_REPOSITORY)
    private readonly profileRepository: IProfileRepository,
    @Inject(INJECTION_TOKENS.CACHE_PROVIDER)
    private readonly cacheProvider: ICacheProvider,
    private readonly configService: ConfigService,
  ) {
    this.profileCacheTtl = this.configService.get<number>(
      'PROFILE_CACHE_TTL_SECONDS',
      RESOLUTION_CONSTANTS.PROFILE_CACHE_TTL_SECONDS,
    );
  }

  /**
   * Retrieves a profile by slug with cache-aside loading.
   * @param slug - Profile slug identifier.
   * @throws ProfileNotFoundError if the profile does not exist or is inactive.
   */
  async getBySlug(slug: string): Promise<Profile> {
    const cacheKey = `${RESOLUTION_CONSTANTS.PROFILE_CACHE_KEY_PREFIX}:${slug}`;

    const cached = await this.cacheProvider.get<Profile>(cacheKey);
    if (cached) return cached;

    const profile = await this.profileRepository.findBySlug(slug);

    if (!profile) {
      throw new ProfileNotFoundError(slug);
    }

    void this.cacheProvider.set(cacheKey, profile, this.profileCacheTtl);

    return profile;
  }

  /**
   * Lists all active profiles.
   * @param includeInactive - When true, includes soft-deleted profiles.
   */
  async listAll(includeInactive = false): Promise<Profile[]> {
    return this.profileRepository.findAll(includeInactive);
  }

  /**
   * Creates a new profile.
   * @param input - Profile creation parameters.
   */
  async create(input: CreateProfileInput): Promise<Profile> {
    const profile = await this.profileRepository.create(input);
    this.logger.log(`Created profile: ${profile.slug}`);
    return profile;
  }

  /**
   * Partially updates a profile's metadata or configuration.
   * Invalidates the profile cache after update.
   * @param slug - Profile slug identifier.
   * @param updates - Fields to update.
   */
  async update(slug: string, updates: UpdateProfileInput): Promise<Profile> {
    const profile = await this.profileRepository.update(slug, updates);
    await this.invalidateProfileCache(slug);
    return profile;
  }

  /**
   * Soft-deletes a profile (marks is_active = false).
   * Does not delete associated entities.
   * @param slug - Profile slug identifier.
   * @throws ProfileNotFoundError if the profile does not exist.
   */
  async softDelete(slug: string): Promise<void> {
    await this.getBySlug(slug); // Verifies existence
    await this.profileRepository.softDelete(slug);
    await this.invalidateProfileCache(slug);
    this.logger.log(`Soft-deleted profile: ${slug}`);
  }

  /**
   * Adds a new field to a profile.
   * @param slug - Profile slug identifier.
   * @param field - Field configuration to add.
   */
  async addField(slug: string, field: FieldConfig): Promise<Profile> {
    const profile = await this.profileRepository.addField(slug, field);
    await this.invalidateProfileCache(slug);
    return profile;
  }

  /**
   * Updates an existing field on a profile.
   * @param slug - Profile slug.
   * @param fieldName - Name of the field to update.
   * @param updates - Partial field updates.
   * @throws FieldNotFoundError if the field does not exist on the profile.
   */
  async updateField(
    slug: string,
    fieldName: string,
    updates: Partial<FieldConfig>,
  ): Promise<Profile> {
    const profile = await this.getBySlug(slug);
    const fieldExists = profile.fields.some((f) => f.fieldName === fieldName);

    if (!fieldExists) {
      throw new FieldNotFoundError(fieldName, slug);
    }

    const updated = await this.profileRepository.updateField(slug, fieldName, updates);
    await this.invalidateProfileCache(slug);
    return updated;
  }

  /**
   * Removes a field from a profile.
   * @param slug - Profile slug.
   * @param fieldName - Name of the field to remove.
   * @throws FieldNotFoundError if the field does not exist.
   */
  async removeField(slug: string, fieldName: string): Promise<Profile> {
    const profile = await this.getBySlug(slug);
    const fieldExists = profile.fields.some((f) => f.fieldName === fieldName);

    if (!fieldExists) {
      throw new FieldNotFoundError(fieldName, slug);
    }

    const updated = await this.profileRepository.removeField(slug, fieldName);
    await this.invalidateProfileCache(slug);
    return updated;
  }

  /**
   * Invalidates all cache entries for a profile (profile config + all resolve results).
   * @param slug - Profile slug.
   */
  async invalidateProfileCache(slug: string): Promise<void> {
    const profileCacheKey = `${RESOLUTION_CONSTANTS.PROFILE_CACHE_KEY_PREFIX}:${slug}`;
    await this.cacheProvider.delete(profileCacheKey);
    this.logger.log(`Cache invalidated for profile: ${slug}`);
  }
}
