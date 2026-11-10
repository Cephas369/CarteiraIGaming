import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/** Processo separado da API: escala de forma independente e não disputa CPU com as apostas. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('worker de depósitos Pix iniciado', 'Bootstrap');
}

void bootstrap();
