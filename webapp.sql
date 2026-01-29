USE db;
CREATE USER [hkustgz-coffee-order] FROM EXTERNAL PROVIDER;
ALTER ROLE db_owner ADD MEMBER [hkustgz-coffee-order];
