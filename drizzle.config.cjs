require('dotenv').config();

/** @type { import("drizzle-kit").Config } */
module.exports = {
  schema: './shared/schema.js',
  out:    './script/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict:  false,
};
