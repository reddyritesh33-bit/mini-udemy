-- For databases created from an older schema.sql. Safe to run more than once; keeps all data.
-- Trigger 1 now reads the owner's row FOR SHARE, so it waits for an admin's role change
-- in progress (which locks the row FOR UPDATE) and then sees the new role.
CREATE OR REPLACE FUNCTION check_course_instructor() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT role FROM users WHERE user_id = NEW.instructor_id FOR SHARE) IS DISTINCT FROM 'instructor' THEN
    RAISE EXCEPTION 'Course owner must have the instructor role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
