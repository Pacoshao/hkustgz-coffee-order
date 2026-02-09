const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

console.log(`Attempting to connect to database: ${config.database} on host: ${config.host}`);

const pool = mysql.createPool(config);

async function getPool() {
    return pool;
}

module.exports = {
    getPool
};
