import { Module } from '@nestjs/common';
import { PixModule } from '../pix/pix.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PixModule],
  controllers: [HealthController],
})
export class HealthModule {}
