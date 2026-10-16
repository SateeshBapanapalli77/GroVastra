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
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || env.NODE_ENV === 'test') {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    credentials: true
  })
);
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

// 404 Handler for undefined /api/v1 routes
app.use('/api/v1', (req: express.Request, res: express.Response) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND'
  });
});

// Central error handler enforcing universal error shape: { success: false, error, code, fieldPath? }
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = err.status || err.statusCode || 500;
  const code = err.code || (statusCode === 404 ? 'NOT_FOUND' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 422 ? 'UNPROCESSABLE_ENTITY' : 'INTERNAL_SERVER_ERROR');
  res.status(statusCode).json({
    success: false,
    error: err.message || 'An unexpected error occurred',
    code,
    ...(err.fieldPath ? { fieldPath: err.fieldPath } : {})
  });
});

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
