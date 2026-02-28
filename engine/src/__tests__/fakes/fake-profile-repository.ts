import type { IProfileRepository } from '../../common/ports/profile-repository.port';
import type {
  Profile,
  FieldConfig,
  CreateProfileInput,
  UpdateProfileInput,
} from '../../common/models/profile.model';
import { v4 as uuidv4 } from 'uuid';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/**
 * In-memory IProfileRepository for tests.
 * Pre-seed with test profiles via seed().
 */
export class FakeProfileRepository implements IProfileRepository {
  private readonly store = new Map<string, Profile>();

  seed(profiles: Profile[]): void {
    for (const profile of profiles) {
      this.store.set(profile.slug, profile);
    }
  }

  clear(): void {
    this.store.clear();
  }

  async findBySlug(slug: string): Promise<Profile | null> {
    return this.store.get(slug) ?? null;
  }

  async findAll(includeInactive = false): Promise<Profile[]> {
    return Array.from(this.store.values()).filter(
      (p) => includeInactive || p.isActive,
    );
  }

  async create(input: CreateProfileInput): Promise<Profile> {
    const fields = (input.fields ?? []).map((f) => ({
      ...f,
      isFastPath: f.matchStrategy === 'EXACT' && f.weight >= RESOLUTION_CONSTANTS.FAST_PATH_MIN_WEIGHT,
    }));

    const profile: Profile = {
      id: uuidv4(),
      slug: input.slug,
      name: input.name,
      entityType: input.entityType,
      defaultThreshold: input.defaultThreshold,
      fields,
      fastPathFields: fields.filter((f) => f.isFastPath).map((f) => f.fieldName),
      semanticFields: fields
        .filter((f) => f.matchStrategy === 'SEMANTIC' || f.matchStrategy === 'HYBRID')
        .map((f) => f.fieldName),
      isActive: true,
      sourceSystem: input.sourceSystem,
      externalIdField: input.externalIdField,
      allowAuthoritativeCreate: input.allowAuthoritativeCreate ?? true,
      metadata: input.metadata ?? {},
      entityCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.store.set(profile.slug, profile);
    return profile;
  }

  async update(slug: string, updates: UpdateProfileInput): Promise<Profile> {
    const existing = this.store.get(slug);
    if (!existing) throw new Error(`Profile ${slug} not found`);

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.store.set(slug, updated);
    return updated;
  }

  async softDelete(slug: string): Promise<void> {
    await this.update(slug, { isActive: false });
  }

  async addField(slug: string, field: FieldConfig): Promise<Profile> {
    const existing = this.store.get(slug);
    if (!existing) throw new Error(`Profile ${slug} not found`);

    const fields = [...existing.fields, field];
    return this.update(slug, {} as UpdateProfileInput).then(() => {
      const updated = { ...existing, fields, updatedAt: new Date() };
      this.store.set(slug, updated);
      return updated;
    });
  }

  async updateField(slug: string, fieldName: string, updates: Partial<FieldConfig>): Promise<Profile> {
    const existing = this.store.get(slug);
    if (!existing) throw new Error(`Profile ${slug} not found`);

    const fields = existing.fields.map((f) =>
      f.fieldName === fieldName ? { ...f, ...updates } : f,
    );
    const updated = { ...existing, fields, updatedAt: new Date() };
    this.store.set(slug, updated);
    return updated;
  }

  async removeField(slug: string, fieldName: string): Promise<Profile> {
    const existing = this.store.get(slug);
    if (!existing) throw new Error(`Profile ${slug} not found`);

    const fields = existing.fields.filter((f) => f.fieldName !== fieldName);
    const updated = { ...existing, fields, updatedAt: new Date() };
    this.store.set(slug, updated);
    return updated;
  }
}
