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
                    IsAvailable BIT DEFAULT 1,
                    StockQuantity INT DEFAULT 0
                );
            END

            -- Seed initial menu items if table is empty
            IF NOT EXISTS (SELECT 1 FROM MenuItems)
            BEGIN
                INSERT INTO MenuItems (Name, Price, Category, Description, StockQuantity) VALUES 
                (N'Latté', 28.00, N'Coffee', N'Classic espresso with steamed milk', 50),
                (N'Americano', 22.00, N'Coffee', N'Espresso with hot water', 50),
                (N'Cappuccino', 28.00, N'Coffee', N'Espresso with steamed milk foam', 50),
                (N'Mocha', 32.00, N'Coffee', N'Espresso with chocolate and milk', 50),
                (N'Flat White', 30.00, N'Coffee', N'Double espresso with silky microfoam milk', 50);
            END
            
            -- Ensure StockQuantity column exists for existing tables
            IF EXISTS (SELECT * FROM sys.tables WHERE name = 'MenuItems')
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'StockQuantity')
                BEGIN
                    ALTER TABLE MenuItems ADD StockQuantity INT DEFAULT 0;
                    UPDATE MenuItems SET StockQuantity = 50 WHERE StockQuantity IS NULL OR StockQuantity = 0;
                END
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
                INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('redirect_url', '', 0);            IF NOT EXISTS (SELECT 1 FROM SystemSettings WHERE SettingKey = 'refresh_interval')
                INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('refresh_interval', '30', 1);        `);

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

            // 1. Pre-check all items stock (Quick look before starting DB inserts)
            for (const item of items) {
                const stockCheckResult = await request
                    .input(`item_id_chk_${item.id}`, sql.Int, item.id)
                    .query(`SELECT StockQuantity, Name FROM MenuItems WHERE Id = @item_id_chk_${item.id}`);
                
                const dbItem = stockCheckResult.recordset[0];
                if (!dbItem || dbItem.StockQuantity < item.quantity) {
                    throw new Error(`库存不足: ${dbItem ? dbItem.Name : '未知商品'} (剩余: ${dbItem ? dbItem.StockQuantity : 0})`);
                }
            }

            // 2. Create the Order
            const orderResult = await request
                .input('code', sql.NVarChar, code)
                .input('totalPrice', sql.Decimal(10, 2), totalPrice)
                .query('INSERT INTO Orders (CustomerName, TotalPrice, Status) OUTPUT INSERTED.Id VALUES (@code, @totalPrice, \'Pending\')');

            const orderId = orderResult.recordset[0].Id;

            // 3. Process each item: Insert and Deduct Stock Atomically
            for (const item of items) {
                const itemRequest = new sql.Request(transaction);
                
                // Atomically deduct stock and check result
                const updateStockResult = await itemRequest
                    .input('dec_id', sql.Int, item.id)
                    .input('dec_qty', sql.Int, item.quantity)
                    .query('UPDATE MenuItems SET StockQuantity = StockQuantity - @dec_qty WHERE Id = @dec_id AND StockQuantity >= @dec_qty');
                
                if (updateStockResult.rowsAffected[0] === 0) {
                    // This happens if someone else took the stock between step 1 and here
                    throw new Error(`下单失败: 商品库存已被抢光或不存在`);
                }

                // Insert OrderItem
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
        res.status(400).send(err.message);
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
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const request = new sql.Request(transaction);

            // Get current status and items if we are cancelling
            const currentOrder = await request.input('oid', sql.Int, id).query('SELECT Status FROM Orders WHERE Id = @oid');
            const oldStatus = currentOrder.recordset[0]?.Status;

            await request
                .input('id', sql.Int, id)
                .input('status', sql.NVarChar, status)
                .query('UPDATE Orders SET Status = @status WHERE Id = @id');
            
            // If transition to Cancelled from something else, return stock
            if (status === 'Cancelled' && oldStatus !== 'Cancelled') {
                const items = await request.query(`SELECT MenuItemId, Quantity FROM OrderItems WHERE OrderId = ${id}`);
                for (const item of items.recordset) {
                    await request.query(`UPDATE MenuItems SET StockQuantity = StockQuantity + ${item.Quantity} WHERE Id = ${item.MenuItemId}`);
                }
            }

            await transaction.commit();
            res.send('Order status updated');
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
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
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const request = new sql.Request(transaction);
            const result = await request
                .input('id', sql.Int, id)
                .query('UPDATE Orders SET Status = \'Cancelled\' WHERE Id = @id AND Status = \'Pending\'');
            
            if (result.rowsAffected[0] > 0) {
                // Return stock
                const items = await request.query(`SELECT MenuItemId, Quantity FROM OrderItems WHERE OrderId = ${id}`);
                for (const item of items.recordset) {
                    await request.query(`UPDATE MenuItems SET StockQuantity = StockQuantity + ${item.Quantity} WHERE Id = ${item.MenuItemId}`);
                }
                await transaction.commit();
                res.send('Order cancelled');
            } else {
                await transaction.rollback();
                res.status(400).send('Order cannot be cancelled (might not be pending)');
            }
        } catch (err) {
            await transaction.rollback();
            throw err;
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
    const { name, price, description, category, stockQuantity } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10, 2), price)
            .input('description', sql.NVarChar, description)
            .input('category', sql.NVarChar, category)
            .input('stockQuantity', sql.Int, stockQuantity || 0)
            .query('INSERT INTO MenuItems (Name, Price, Description, Category, StockQuantity) VALUES (@name, @price, @description, @category, @stockQuantity)');
        res.status(201).send('Item added');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Update Menu Item
app.put('/api/admin/menu/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { name, price, description, category, isAvailable, stockQuantity } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10, 2), price)
            .input('description', sql.NVarChar, description)
            .input('category', sql.NVarChar, category)
            .input('isAvailable', sql.Bit, isAvailable)
            .input('stockQuantity', sql.Int, stockQuantity)
            .query('UPDATE MenuItems SET Name = @name, Price = @price, Description = @description, Category = @category, IsAvailable = @isAvailable, StockQuantity = @stockQuantity WHERE Id = @id');
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
