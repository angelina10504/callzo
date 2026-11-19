"""Rebuild call and usage projections from the processed raw ledger."""
import argparse
import json

from psycopg import sql
from psycopg.rows import dict_row

from app.database import connect_db
from app.events import CallEvent
from app.metering import apply_event


def read_rows(connection, table, keys):
    with connection.cursor(row_factory=dict_row) as cursor:
        rows = cursor.execute(sql.SQL("SELECT * FROM {}").format(table))
        return {tuple(row[k] for k in keys): row for row in rows}


def compare_table(connection, namespace, name, keys, apply):
    live = sql.Identifier(namespace, name)
    stored = read_rows(connection, live, keys)
    expected = read_rows(connection, sql.Identifier("pg_temp", name), keys)
    where = sql.SQL(" AND ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in keys)
    differences = 0
    for key in sorted(stored.keys() | expected.keys()):
        old, new = stored.get(key), expected.get(key)
        if name == "monthly_usage" and old and new:
            if (new["cap_crossed_call_id"] is not None
                    and new["cap_crossed_call_id"] == old["cap_crossed_call_id"]
                    and old["cap_exceeded_at"] is not None):
                new["cap_exceeded_at"] = old["cap_exceeded_at"]
        if old == new:
            continue
        differences += 1
        print(json.dumps({"table": name, "key": key, "stored": old, "expected": new}, default=str))
        if not apply:
            continue
        if new is None:
            connection.execute(sql.SQL("DELETE FROM {} WHERE {}").format(live, where), key)
        elif old is None:
            columns = sql.SQL(", ").join(map(sql.Identifier, new))
            values = sql.SQL(", ").join(sql.Placeholder() for _ in new)
            connection.execute(sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(live, columns, values),
                               tuple(new.values()))
        else:
            fields = [k for k in new if k not in keys and new[k] != old[k]]
            assignments = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in fields)
            connection.execute(sql.SQL("UPDATE {} SET {} WHERE {}").format(live, assignments, where),
                               tuple(new[k] for k in fields) + key)
    return differences


def reconcile(connection, apply=False):
    # Acquire locks in the same order as event processing. Ordinary reads can continue.
    connection.execute("LOCK TABLE webhook_events IN EXCLUSIVE MODE")
    connection.execute("LOCK TABLE calls, monthly_usage IN SHARE ROW EXCLUSIVE MODE")
    namespace, = connection.execute("SELECT current_schema()").fetchone()
    tables = (("calls", ("call_id",)), ("monthly_usage", ("account_id", "month")))
    for name, _ in tables:
        connection.execute(sql.SQL("CREATE TEMP TABLE {} (LIKE {} INCLUDING ALL) ON COMMIT DROP").format(
            sql.Identifier(name), sql.Identifier(namespace, name)))
    # Temporary tables shadow the live names for apply_event on this connection only.
    processed = connection.execute(
        """SELECT raw_body, processed_at FROM webhook_events WHERE status='processed'
           ORDER BY processed_at, received_at, event_id"""
    )
    for body, processed_at in processed:
        apply_event(connection, CallEvent.model_validate_json(body), replay_time=processed_at)
    count = sum(compare_table(connection, namespace, name, keys, apply) for name, keys in tables)
    connection.execute("DROP TABLE pg_temp.calls, pg_temp.monthly_usage")
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Repair differing derived rows")
    args = parser.parse_args()
    with connect_db() as connection:
        count = reconcile(connection, args.apply)
    print(f"{count} differing rows" + (" repaired" if args.apply else ""))


if __name__ == "__main__":
    main()
