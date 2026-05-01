-- Migration: Add system_settings table for global configuration
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default trial period (14 days)
INSERT INTO system_settings (key, value, description) 
VALUES ('trial_period_days', '14', 'Default trial period duration in days for new salon registrations')
ON CONFLICT (key) DO NOTHING;
