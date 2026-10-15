import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | null = null;

export async function setup() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 }
  });
  const uri = replSet.getUri();
  process.env.MONGODB_URI = uri;
  process.env.TEST_DB_URI = uri;
}

export async function teardown() {
  if (replSet) {
    await replSet.stop();
  }
}
