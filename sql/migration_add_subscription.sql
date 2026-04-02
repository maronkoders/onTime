
-- Add is_active column
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Add subscription_status column
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'trial';

-- Add trial_ends_at column with default 14 days from now
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days');

-- Add subscription_ends_at column
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP;

-- Update existing rows to have trial status
UPDATE tenants SET is_active = TRUE WHERE is_active IS NULL;
UPDATE tenants SET subscription_status = 'trial' WHERE subscription_status IS NULL;
UPDATE tenants SET trial_ends_at = (NOW() + INTERVAL '14 days') WHERE trial_ends_at IS NULL;
