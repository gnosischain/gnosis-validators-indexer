import { FastifyRequest, FastifyReply } from 'fastify';
import { API_KEY } from '../../config';

export async function apiKeyHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.headers['x-api-key'];
  if (key !== API_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
