import type {
  Profile,
  FieldConfig,
  CreateProfileInput,
  UpdateProfileInput,
} from '../models/profile.model';

/**
 * Port interface for profile persistence.
 * Adapter (SnowflakeProfileRepository) implements this contract.
 * No SQL or infrastructure concerns may appear in this interface.
 */
export interface IProfileRepository {
  /**
   * Retrieves a profile by its URL-safe slug.
   * @param slug - e.g., "supplier-dedup"
   * @returns The profile, or null if not found or inactive.
   */
  findBySlug(slug: string): Promise<Profile | null>;

  /**
   * Lists all profiles.
   * @param includeInactive - When true, also returns soft-deleted profiles.
   */
  findAll(includeInactive?: boolean): Promise<Profile[]>;

  /**
   * Creates a new profile with optional initial fields.
   * @param input - Profile creation parameters.
   * @returns The newly created profile.
   */
  create(input: CreateProfileInput): Promise<Profile>;

  /**
   * Partially updates a profile's metadata or threshold.
   * @param slug - Profile slug identifier.
   * @param updates - Fields to update (all optional).
   */
  update(slug: string, updates: UpdateProfileInput): Promise<Profile>;

  /**
   * Soft-deletes a profile (sets is_active = false).
   * Does not delete associated entities.
   */
  softDelete(slug: string): Promise<void>;

  /**
   * Adds a new field configuration to an existing profile.
   * @param slug - Profile slug.
   * @param field - Field configuration to add.
   * @returns Updated profile with the new field.
   */
  addField(slug: string, field: FieldConfig): Promise<Profile>;

  /**
   * Updates an existing field's strategy, weight, or options.
   * @param slug - Profile slug.
   * @param fieldName - Name of the field to update.
   * @param updates - Partial field updates.
   */
  updateField(
    slug: string,
    fieldName: string,
    updates: Partial<FieldConfig>,
  ): Promise<Profile>;

  /**
   * Removes a field from a profile's configuration.
   * @param slug - Profile slug.
   * @param fieldName - Name of the field to remove.
   */
  removeField(slug: string, fieldName: string): Promise<Profile>;
}
