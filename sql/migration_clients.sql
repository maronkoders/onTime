-- Create clients table to store returning client information
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    preferred_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient phone lookups
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(preferred_tenant_id);
