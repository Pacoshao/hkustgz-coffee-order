const express = require('express');
const cors = require('cors');
const path = require('path');
const { sql, getPool } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Comprehensive Database Initialization
async function initializeDatabase() {
    try {
        const pool = await getPool();
        if (!pool) return;
        
        console.log('Checking and initializing database schema...');

        // 1. Create MenuItems table
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MenuItems')
            BEGIN
                CREATE TABLE MenuItems (
                    Id INT PRIMARY KEY IDENTITY(1,1),
                    Name NVARCHAR(100) NOT NULL,
                    Price DECIMAL(10, 2) NOT NULL,
                    Description NVARCHAR(255),
                    Category NVARCHAR(50),
                    IsAvailable BIT DEFAULT 1
                );
                
                -- Seed initial menu items
                INSERT INTO MenuItems (Name, Price, Category, Description) VALUES 
                (N'Latté', 28.00, N'Coffee', N'Classic espresso with steamed milk'),
                (N'Americano', 22.00, N'Coffee', N'Espresso with hot water'),
                (N'Cappuccino', 28.00, N'Coffee', N'Espresso with steamed milk foam'),
                (N'Mocha', 32.00, N'Coffee', N'Espresso with chocolate and milk'),
                (N'Flat White', 30.00, N'Coffee', N'Double espresso with silky microfoam milk');
            END
        `);

        // 2. Create Orders table
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
            BEGIN
                CREATE TABLE Orders (
                    Id INT PRIMARY KEY IDENTITY(1,1),
                    OrderDate DATETIME DEFAULT GETDATE(),
                    Status NVARCHAR(20) DEFAULT 'Pending',
                    TotalPrice DECIMAL(10, 2) NOT NULL,
                    CustomerName NVARCHAR(100)
                );
            END
        `);

        // 3. Create OrderItems table
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderItems')
            BEGIN
                CREATE TABLE OrderItems (
                    Id INT PRIMARY KEY IDENTITY(1,1),
                    OrderId INT FOREIGN KEY REFERENCES Orders(Id),
                    MenuItemId INT FOREIGN KEY REFERENCES MenuItems(Id),
                    Quantity INT NOT NULL,
                    Price DECIMAL(10, 2) NOT NULL
                );
            END
        `);

        // 4. Create SystemSettings table
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SystemSettings')
            BEGIN
                CREATE TABLE SystemSettings (
                    SettingKey NVARCHAR(50) PRIMARY KEY,
                    SettingValue NVARCHAR(MAX),
                    IsEnabled BIT DEFAULT 1
                );
            END
            
            -- Ensure default settings exist
            IF NOT EXISTS (SELECT 1 FROM SystemSettings WHERE SettingKey = 'extra_tip')
                INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('extra_tip', '', 0);
            IF NOT EXISTS (SELECT 1 FROM SystemSettings WHERE SettingKey = 'redirect_url')
                INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('redirect_url', '', 0);
        `);

        console.log('Database initialization completed.');
    } catch (err) {
        console.error('Error during database initialization:', err);
    }
}
initializeDatabase();

// Admin Authentication Middleware
const adminAuth = (req, res, next) => {
    const password = req.headers['x-admin-password'];
    if (password === process.env.ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).send('Unauthorized: Invalid Password');
    }
};

// API: Get Menu Items (Public)
app.get('/api/menu', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM MenuItems WHERE IsAvailable = 1');
        res.json(result.recordset);
    } catch (err) {
        console.error('API Error /api/menu:', err);
        res.status(500).json({ error: err.message || 'Unknown database error' });
    }
});

