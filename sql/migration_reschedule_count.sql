-- Add reschedule_count column to appointments table
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;

-- Add max_reschedules constant (optional - can be hardcoded in app)
COMMENT ON COLUMN appointments.reschedule_count IS 'Number of times this appointment has been rescheduled (max 3)';
