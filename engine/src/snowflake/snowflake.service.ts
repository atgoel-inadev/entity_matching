import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as snowflake from 'snowflake-sdk';
import { SnowflakeError } from '../common/errors/domain-errors';

/** Shape of a row returned from Snowflake execute(). */
export type SnowflakeRow = Record<string, unknown>;

/**
 * SnowflakeService provides a managed connection pool to Snowflake.
 *
 * All adapters (entity repository, embedding provider, audit logger) depend on this
 * service for query execution. Raw SQL execution lives here; adapters build the SQL
 * strings and pass bind parameters.
 *
 * Connection lifecycle:
 *  - Pool created on module init
 *  - Pool destroyed on module destroy
 *  - Individual connections returned to pool after each query
 */
@Injectable()
export class SnowflakeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnowflakeService.name);
  private pool!: ReturnType<typeof snowflake.createPool>;

  constructor(private readonly configService: ConfigService) {}

  /** Initialises the Snowflake connection pool on module startup. */
  async onModuleInit(): Promise<void> {
    const connectionOptions = this.buildConnectionOptions();
    this.pool = snowflake.createPool(connectionOptions, {
      max: 10,
      min: 1,
    });

    await this.verifyConnection();
    this.logger.log('Snowflake connection pool initialised');
  }

  /** Drains and destroys the connection pool on shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.drain();
      this.pool.clear();
      this.logger.log('Snowflake connection pool destroyed');
    }
  }

  /**
   * Executes a SQL statement and returns the result rows.
   * Binds are positional placeholders (?) in the SQL string.
   *
   * @param sql - The SQL statement with positional ? placeholders.
   * @param binds - Ordered array of bind values.
   * @returns Array of result rows as plain objects.
   * @throws SnowflakeError on connection or query failure.
   */
  async executeQuery<T extends SnowflakeRow>(
    sql: string,
    binds: unknown[] = [],
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.pool.use(async (clientConnection: snowflake.Connection) => {
        clientConnection.execute({
          sqlText: sql,
          binds: binds as snowflake.Binds,
          complete: (err: snowflake.SnowflakeError | undefined, _stmt: snowflake.RowStatement | snowflake.FileAndStageBindStatement, rows: Array<any> | undefined) => {
            if (err) {
              const snowflakeErr = new SnowflakeError(
                `Query failed: ${err.message}`,
                err,
              );
              reject(snowflakeErr);
              return;
            }
            resolve((rows ?? []) as T[]);
          },
        });
      });
    });
  }

  private buildConnectionOptions(): snowflake.ConnectionOptions {
    return {
      account: this.configService.getOrThrow<string>('SNOWFLAKE_ACCOUNT'),
      username: this.configService.getOrThrow<string>('SNOWFLAKE_USER'),
      password: this.configService.getOrThrow<string>('SNOWFLAKE_PASSWORD'),
      role: this.configService.get<string>('SNOWFLAKE_ROLE'),
      warehouse: this.configService.get<string>('SNOWFLAKE_WAREHOUSE'),
      database: this.configService.get<string>('SNOWFLAKE_DATABASE'),
      schema: this.configService.get<string>('SNOWFLAKE_SCHEMA'),
    };
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.executeQuery('SELECT 1 AS ping', []);
      this.logger.log('Snowflake connectivity verified');
    } catch (error) {
      this.logger.error('Snowflake connectivity check failed', error);
      throw error;
    }
  }
}
