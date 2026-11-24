CREATE TABLE schedule_runs (
  slot text PRIMARY KEY, attempts integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  finished boolean NOT NULL DEFAULT false
);
CREATE TABLE funds (
  code char(6) PRIMARY KEY, name text, category text, share_class text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
