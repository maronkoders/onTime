-- Create subscription_fees table for managing subscription pricing
CREATE TABLE IF NOT EXISTS subscription_fees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    duration_days INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default subscription plans
INSERT INTO subscription_fees (name, duration_days, price, description) VALUES
    ('Monthly', 30, 50.00, 'Standard monthly subscription'),
    ('Quarterly', 90, 135.00, '3 months subscription (10% discount)'),
    ('Semi-Annual', 180, 240.00, '6 months subscription (20% discount)'),
    ('Annual', 365, 420.00, '12 months subscription (30% discount)')
ON CONFLICT DO NOTHING;
