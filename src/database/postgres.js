require('dotenv').config();
const postgres = require('postgres');

const connectionString = process.env.DATABASE_URL;
const sql = postgres(connectionString, {
    ssl: 'require',
    connect_timeout: 10
});

module.exports = sql;
