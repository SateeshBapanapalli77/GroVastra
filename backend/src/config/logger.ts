import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'phone',
      'phoneNumber',
      'recipient',
      'encryptedRecipient',
      'messageBody',
      'parameters.phone',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.body',
      '*.from',
      '*.wa_id',
      '*.phone',
      '*.body',
      '*.text'
    ],
    censor: '[REDACTED]'
  },
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname'
          }
        }
      : undefined
});
