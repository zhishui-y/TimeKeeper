CREATE TABLE app_access_recovery (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    question TEXT NOT NULL CHECK (length(trim(question)) BETWEEN 2 AND 100),
    answer_verifier TEXT NOT NULL CHECK (length(trim(answer_verifier)) > 0),
    updated_at TEXT NOT NULL
);
