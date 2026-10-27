import argparse
from pathlib import Path

from api.db import Database


def verify_schema(database: Database) -> None:
    missing = database.missing_tables()
    if missing:
        raise RuntimeError(
            f"Database schema is incomplete. Missing tables: {', '.join(missing)}"
        )
    missing_columns = database.missing_columns()
    if missing_columns:
        summary = "; ".join(
            f"{table}: {', '.join(columns)}"
            for table, columns in missing_columns.items()
        )
        raise RuntimeError(f"Database schema has missing columns. {summary}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply or verify the Smart Agriculture database schema."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the seven required tables without changing the database.",
    )
    args = parser.parse_args()

    schema = Path(__file__).resolve().parents[1] / "api" / "schema.sql"
    database = Database.from_environment()
    try:
        if not database.ping():
            raise RuntimeError("The database connection health check failed.")
        if not args.check:
            database.execute_script(schema.read_text(encoding="utf-8"))
        verify_schema(database)
        action = "verified" if args.check else "is up to date"
        print(f"Database schema {action}; all seven required tables are present.")
    finally:
        database.close()


if __name__ == "__main__":
    main()
