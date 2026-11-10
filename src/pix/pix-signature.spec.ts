import { signPixPayload, verifyPixSignature } from './pix-signature';

describe('assinatura do webhook Pix', () => {
  const secret = 'unit-test-secret-0123456789';
  const body = Buffer.from('{"pix":[{"endToEndId":"E1","txid":"abc","valor":"10.00"}]}');

  it('aceita a assinatura correta', () => {
    expect(verifyPixSignature(body, signPixPayload(body, secret), secret)).toBe(true);
  });

  it('recusa corpo alterado em um único byte', () => {
    const tampered = Buffer.from(body.toString().replace('10.00', '90.00'));
    expect(verifyPixSignature(tampered, signPixPayload(body, secret), secret)).toBe(false);
  });

  it('recusa o mesmo JSON re-serializado com outra formatação', () => {
    const pretty = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    expect(verifyPixSignature(pretty, signPixPayload(body, secret), secret)).toBe(false);
  });

  it('recusa segredo errado, header ausente ou de tamanho diferente', () => {
    expect(verifyPixSignature(body, signPixPayload(body, 'outro-segredo-qualquer'), secret)).toBe(false);
    expect(verifyPixSignature(body, undefined, secret)).toBe(false);
    expect(verifyPixSignature(body, 'sha256=abc', secret)).toBe(false);
  });
});
