const express = require('express');
const cors = require('cors');
const path = require('path');
const { sql, poolPromise } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM MenuItems WHERE IsAvailable = 1');
        res.json(result.recordset);
    } catch (err) {
        console.error('API Error /api/menu:', err);
        res.status(500).json({ error: err.message || 'Unknown database error' });
    }
});

// API: Place an Order
app.post('/api/orders', async (req, res) => {
    const { customerName, items, totalPrice } = req.body;
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            const orderResult = await request
                .input('customerName', sql.NVarChar, customerName)
                .input('totalPrice', sql.Decimal(10, 2), totalPrice)
                .query('INSERT INTO Orders (CustomerName, TotalPrice, Status) OUTPUT INSERTED.Id VALUES (@customerName, @totalPrice, \'Pending\')');

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
        const pool = await poolPromise;
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

// API: Complete an Order - Protected
app.put('/api/orders/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .input('status', sql.NVarChar, status)
            .query('UPDATE Orders SET Status = @status WHERE Id = @id');
        res.send('Order status updated');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/** Menu Management (Admin Only) **/

// Add Menu Item
app.post('/api/admin/menu', adminAuth, async (req, res) => {
    const { name, price, description, category } = req.body;
    try {
        const pool = await poolPromise;
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
        const pool = await poolPromise;
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
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM MenuItems WHERE Id = @id');
        res.send('Item deleted');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
