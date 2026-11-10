import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { Database, PG_POOL } from './database';
import { createPool } from './pool';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createPool({ connectionString: config.databaseUrl, max: config.dbPoolMax }),
    },
    Database,
  ],
  exports: [Database],
})
export class DatabaseModule {}
