const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

let client;
let db;
let bucket;

async function connectMongo() {
  if (db) return { client, db, bucket };
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'invexis_media';
  const bucketName = process.env.MONGODB_BUCKET || 'images';
  if (!uri) throw new Error('MONGODB_URI is not set');
  client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(dbName);
  bucket = new GridFSBucket(db, { bucketName });
  return { client, db, bucket };
}

function getBucket() {
  if (!bucket) throw new Error('Mongo not connected yet');
  return bucket;
}

module.exports = { connectMongo, getBucket, ObjectId };
