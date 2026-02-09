const express = require('express');
const cors = require('cors');
const path = require('path');
const { getPool } = require('./db');

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

        // Step 1: Initialize all tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS MenuItems (
                Id INT PRIMARY KEY AUTO_INCREMENT,
                Name VARCHAR(100) NOT NULL,
                Price DECIMAL(10, 2) NOT NULL,
                Description VARCHAR(255),
                Category VARCHAR(50),
                IsAvailable BOOLEAN DEFAULT 1,
                StockQuantity INT DEFAULT 0,
                CustomOptions TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS Orders (
                Id INT PRIMARY KEY AUTO_INCREMENT,
                OrderDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                Status VARCHAR(20) DEFAULT 'Pending',
                TotalPrice DECIMAL(10, 2) NOT NULL,
                CustomerName VARCHAR(100)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS OrderItems (
                Id INT PRIMARY KEY AUTO_INCREMENT,
                OrderId INT,
                MenuItemId INT,
                Quantity INT NOT NULL,
                Price DECIMAL(10, 2) NOT NULL,
                SelectedOptions TEXT,
                CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderId) REFERENCES Orders(Id),
                CONSTRAINT FK_OrderItems_MenuItems FOREIGN KEY (MenuItemId) REFERENCES MenuItems(Id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS SystemSettings (
                SettingKey VARCHAR(50) PRIMARY KEY,
                SettingValue TEXT,
                IsEnabled BOOLEAN DEFAULT 1
            )
        `);

        // Step 2-3: Migrations and Seed initial data
        const [rows] = await pool.query('SELECT COUNT(*) as count FROM MenuItems');
        if (rows[0].count === 0) {
            await pool.query(`
                INSERT INTO MenuItems (Name, Price, Category, Description, StockQuantity) VALUES 
                ('Latté', 28.00, 'Coffee', 'Classic espresso with steamed milk', 50),
                ('Americano', 22.00, 'Coffee', 'Espresso with hot water', 50),
                ('Cappuccino', 28.00, 'Coffee', 'Espresso with steamed milk foam', 50),
                ('Mocha', 32.00, 'Coffee', 'Espresso with chocolate and milk', 50),
                ('Flat White', 30.00, 'Coffee', 'Double espresso with silky microfoam milk', 50)
            `);
        }
        
        await pool.query("INSERT IGNORE INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('extra_tip', '', 0)");
        await pool.query("INSERT IGNORE INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('redirect_url', '', 0)");
        await pool.query("INSERT IGNORE INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('refresh_interval', '30', 1)");
        await pool.query("INSERT IGNORE INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('business_sessions_enabled', '1', 0)");
        await pool.query("INSERT IGNORE INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES ('business_sessions_list', '[]', 1)");

        await pool.query('UPDATE MenuItems SET StockQuantity = 0 WHERE StockQuantity IS NULL');

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
        const [rows] = await pool.query('SELECT * FROM MenuItems WHERE IsAvailable = 1');
        res.json(rows);
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

        // Check Business Status
        const [settingsRows] = await pool.query("SELECT SettingKey, SettingValue, IsEnabled FROM SystemSettings WHERE SettingKey LIKE 'business_%'");
        const settings = {};
        settingsRows.forEach(s => settings[s.SettingKey] = s);

        const now = new Date();
        let isClosed = false;
        let reason = "当前不在营业时段内。";

        // Check Unified Business Sessions (Specific Date/Time ranges)
        if (settings['business_sessions_enabled']?.IsEnabled) {
            let sessions = [];
            try {
                sessions = JSON.parse(settings['business_sessions_list']?.SettingValue || '[]');
            } catch(e) { sessions = []; }

            const isOpenSession = sessions.some(s => {
                if (!s.start || !s.end) return false;
                const start = new Date(s.start + ":00+08:00");
                const end = new Date(s.end + ":00+08:00");
                return now >= start && now <= end;
            });

            if (!isOpenSession) isClosed = true;
        }

        if (isClosed) {
            return res.status(403).send(reason);
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // 1. Pre-check all items stock
            for (const item of items) {
                const [stockCheckResult] = await connection.execute('SELECT StockQuantity, Name FROM MenuItems WHERE Id = ?', [item.id]);
                
                const dbItem = stockCheckResult[0];
                if (!dbItem || dbItem.StockQuantity < item.quantity) {
                    throw new Error(`库存不足: ${dbItem ? dbItem.Name : '未知商品'} (剩余: ${dbItem ? dbItem.StockQuantity : 0})`);
                }
            }

            // 2. Generate Automatic Order Number (C001 format)
            const chinaTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000));
            const y = chinaTime.getFullYear(), m = chinaTime.getMonth(), d = chinaTime.getDate();
            const todayStart = new Date(Date.UTC(y, m, d, 0, 0, 0) - (8 * 3600000));
            
            const [countResult] = await connection.execute("SELECT COUNT(*) as count FROM Orders WHERE OrderDate >= ? AND CustomerName LIKE 'C%'", [todayStart]);
            const orderCount = countResult[0].count + 1;
            const orderNumber = `C${orderCount.toString().padStart(3, '0')}`;

            // 3. Create the Order
            const [orderResult] = await connection.execute('INSERT INTO Orders (CustomerName, TotalPrice, Status) VALUES (?, ?, ?)', [orderNumber, totalPrice, 'Pending']);

            const orderId = orderResult.insertId;

            // 4. Process each item: Insert and Deduct Stock Atomically
            for (const item of items) {
                // Atomically deduct stock and check result
                const [updateStockResult] = await connection.execute('UPDATE MenuItems SET StockQuantity = StockQuantity - ? WHERE Id = ? AND StockQuantity >= ?', [item.quantity, item.id, item.quantity]);
                
                if (updateStockResult.affectedRows === 0) {
                    throw new Error(`下单失败: 商品库存已被抢光或不存在`);
                }

                // Insert OrderItem
                await connection.execute('INSERT INTO OrderItems (OrderId, MenuItemId, Quantity, Price, SelectedOptions) VALUES (?, ?, ?, ?, ?)', [orderId, item.id, item.quantity, item.price, item.selectedOptions || '']);
            }

            await connection.commit();
            res.status(201).json({ orderId, orderNumber });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        res.status(400).send(err.message);
    }
});

// API: Get all orders (Management) - Protected
app.get('/api/orders', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const [rows] = await pool.query(`
            SELECT o.Id, o.CustomerName, o.OrderDate, o.Status, o.TotalPrice,
            (SELECT GROUP_CONCAT(CONCAT(mi.Name, 
                CASE WHEN IFNULL(oi.SelectedOptions, '') = '' THEN '' ELSE CONCAT(' (', oi.SelectedOptions, ')') END,
                ' x', oi.Quantity) SEPARATOR ', ')
             FROM OrderItems oi 
             JOIN MenuItems mi ON oi.MenuItemId = mi.Id 
             WHERE oi.OrderId = o.Id) as ItemSummary
            FROM Orders o
            ORDER BY o.OrderDate DESC
        `);
        res.json(rows);
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
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            // Get current status and items if we are cancelling
            const [currentOrder] = await connection.execute('SELECT Status FROM Orders WHERE Id = ?', [id]);
            const oldStatus = currentOrder[0]?.Status;

            await connection.execute('UPDATE Orders SET Status = ? WHERE Id = ?', [status, id]);
            
            // If transition to Cancelled from something else, return stock
            if (status === 'Cancelled' && oldStatus !== 'Cancelled') {
                const [items] = await connection.execute('SELECT MenuItemId, Quantity FROM OrderItems WHERE OrderId = ?', [id]);
                for (const item of items) {
                    await connection.execute('UPDATE MenuItems SET StockQuantity = StockQuantity + ? WHERE Id = ?', [item.Quantity, item.MenuItemId]);
                }
            }

            await connection.commit();
            res.send('Order status updated');
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// API: Export Orders to CSV - Protected
app.get('/api/admin/orders/export', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const [rows] = await pool.query(`
            SELECT o.Id, o.OrderDate, o.CustomerName, o.Status, o.TotalPrice,
            (SELECT GROUP_CONCAT(CONCAT(mi.Name, 
                CASE WHEN IFNULL(oi.SelectedOptions, '') = '' THEN '' ELSE CONCAT(' (', oi.SelectedOptions, ')') END,
                ' x', oi.Quantity) SEPARATOR '; ')
             FROM OrderItems oi 
             JOIN MenuItems mi ON oi.MenuItemId = mi.Id 
             WHERE oi.OrderId = o.Id) as Items
            FROM Orders o
            ORDER BY o.OrderDate DESC
        `);
        
        let csv = 'ID,Date,Code,Items,Total,Status\n';
        rows.forEach(row => {
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
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            await connection.execute('DELETE FROM OrderItems');
            await connection.execute('DELETE FROM Orders');
            await connection.commit();
            res.send('All orders cleared');
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
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
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const [result] = await connection.execute('UPDATE Orders SET Status = ? WHERE Id = ? AND Status = ?', ['Cancelled', id, 'Pending']);
            
            if (result.affectedRows > 0) {
                // Return stock
                const [items] = await connection.execute('SELECT MenuItemId, Quantity FROM OrderItems WHERE OrderId = ?', [id]);
                for (const item of items) {
                    await connection.execute('UPDATE MenuItems SET StockQuantity = StockQuantity + ? WHERE Id = ?', [item.Quantity, item.MenuItemId]);
                }
                await connection.commit();
                res.send('Order cancelled');
            } else {
                await connection.rollback();
                res.status(400).send('Order cannot be cancelled (might not be pending)');
            }
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
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
        const [rows] = await pool.query(`
                SELECT o.Id, o.OrderDate, o.Status, o.TotalPrice,
                (SELECT GROUP_CONCAT(CONCAT(mi.Name, 
                    CASE WHEN IFNULL(oi.SelectedOptions, '') = '' THEN '' ELSE CONCAT(' (', oi.SelectedOptions, ')') END,
                    ' x', oi.Quantity) SEPARATOR ', ')
                 FROM OrderItems oi 
                 JOIN MenuItems mi ON oi.MenuItemId = mi.Id 
                 WHERE oi.OrderId = o.Id) as ItemSummary
                FROM Orders o
                WHERE o.CustomerName = ?
                ORDER BY o.OrderDate DESC
            `, [code]);
        res.json(rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/** Menu Management (Admin Only) **/

// Get All Menu Items (Admin Only)
app.get('/api/admin/menu', adminAuth, async (req, res) => {
    try {
        const pool = await getPool();
        const [rows] = await pool.query('SELECT * FROM MenuItems');
        res.json(rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Add Menu Item
app.post('/api/admin/menu', adminAuth, async (req, res) => {
    const { name, price, description, category, stockQuantity, customOptions } = req.body;
    try {
        const pool = await getPool();
        await pool.execute('INSERT INTO MenuItems (Name, Price, Description, Category, StockQuantity, CustomOptions) VALUES (?, ?, ?, ?, ?, ?)', 
            [name, price, description, category, stockQuantity || 0, customOptions || '']);
        res.status(201).send('Item added');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Update Menu Item
app.put('/api/admin/menu/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { name, price, description, category, isAvailable, stockQuantity, customOptions } = req.body;
    try {
        const pool = await getPool();
        await pool.execute('UPDATE MenuItems SET Name = ?, Price = ?, Description = ?, Category = ?, IsAvailable = ?, StockQuantity = ?, CustomOptions = ? WHERE Id = ?',
            [name, price, description || '', category || 'Coffee', isAvailable ? 1 : 0, stockQuantity, customOptions || '', id]);
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
        await pool.execute('DELETE FROM MenuItems WHERE Id = ?', [id]);
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
        const [rows] = await pool.query('SELECT * FROM SystemSettings');
        res.json(rows);
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
            await pool.execute(`
                INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) 
                VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE SettingValue = VALUES(SettingValue), IsEnabled = VALUES(IsEnabled)
            `, [s.SettingKey, s.SettingValue, s.IsEnabled ? 1 : 0]);
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
