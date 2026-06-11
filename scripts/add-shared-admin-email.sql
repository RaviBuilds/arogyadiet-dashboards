-- Add shared_admin_email column to system_settings
ALTER TABLE system_settings 
ADD COLUMN IF NOT EXISTS shared_admin_email TEXT DEFAULT 'arogya664@gmail.com';

-- Set the current value for the global row
UPDATE system_settings 
SET shared_admin_email = 'arogya664@gmail.com' 
WHERE id = 'global' AND shared_admin_email IS NULL;
