'use strict';

const { MongoClient } = require('./lib/mongo');

/*
 * UzoneQuiz intentionally starts without demo accounts or sample attempts.
 * This module only keeps a unique email index in place, so every user shown
 * in the app comes from an account created in the target database.
 */
async function migrateLegacy(db) {
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  return 0;
}

async function seedIfEmpty(db, { log = () => {} } = {}) {
  await migrateLegacy(db);
  log('No demo users or sample attempts were created.');
  return false;
}

module.exports = { seedIfEmpty, migrateLegacy };

if (require.main === module) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/uzonequiz';
  const client = new MongoClient(uri);
  client.connect()
    .then(() => seedIfEmpty(client.db(), { log: console.log }))
    .then(() => client.close())
    .catch((err) => { console.error('Setup failed:', err.message); process.exit(1); });
}
