import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase } from './config/database';
import { campaignRouter, webhookRouter } from './modules/campaigns';
import { authRouter } from './modules/auth/routes/auth.routes';

const app = express();

// Security and HTTP Logging
app.use(cors());
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/api/v1/health'
    }
  })
);

// JSON parser with raw body buffer capture for HMAC webhook verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Health Check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'grovastra-backend',
    tenant: env.DEFAULT_TENANT_ID,
    whatsappMode: env.WHATSAPP_MODE
  });
});

// Mount Webhook Ingress, Auth & Campaign Module APIs
app.use('/api/v1', webhookRouter);
app.use('/api/v1', authRouter);
app.use('/api/v1', campaignRouter);

async function startServer() {
  try {
    await connectDatabase();

    app.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, env: env.NODE_ENV, whatsappMode: env.WHATSAPP_MODE },
        'GroVastra Modular Monolith Server is running'
      );
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Only start when invoked directly
if (require.main === module) {
  startServer();
}

export default app;
