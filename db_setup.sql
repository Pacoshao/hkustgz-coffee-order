-- Create MenuItems table
CREATE TABLE MenuItems (
    Id INT PRIMARY KEY IDENTITY(1,1),
    Name NVARCHAR(100) NOT NULL,
    Price DECIMAL(10, 2) NOT NULL,
    Description NVARCHAR(255),
    Category NVARCHAR(50),
    IsAvailable BIT DEFAULT 1
);

-- Create Orders table
CREATE TABLE Orders (
    Id INT PRIMARY KEY IDENTITY(1,1),
    OrderDate DATETIME DEFAULT GETDATE(),
    Status NVARCHAR(20) DEFAULT 'Pending', -- Pending, Completed, Cancelled
    TotalPrice DECIMAL(10, 2) NOT NULL,
    CustomerName NVARCHAR(100)
);

-- Create OrderItems table
CREATE TABLE OrderItems (
    Id INT PRIMARY KEY IDENTITY(1,1),
    OrderId INT FOREIGN KEY REFERENCES Orders(Id),
    MenuItemId INT FOREIGN KEY REFERENCES MenuItems(Id),
    Quantity INT NOT NULL,
    Price DECIMAL(10, 2) NOT NULL -- Price at time of order
);

-- Seed some initial menu items
INSERT INTO MenuItems (Name, Price, Category, Description) VALUES 
('Latté', 28.00, 'Coffee', 'Classic espresso with steamed milk'),
('Americano', 22.00, 'Coffee', 'Espresso with hot water'),
('Cappuccino', 28.00, 'Coffee', 'Espresso with steamed milk foam'),
('Mocha', 32.00, 'Coffee', 'Espresso with chocolate and milk'),
('Flat White', 30.00, 'Coffee', 'Double espresso with silky microfoam milk');
GO
