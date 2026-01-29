const sql = require('mssql');
require('dotenv').config();

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    authentication: {
        type: 'azure-active-directory-default'
    },
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000
    }
};

console.log(`Attempting to connect to database: ${config.database} on server: ${config.server}`);

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(async pool => {
        console.log('Connected to Azure SQL successfully');
        return pool;
    })
    .catch(err => {
        console.error('Database Initial Connection Error:', err.message);
        // Do not throw here, let the app try to reconnect later or show better error
        return null; 
    });

async function getPool() {
    let pool = await poolPromise;
    if (!pool || !pool.connected) {
        console.log('Database pool is null or disconnected. Attempting to reconnect...');
        try {
            pool = await new sql.ConnectionPool(config).connect();
            return pool;
        } catch (err) {
            console.error('Reconnection failed:', err.message);
            throw err;
        }
    }
    return pool;
}

module.exports = {
    sql, getPool
};
