import mongoose from 'mongoose';
import { beforeAll, afterAll } from 'vitest';

beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. A real MongoDB replica set is required for all tests.');
  }
  if (mongoose.connection.readyState === 0) {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000
    });
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});
