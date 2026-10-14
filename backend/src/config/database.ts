import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

export async function connectDatabase(): Promise<typeof mongoose> {
  try {
    mongoose.set('strictQuery', true);
    
    const conn = await mongoose.connect(env.MONGODB_URI, {
      autoIndex: true, // Build compound unique indexes
      serverSelectionTimeoutMS: 5000,
    });

    logger.info({ uri: env.MONGODB_URI.replace(/\/\/.*@/, '//<redacted>@') }, 'Connected to MongoDB');
    return conn;
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to MongoDB');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Disconnected from MongoDB');
}
