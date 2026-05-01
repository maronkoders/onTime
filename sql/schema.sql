-- OnTime Salon Booking System - Database Schema

CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    location TEXT,
    owner_phone VARCHAR(20) UNIQUE NOT NULL,
    booking_code VARCHAR(16) UNIQUE NOT NULL,
    working_hours JSONB NOT NULL DEFAULT '{
        "monday": "09:00-17:00",
        "tuesday": "09:00-17:00",
        "wednesday": "09:00-17:00",
        "thursday": "09:00-17:00",
        "friday": "09:00-17:00",
        "saturday": "09:00-17:00",
        "sunday": "closed"
    }',
    is_active BOOLEAN DEFAULT TRUE,
    subscription_status VARCHAR(20) DEFAULT 'trial',
    trial_ends_at TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),
    subscription_ends_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    client_phone VARCHAR(20) NOT NULL,
    service_id INTEGER REFERENCES services(id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'confirmed',
    created_at TIMESTAMP DEFAULT NOW()
);

-- System settings table
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default settings
INSERT INTO system_settings (key, value) VALUES
    ('trial_period_days', '14'),
    ('monthly_price_usd', '5'),
 ('quarterly_price_usd', '12'),
    ('biannual_price_usd', '22'),
    ('ecocash_number', '0775635191'),
    ('innbucks_number', '0775635191'),
    ('payment_recipient', 'Brian H Thomas'),
    ('support_contact', '0775635191')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON appointments(tenant_id, start_time);
CREATE INDEX IF NOT EXISTS idx_tenants_booking_code ON tenants(booking_code);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);
