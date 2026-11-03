-- Mini-Udemy PostgreSQL schema (from Appendix A of the Project Report).
-- Load with: psql "$DATABASE_URL" -f schema.sql
DROP VIEW IF EXISTS v_student_progress;
DROP TABLE IF EXISTS reviews, lesson_progress, enrollments, lessons, modules, courses, categories, users CASCADE;
DROP FUNCTION IF EXISTS course_completion_pct(INT, INT), enroll_student(INT, INT), check_course_instructor(),
  check_progress_enrolled(), update_enrollment_status(), check_review_progress() CASCADE;

CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'student'
    CHECK (role IN ('student', 'instructor', 'admin')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  category_id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE courses (
  course_id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL UNIQUE,
  description TEXT,
  instructor_id INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  category_id INT NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  level VARCHAR(20) NOT NULL DEFAULT 'beginner'
    CHECK (level IN ('beginner', 'intermediate', 'advanced'))
);

CREATE TABLE modules (
  module_id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  position INT NOT NULL CHECK (position > 0),
  UNIQUE (course_id, position)
);

CREATE TABLE lessons (
  lesson_id SERIAL PRIMARY KEY,
  module_id INT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  position INT NOT NULL CHECK (position > 0),
  UNIQUE (module_id, position)
);

CREATE TABLE enrollments (
  enrollment_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'dropped')),
  UNIQUE (user_id, course_id)
);

CREATE TABLE lesson_progress (
  progress_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  lesson_id INT NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, lesson_id)
);

CREATE TABLE reviews (
  review_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  UNIQUE (user_id, course_id)
);

-- ALTER demonstration
ALTER TABLE users ADD CONSTRAINT users_email_format
  CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Indexes
CREATE INDEX idx_courses_instructor ON courses(instructor_id);
CREATE INDEX idx_courses_category ON courses(category_id);
CREATE INDEX idx_modules_course ON modules(course_id);
CREATE INDEX idx_lessons_module ON lessons(module_id);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);
CREATE INDEX idx_progress_lesson ON lesson_progress(lesson_id);
CREATE INDEX idx_reviews_course ON reviews(course_id);
CREATE INDEX idx_courses_fts ON courses
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- Functions
CREATE FUNCTION course_completion_pct(p_user INT, p_course INT)
RETURNS NUMERIC AS $$
  SELECT COALESCE(ROUND(100.0 * COUNT(lp.lesson_id) / NULLIF(COUNT(l.lesson_id), 0), 2), 0)
  FROM modules m
  JOIN lessons l ON l.module_id = m.module_id
  LEFT JOIN lesson_progress lp ON lp.lesson_id = l.lesson_id AND lp.user_id = p_user
  WHERE m.course_id = p_course;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION enroll_student(p_user INT, p_course INT)
RETURNS INT AS $$
DECLARE
  v_role TEXT;
  v_id INT;
BEGIN
  SELECT role INTO v_role FROM users WHERE user_id = p_user;
  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Only students can enrol';
  END IF;
  INSERT INTO enrollments (user_id, course_id) VALUES (p_user, p_course)
  ON CONFLICT (user_id, course_id) DO UPDATE
    SET status = CASE WHEN enrollments.status = 'dropped' THEN 'active'
                      ELSE enrollments.status END
  RETURNING enrollment_id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger 1: only instructors can own courses
CREATE FUNCTION check_course_instructor() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT role FROM users WHERE user_id = NEW.instructor_id FOR SHARE) IS DISTINCT FROM 'instructor' THEN
    RAISE EXCEPTION 'Course owner must have the instructor role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_course_instructor
  BEFORE INSERT OR UPDATE OF instructor_id ON courses
  FOR EACH ROW EXECUTE FUNCTION check_course_instructor();

-- Trigger 2: only actively enrolled students can complete a lesson
CREATE FUNCTION check_progress_enrolled() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM lessons l
    JOIN modules m ON m.module_id = l.module_id
    JOIN enrollments e ON e.course_id = m.course_id
    WHERE l.lesson_id = NEW.lesson_id
      AND e.user_id = NEW.user_id
      AND e.status <> 'dropped'
  ) THEN
    RAISE EXCEPTION 'Student is not enrolled in this course';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_progress_enrolled
  BEFORE INSERT ON lesson_progress
  FOR EACH ROW EXECUTE FUNCTION check_progress_enrolled();

-- Trigger 3: enrolment becomes completed at 100% (row lock serialises last-lesson requests)
CREATE FUNCTION update_enrollment_status() RETURNS TRIGGER AS $$
DECLARE
  v_course INT;
BEGIN
  SELECT m.course_id INTO v_course
  FROM lessons l JOIN modules m ON m.module_id = l.module_id
  WHERE l.lesson_id = NEW.lesson_id;

  PERFORM 1 FROM enrollments
  WHERE user_id = NEW.user_id AND course_id = v_course FOR UPDATE;

  IF course_completion_pct(NEW.user_id, v_course) = 100 THEN
    UPDATE enrollments SET status = 'completed'
    WHERE user_id = NEW.user_id AND course_id = v_course;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trg_progress_status
  AFTER INSERT ON lesson_progress
  FOR EACH ROW EXECUTE FUNCTION update_enrollment_status();

-- Trigger 4 (novelty): a review needs at least 50% of the course completed
CREATE FUNCTION check_review_progress() RETURNS TRIGGER AS $$
BEGIN
  IF course_completion_pct(NEW.user_id, NEW.course_id) < 50 THEN
    RAISE EXCEPTION 'Complete at least 50%% of the course before reviewing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_review_progress
  BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION check_review_progress();

-- View
CREATE VIEW v_student_progress AS
SELECT e.user_id, u.full_name, e.course_id, c.title, e.status,
       course_completion_pct(e.user_id, e.course_id) AS completion_pct
FROM enrollments e
JOIN users u ON u.user_id = e.user_id
JOIN courses c ON c.course_id = e.course_id;
