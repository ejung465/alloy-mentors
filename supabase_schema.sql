-- Custom Types
CREATE TYPE user_role AS ENUM ('admin', 'mentor', 'student');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');

-- 1. Organizations Table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    access_code TEXT UNIQUE NOT NULL,
    theme_image_url TEXT,
    subscription_status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users Profile Table (Extends Supabase Auth)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    school TEXT,
    birthday DATE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    location TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Assignments Table (Links Mentor to Student)
CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(mentor_id, student_id)
);

-- 4. Hours Logs Table
-- Mentors log hours towards students/events
CREATE TABLE hours_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    hours NUMERIC(5,2) NOT NULL,
    date_worked DATE NOT NULL,
    description TEXT,
    status approval_status DEFAULT 'pending',
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Sessions Table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) Policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hours_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Note: RLS logic typically ensures users only modify/select data where organization_id matches their own auth.uid()'s organization_id.
-- Wait until user runs this in Supabase Dashboard SQL editor.
