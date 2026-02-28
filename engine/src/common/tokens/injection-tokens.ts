/**
 * Symbol-based injection tokens for NestJS dependency injection.
 * Using Symbols (instead of string literals) prevents accidental token collisions
 * and enforces the hexagonal architecture boundary: consumers depend on the token
 * (defined here in common/) not on any concrete adapter class.
 *
 * Usage in a module provider:
 *   { provide: INJECTION_TOKENS.ENTITY_REPOSITORY, useClass: SnowflakeEntityRepository }
 *
 * Usage in a service constructor:
 *   constructor(@Inject(INJECTION_TOKENS.ENTITY_REPOSITORY) private readonly repo: IEntityRepository) {}
 */
export const INJECTION_TOKENS = {
  PROFILE_REPOSITORY: Symbol('IProfileRepository'),
  ENTITY_REPOSITORY: Symbol('IEntityRepository'),
  EMBEDDING_PROVIDER: Symbol('IEmbeddingProvider'),
  CACHE_PROVIDER: Symbol('ICacheProvider'),
  AUDIT_LOGGER: Symbol('IAuditLogger'),
} as const;

export type InjectionTokenKey = keyof typeof INJECTION_TOKENS;
