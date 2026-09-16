import { timingSafeEqual } from 'node:crypto';
import { getSecret, type SecretKeyValida } from '../services/secrets.js';

/**
 * Compara o segredo de um webhook com o que está gravado no cofre.
 *
 * **Falha fechada**: sem segredo cadastrado, nada é aceito. Um provedor que
 * ainda não foi configurado não pode ter suas notificações processadas — é
 * justamente a janela em que a URL já existe e ninguém a protege.
 *
 * A comparação é de tempo constante. O ganho é pequeno pela rede, mas o
 * custo de fazer certo também é, e `===` em segredo é o tipo de detalhe que
 * um auditor marca sem discutir.
 *
 * O tamanho é conferido antes porque `timingSafeEqual` **lança** quando os
 * buffers têm comprimentos diferentes, em vez de devolver `false` — e uma
 * exceção aqui viraria 500, fazendo o provedor reenviar para sempre uma
 * notificação que nunca seria aceita.
 *
 * Vive em `lib/` e não dentro de um adaptador porque a Appmax e a FyHub
 * usam a mesma regra. Duas cópias divergiriam na primeira correção — que é
 * exatamente o defeito que este projeto já pagou uma vez, com o mesmo
 * `?? null` consertado num arquivo e vivo no outro.
 */
export async function conferirSegredoDeWebhook(
  chave: SecretKeyValida,
  recebido: string | undefined,
): Promise<boolean> {
  const esperado = await getSecret(chave);
  if (!esperado || !recebido) return false;

  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(recebido, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
