import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PROVIDER_API_KEY_HEADER } from './provider/provider-auth.guard';

/** Configuração compartilhada entre main.ts e os testes e2e. */
export function configureApp(app: INestApplication, { swagger = true } = {}): void {
  app.enableShutdownHooks();

  if (swagger) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Carteira iGaming (seamless wallet)')
        .setDescription(
          'Carteira para provedores de jogo: balance / bet / win / rollback idempotentes, ' +
            'ledger de dupla entrada e depósito via Pix (webhook HMAC + fila). Valores sempre em centavos.',
        )
        .setVersion('0.1.0')
        .addApiKey({ type: 'apiKey', name: PROVIDER_API_KEY_HEADER, in: 'header' }, 'provider-key')
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
