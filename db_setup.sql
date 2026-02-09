-- Create MenuItems table
CREATE TABLE IF NOT EXISTS MenuItems (
    Id INT PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(100) NOT NULL,
    Price DECIMAL(10, 2) NOT NULL,
    Description VARCHAR(255),
    Category VARCHAR(50),
    IsAvailable BOOLEAN DEFAULT 1,
    StockQuantity INT DEFAULT 0,
    CustomOptions TEXT
);

-- Create Orders table
CREATE TABLE IF NOT EXISTS Orders (
    Id INT PRIMARY KEY AUTO_INCREMENT,
    OrderDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    Status VARCHAR(20) DEFAULT 'Pending', -- Pending, Completed, Cancelled
    TotalPrice DECIMAL(10, 2) NOT NULL,
    CustomerName VARCHAR(100)
);

-- Create OrderItems table
CREATE TABLE IF NOT EXISTS OrderItems (
    Id INT PRIMARY KEY AUTO_INCREMENT,
    OrderId INT,
    MenuItemId INT,
    Quantity INT NOT NULL,
    Price DECIMAL(10, 2) NOT NULL, -- Price at time of order
    SelectedOptions TEXT,
    CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderId) REFERENCES Orders(Id),
    CONSTRAINT FK_OrderItems_MenuItems FOREIGN KEY (MenuItemId) REFERENCES MenuItems(Id)
);

-- Seed some initial menu items
INSERT IGNORE INTO MenuItems (Name, Price, Category, Description, StockQuantity) VALUES 
('Latté', 28.00, 'Coffee', 'Classic espresso with steamed milk', 50),
('Americano', 22.00, 'Coffee', 'Espresso with hot water', 50),
('Cappuccino', 28.00, 'Coffee', 'Espresso with steamed milk foam', 50),
('Mocha', 32.00, 'Coffee', 'Espresso with chocolate and milk', 50),
('Flat White', 30.00, 'Coffee', 'Double espresso with silky microfoam milk', 50);
