-- Local TRAINING database setup (development only).
-- Copy to setup-local.sql, replace CHANGE_ME with the password from backend/.env, then run (cmd.exe):
--   mysql -u root -p -h 127.0.0.1 -P 3309 < database/setup-local.sql
-- Never load real applicant or student data into this database.

CREATE DATABASE IF NOT EXISTS school_site_training
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'school_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';
ALTER USER 'school_app'@'localhost' IDENTIFIED BY 'CHANGE_ME';

-- Locally the app user may also run migrations. In production the app user
-- gets data-only rights and a separate migration user changes the schema.
GRANT ALL PRIVILEGES ON school_site_training.* TO 'school_app'@'localhost';
FLUSH PRIVILEGES;
