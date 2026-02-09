-- Create MenuItems table
CREATE TABLE MenuItems (
    Id INT PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(100) NOT NULL,
    Price DECIMAL(10, 2) NOT NULL,
    Description VARCHAR(255),
    Category VARCHAR(50),
    IsAvailable BOOLEAN DEFAULT 1,
    StockQuantity INT DEFAULT 0,
    CustomOptions TEXT
);

CREATE INDEX idx_category ON MenuItems (Category);
CREATE INDEX idx_available ON MenuItems (IsAvailable);

-- Create Orders table
CREATE TABLE Orders (
    Id INT PRIMARY KEY AUTO_INCREMENT,
    OrderDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    Status VARCHAR(20) DEFAULT 'Pending', -- Pending, Completed, Cancelled
    TotalPrice DECIMAL(10, 2) NOT NULL,
    CustomerName VARCHAR(100)
);

CREATE INDEX idx_order_date ON Orders (OrderDate);
CREATE INDEX idx_status ON Orders (Status);

-- Create OrderItems table
CREATE TABLE OrderItems (
    Id INT PRIMARY KEY AUTO_INCREMENT,
    OrderId INT,
    MenuItemId INT,
    Quantity INT NOT NULL,
    Price DECIMAL(10, 2) NOT NULL, -- Price at time of order
    SelectedOptions TEXT,
    CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderId) REFERENCES Orders(Id),
    CONSTRAINT FK_OrderItems_MenuItems FOREIGN KEY (MenuItemId) REFERENCES MenuItems(Id)
);

-- Create SystemSettings table
CREATE TABLE SystemSettings (
    SettingKey VARCHAR(50) PRIMARY KEY,
    SettingValue TEXT,
    IsEnabled BOOLEAN DEFAULT 1
);

-- Seed some initial menu items
INSERT INTO MenuItems (Name, Price, Category, Description, StockQuantity) VALUES 
('Latté', 28.00, 'Coffee', 'Classic espresso with steamed milk', 50),
('Americano', 22.00, 'Coffee', 'Espresso with hot water', 50),
('Cappuccino', 28.00, 'Coffee', 'Espresso with steamed milk foam', 50),
('Mocha', 32.00, 'Coffee', 'Espresso with chocolate and milk', 50),
('Flat White', 30.00, 'Coffee', 'Double espresso with silky microfoam milk', 50);

-- Seed system settings
INSERT INTO SystemSettings (SettingKey, SettingValue, IsEnabled) VALUES 
('extra_tip', '', 0),
('redirect_url', '', 0),
('refresh_interval', '30', 1),
('business_sessions_enabled', '1', 0),
('business_sessions_list', '[]', 1);
