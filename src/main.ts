import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  // rawBody: o webhook Pix precisa dos bytes exatos para conferir o HMAC
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);

  const config = app.get(AppConfig);
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API ouvindo na porta ${config.port}; Swagger em /docs`, 'Bootstrap');
}

void bootstrap();
