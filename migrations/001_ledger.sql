CREATE TABLE ledger_users (
  owner text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE ledger_events (
  owner text NOT NULL REFERENCES ledger_users,
  id text NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id)
);
CREATE INDEX ledger_event_order ON ledger_events(owner,seq);
CREATE TABLE fund_nav_history (
  code char(6) NOT NULL,
  day date NOT NULL,
  nav numeric NOT NULL CHECK(nav>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,day)
);
CREATE TABLE nav_coverage (
  code char(6) NOT NULL, start_day date NOT NULL, end_day date NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,start_day,end_day)
);
CREATE TABLE daily_snapshots (
  owner text NOT NULL REFERENCES ledger_users, day date NOT NULL,
  report jsonb NOT NULL, revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,day)
);
CREATE TABLE previews (
  token uuid PRIMARY KEY, owner text NOT NULL REFERENCES ledger_users,
  revision bigint NOT NULL, operation jsonb NOT NULL, expires timestamptz NOT NULL
);
CREATE TABLE sync_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner text NOT NULL REFERENCES ledger_users, day date NOT NULL,
  status text NOT NULL, code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_by_owner ON sync_logs(owner,updated_at DESC);
