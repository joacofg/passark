import os

os.environ.setdefault("PASSARK_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://passark:change-me@postgres:5432/passark")
