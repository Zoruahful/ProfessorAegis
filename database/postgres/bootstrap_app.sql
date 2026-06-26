-- Run this after PostgreSQL is installed.
-- Replace CHANGE_ME_STRONG_PASSWORD before executing.

CREATE ROLE professor_aegis WITH
  LOGIN
  PASSWORD 'CHANGE_ME_STRONG_PASSWORD';

CREATE DATABASE professor_aegis
  OWNER professor_aegis
  ENCODING 'UTF8';

\connect professor_aegis

GRANT ALL PRIVILEGES ON DATABASE professor_aegis TO professor_aegis;
ALTER SCHEMA public OWNER TO professor_aegis;
GRANT ALL ON SCHEMA public TO professor_aegis;
