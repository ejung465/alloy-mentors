-- SUPABASE SCHEMA: Announcements & Emergency Notifications

-- 1. Create Urgency Enum
DO $$ BEGIN
    CREATE TYPE announcement_urgency AS ENUM ('info', 'warning', 'emergency');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create Announcements Table
CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  urgency announcement_urgency DEFAULT 'info' NOT NULL,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. Enable RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Allow ALL authenticated users to SELECT (read)
CREATE POLICY "Allow all authenticated to select announcements" 
ON announcements FOR SELECT 
TO authenticated 
USING (true);

-- Allow ONLY users with 'admin' role in 'users' table to INSERT or UPDATE
CREATE POLICY "Allow only admins to insert announcements" 
ON announcements FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() 
    AND users.role = 'admin'
  )
);

CREATE POLICY "Allow only admins to update announcements" 
ON announcements FOR UPDATE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() 
    AND users.role = 'admin'
  )
);

CREATE POLICY "Allow only admins to delete announcements" 
ON announcements FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() 
    AND users.role = 'admin'
  )
);
