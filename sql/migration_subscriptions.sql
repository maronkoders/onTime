-- Create subscriptions table for tracking tenant subscription history
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    start_date TIMESTAMP NOT NULL DEFAULT NOW(),
    expiry_date TIMESTAMP NOT NULL,
    subscription_status VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'expired')),
    subscription_fee_id INTEGER REFERENCES subscription_fees(id) ON DELETE SET NULL,
    amount_paid DECIMAL(10,2),
    payment_reference VARCHAR(255),
    last_reminder_sent TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(subscription_status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expiry_date);