// API: Place an Order
app.post('/api/orders', async (req, res) => {
    const { code, items, totalPrice } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            const orderResult = await request
                .input('code', sql.NVarChar, code)
                .input('totalPrice', sql.Decimal(10, 2), totalPrice)
                .query('INSERT INTO Orders (CustomerName, TotalPrice, Status) OUTPUT INSERTED.Id VALUES (@code, @totalPrice, \'Pending\')');

            const orderId = orderResult.recordset[0].Id;

            for (const item of items) {
                const itemRequest = new sql.Request(transaction);
                await itemRequest
                    .input('orderId', sql.Int, orderId)
                    .input('menuItemId', sql.Int, item.id)
                    .input('quantity', sql.Int, item.quantity)
                    .input('price', sql.Decimal(10, 2), item.price)
                    .query('INSERT INTO OrderItems (OrderId, MenuItemId, Quantity, Price) VALUES (@orderId, @menuItemId, @quantity, @price)');
            }

            await transaction.commit();
            res.status(201).json({ orderId });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: Get all orders (Management) - Protected
app.get('/api/orders', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT o.Id, o.CustomerName, o.OrderDate, o.Status, o.TotalPrice,
            (SELECT String_Agg(mi.Name + ' x' + Cast(oi.Quantity as varchar), ', ') 
             FROM OrderItems oi 
             JOIN MenuItems mi ON oi.MenuItemId = mi.Id 
             WHERE oi.OrderId = o.Id) as ItemSummary
            FROM Orders o
            ORDER BY o.OrderDate DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: Complete/Cancel an Order - Protected
app.put('/api/orders/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .input('status', sql.NVarChar, status)
            .query('UPDATE Orders SET Status = @status WHERE Id = @id');
        res.send('Order status updated');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: Export Orders to CSV - Protected
app.get('/api/admin/orders/export', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT o.Id, o.OrderDate, o.CustomerName, o.Status, o.TotalPrice,
            (SELECT String_Agg(mi.Name + ' x' + Cast(oi.Quantity as varchar), '; ') 
             FROM OrderItems oi 
             JOIN MenuItems mi ON oi.MenuItemId = mi.Id 
             WHERE oi.OrderId = o.Id) as Items
            FROM Orders o
            ORDER BY o.OrderDate DESC
        `);
        
        let csv = 'ID,Date,Code,Items,Total,Status\n';
        result.recordset.forEach(row => {
            csv += `${row.Id},${row.OrderDate.toISOString()},"${row.CustomerName}","${row.Items}",${row.TotalPrice},${row.Status}\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: Clear All Orders - Protected
app.delete('/api/admin/orders', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await transaction.request().query('DELETE FROM OrderItems');
            await transaction.request().query('DELETE FROM Orders');
            await transaction.commit();
            res.send('All orders cleared');
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: User Cancel their own Order
app.post('/api/orders/:id/cancel', async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('UPDATE Orders SET Status = \'Cancelled\' WHERE Id = @id AND Status = \'Pending\'');
        
        if (result.rowsAffected[0] > 0) {
            res.send('Order cancelled');
        } else {
            res.status(400).send('Order cannot be cancelled (might not be pending)');
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: Public query orders by code
app.get('/api/public/orders', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('code', sql.NVarChar, code)
            .query(`
                SELECT o.Id, o.OrderDate, o.Status, o.TotalPrice,
                (SELECT String_Agg(mi.Name + ' x' + Cast(oi.Quantity as varchar), ', ') 
                 FROM OrderItems oi 
                 JOIN MenuItems mi ON oi.MenuItemId = mi.Id 
                 WHERE oi.OrderId = o.Id) as ItemSummary
                FROM Orders o
                WHERE o.CustomerName = @code
                ORDER BY o.OrderDate DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/** Menu Management (Admin Only) **/

// Get All Menu Items (Admin Only)
app.get('/api/admin/menu', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM MenuItems');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Add Menu Item
app.post('/api/admin/menu', adminAuth, async (req, res) => {
    const { name, price, description, category } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10, 2), price)
            .input('description', sql.NVarChar, description)
            .input('category', sql.NVarChar, category)
            .query('INSERT INTO MenuItems (Name, Price, Description, Category) VALUES (@name, @price, @description, @category)');
        res.status(201).send('Item added');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Update Menu Item
app.put('/api/admin/menu/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { name, price, description, category, isAvailable } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10, 2), price)
            .input('description', sql.NVarChar, description)
            .input('category', sql.NVarChar, category)
            .input('isAvailable', sql.Bit, isAvailable)
            .query('UPDATE MenuItems SET Name = @name, Price = @price, Description = @description, Category = @category, IsAvailable = @isAvailable WHERE Id = @id');
        res.send('Item updated');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Delete Menu Item
app.delete('/api/admin/menu/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM MenuItems WHERE Id = @id');
        res.send('Item deleted');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/** System Settings **/

// Get System Settings (Public)
app.get('/api/settings', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT * FROM SystemSettings');
        res.json(result.recordset);
    } catch (err) {
        console.error('API Error /api/settings:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update System Settings (Admin Only)
app.put('/api/admin/settings', adminAuth, async (req, res) => {
    const settings = req.body; // Expecting array of { SettingKey, SettingValue, IsEnabled }
    try {
        const pool = await getPool();
        for (const s of settings) {
            await pool.request()
                .input('key', sql.NVarChar, s.SettingKey)
                .input('value', sql.NVarChar, s.SettingValue)
                .input('enabled', sql.Bit, s.IsEnabled)
                .query(`
                    IF EXISTS (SELECT 1 FROM SystemSettings WHERE SettingKey = @key)
                    BEGIN
                        UPDATE SystemSettings SET SettingValue = @value, IsEnabled = @enabled WHERE SettingKey = @key
                    END
                    ELSE
                    BEGIN
                        INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES (@key, @value, @enabled)
                    END
                `);
        }
        res.send('Settings updated');
    } catch (err) {
        console.error('API Error /api/admin/settings:', err);
        res.status(500).send(err.message);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
