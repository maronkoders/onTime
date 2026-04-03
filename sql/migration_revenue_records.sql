-- Create revenue_records table for tracking subscription revenue
CREATE TABLE IF NOT EXISTS revenue_records (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
    subscription_fee_id INTEGER REFERENCES subscription_fees(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    record_date TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient revenue reporting queries
CREATE INDEX IF NOT EXISTS idx_revenue_tenant ON revenue_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenue_subscription ON revenue_records(subscription_id);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue_records(record_date);
CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue_records(created_at);
