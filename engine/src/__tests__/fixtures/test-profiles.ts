import type { Profile } from '../../common/models/profile.model';
import type { Entity } from '../../common/models/entity.model';

/**
 * Test profile fixtures.
 * Use these in integration tests to avoid repetitive profile setup.
 */

export const SUPPLIER_PROFILE: Profile = {
  id: 'prof-supplier-test',
  slug: 'supplier-dedup',
  name: 'Supplier Deduplication',
  entityType: 'Supplier',
  defaultThreshold: 0.7,
  fields: [
    {
      fieldName: 'name',
      matchStrategy: 'FUZZY',
      weight: 5.0,
      isRequired: true,
      isPrimaryDisplay: true,
      isFastPath: false,
      fieldOrder: 1,
    },
    {
      fieldName: 'tax_id',
      matchStrategy: 'EXACT',
      weight: 3.0,
      isRequired: false,
      isPrimaryDisplay: false,
      isFastPath: true,
      fieldOrder: 2,
    },
    {
      fieldName: 'country',
      matchStrategy: 'EXACT',
      weight: 1.0,
      isRequired: false,
      isPrimaryDisplay: false,
      isFastPath: false,
      fieldOrder: 3,
    },
  ],
  fastPathFields: ['tax_id'],
  semanticFields: [],
  isActive: true,
  allowAuthoritativeCreate: true,
  metadata: {},
  entityCount: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

export const PERSON_PROFILE: Profile = {
  id: 'prof-person-test',
  slug: 'person-match',
  name: 'Person Match',
  entityType: 'Person',
  defaultThreshold: 0.65,
  fields: [
    {
      fieldName: 'first_name',
      matchStrategy: 'PHONETIC',
      weight: 2.0,
      isRequired: true,
      isPrimaryDisplay: true,
      isFastPath: false,
      fieldOrder: 1,
    },
    {
      fieldName: 'last_name',
      matchStrategy: 'FUZZY',
      weight: 3.0,
      isRequired: true,
      isPrimaryDisplay: false,
      isFastPath: false,
      fieldOrder: 2,
    },
    {
      fieldName: 'email',
      matchStrategy: 'EXACT',
      weight: 4.0,
      isRequired: false,
      isPrimaryDisplay: false,
      isFastPath: true,
      fieldOrder: 3,
    },
  ],
  fastPathFields: ['email'],
  semanticFields: [],
  isActive: true,
  allowAuthoritativeCreate: true,
  metadata: {},
  entityCount: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/** Pre-seeded supplier entities for testing. */
export const SUPPLIER_ENTITIES: Entity[] = [
  {
    entityId: 'ent-acme-001',
    profileId: 'prof-supplier-test',
    displayName: 'Acme Corporation',
    fieldValues: { name: 'Acme Corporation', tax_id: '36-1234567', country: 'US' },
    isActive: true,
    version: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    entityId: 'ent-ibm-001',
    profileId: 'prof-supplier-test',
    displayName: 'IBM Corp',
    fieldValues: { name: 'IBM Corp', tax_id: '13-0871985', country: 'US' },
    isActive: true,
    version: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];

export const PERSON_ENTITIES: Entity[] = [
  {
    entityId: 'ent-john-001',
    profileId: 'prof-person-test',
    displayName: 'John Smith',
    fieldValues: { first_name: 'John', last_name: 'Smith', email: 'john.smith@example.com' },
    isActive: true,
    version: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];
