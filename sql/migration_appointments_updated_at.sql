-- Add updated_at column to appointments table
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Create index for updated_at
CREATE INDEX IF NOT EXISTS idx_appointments_updated_at ON appointments(updated_at);
