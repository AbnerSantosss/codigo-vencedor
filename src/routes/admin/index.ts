import type { FastifyPluginAsync } from 'fastify';
import { authRoutes } from './auth.js';
import { configRoutes } from './config.js';
import { gatewayRoutes } from './gateway.js';
import { eventsRoutes } from './events.js';
import { trackingRoutes } from './tracking.js';
import { metricsRoutes } from './metrics.js';
import { usersRoutes } from './users.js';
import { emailRoutes } from './email.js';
import { recoveryRoutes } from './recovery.js';
import { webhooksAdminRoutes } from './webhooks.js';

/**
 * Tudo aqui vive sob /api/admin. As rotas de autenticação ficam antes do
 * guard porque login e refresh precisam ser alcançáveis sem sessão.
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes);
  await app.register(configRoutes);
  await app.register(gatewayRoutes);
  await app.register(eventsRoutes);
  await app.register(trackingRoutes);
  await app.register(metricsRoutes);
  await app.register(usersRoutes);
  await app.register(emailRoutes);
  await app.register(recoveryRoutes);
  await app.register(webhooksAdminRoutes);
};
