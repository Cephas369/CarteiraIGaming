import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((msg) => `${path}: ${msg}`);
    return [...own, ...flatten(e.children ?? [], path)];
  });
}

/**
 * whitelist: campos desconhecidos são descartados (não rejeitados), porque PSPs e
 * provedores costumam mandar campos extras. Sem conversão implícita: "100" não vira 100.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({ statusCode: 400, code: 'VALIDATION_ERROR', message: flatten(errors).join('; ') }),
  });
}
