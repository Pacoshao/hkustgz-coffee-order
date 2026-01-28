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
    .then(pool => {
        console.log('Connected to Azure SQL successfully');
        return pool;
    })
    .catch(err => {
        console.error('Database Connection Error:', err.message);
        throw err; // Re-throw so poolPromise rejects
    });

module.exports = {
    sql, poolPromise
};
