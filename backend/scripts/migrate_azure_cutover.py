"""
Migrate TikunCRM blobs + stored Azure URLs to a new storage account/container.

Reads credentials from backend/.env (never commit that file):

  SOURCE_DATABASE_URL          old Postgres (asyncpg or libpq URL)
  TARGET_DATABASE_URL         new Postgres (defaults to DATABASE_URL)
  OLD_AZURE_STORAGE_CONNECTION_STRING
  AZURE_STORAGE_CONNECTION_STRING          new account
  AZURE_STORAGE_CONTAINER                  new recordings container (or shared)
  AZURE_STORAGE_CONTAINER_STIPS
  AZURE_STORAGE_CONTAINER_WHATSAPP

Usage (from backend/):
  python -m scripts.migrate_azure_cutover              # inventory + copy + rewrite + verify
  python -m scripts.migrate_azure_cutover --inventory
  python -m scripts.migrate_azure_cutover --copy-blobs
  python -m scripts.migrate_azure_cutover --restore-db
  python -m scripts.migrate_azure_cutover --rewrite-urls
  python -m scripts.migrate_azure_cutover --verify
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse, unquote

_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass

import psycopg2
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    generate_blob_sas,
)


OLD_ACCOUNT_HOST = "tikuntechwebimages.blob.core.windows.net"
NEW_ACCOUNT_HOST = "tikuntech.blob.core.windows.net"
OLD_CONTAINERS = ("lead-stips", "call-recordings", "whatsapp-media")

COUNT_SQL = """
SELECT 'users' AS t, COUNT(*)::bigint FROM users
UNION ALL SELECT 'leads', COUNT(*) FROM leads
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'lead_stip_documents', COUNT(*) FROM lead_stip_documents
UNION ALL SELECT 'customer_stip_documents', COUNT(*) FROM customer_stip_documents
UNION ALL SELECT 'stips_categories', COUNT(*) FROM stips_categories
UNION ALL SELECT 'call_logs', COUNT(*) FROM call_logs
UNION ALL SELECT 'call_logs_with_recording', COUNT(*) FROM call_logs
    WHERE recording_url IS NOT NULL AND recording_url <> ''
UNION ALL SELECT 'whatsapp_logs', COUNT(*) FROM whatsapp_logs
UNION ALL SELECT 'sms_logs', COUNT(*) FROM sms_logs
"""


def _fix_conn_str(value: str) -> str:
    if not value:
        return value
    return value.replace("DefaultEndpointsProtocol=DefaultEndpointsProtocol=", "DefaultEndpointsProtocol=")


def _parse_account(conn: str) -> tuple[str, str]:
    parts = dict(p.split("=", 1) for p in conn.split(";") if "=" in p)
    return parts.get("AccountName", ""), parts.get("AccountKey", "")


def _sqlalchemy_to_libpq(url: str) -> str:
    if not url:
        return url
    url = re.sub(r"^postgresql\+[a-z0-9]+://", "postgresql://", url, flags=re.IGNORECASE)
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query, keep_blank_values=True)
        if "ssl" in qs and "sslmode" not in qs:
            qs["sslmode"] = qs.pop("ssl", ["prefer"])
        url = urlunparse(parsed._replace(query=urlencode([(k, v[0]) for k, v in qs.items()])))
    return url


def _psycopg_kwargs(url: str) -> dict[str, Any]:
    pg = urlparse(_sqlalchemy_to_libpq(url))
    qs = parse_qs(pg.query or "")
    sslmode = qs.get("sslmode", ["require"])[0]
    password = unquote(pg.password) if pg.password else None
    return {
        "user": unquote(pg.username) if pg.username else None,
        "password": password,
        "host": pg.hostname,
        "port": pg.port or 5432,
        "database": (pg.path or "/").strip("/") or "postgres",
        "sslmode": sslmode,
        "connect_timeout": 20,
    }


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def load_config() -> dict[str, str]:
    old_blob = _fix_conn_str(_env("OLD_AZURE_STORAGE_CONNECTION_STRING"))
    new_blob = _fix_conn_str(_env("AZURE_STORAGE_CONNECTION_STRING"))
    source_db = _env("SOURCE_DATABASE_URL") or _env("OLD_DATABASE_URL")
    target_db = _env("TARGET_DATABASE_URL") or _env("DATABASE_URL")
    dest_container = _env("AZURE_STORAGE_CONTAINER", "tikuncrm")
    stips = _env("AZURE_STORAGE_CONTAINER_STIPS") or dest_container
    whatsapp = _env("AZURE_STORAGE_CONTAINER_WHATSAPP") or dest_container
    missing = []
    if not old_blob:
        missing.append("OLD_AZURE_STORAGE_CONNECTION_STRING")
    if not new_blob:
        missing.append("AZURE_STORAGE_CONNECTION_STRING")
    if not source_db:
        missing.append("SOURCE_DATABASE_URL")
    if not target_db:
        missing.append("TARGET_DATABASE_URL or DATABASE_URL")
    if missing:
        raise SystemExit("Missing env: " + ", ".join(missing))
    return {
        "old_blob": old_blob,
        "new_blob": new_blob,
        "source_db": source_db,
        "target_db": target_db,
        "recordings_container": dest_container,
        "stips_container": stips,
        "whatsapp_container": whatsapp,
    }


def connect_db(url: str):
    return psycopg2.connect(**_psycopg_kwargs(url))


def table_exists(cur, name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=%s",
        (name,),
    )
    return cur.fetchone() is not None


def db_inventory(label: str, url: str) -> dict[str, int]:
    print(f"\n===== DB {label} =====")
    kw = _psycopg_kwargs(url)
    print(f"host={kw['host']} db={kw['database']} user={kw['user']}")
    counts: dict[str, int] = {}
    try:
        cnx = connect_db(url)
    except Exception as e:
        print(f"CONNECT FAIL: {e}")
        return counts
    cur = cnx.cursor()
    try:
        cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")
        print("public tables:", cur.fetchone()[0])
        if table_exists(cur, "alembic_version"):
            cur.execute("SELECT version_num FROM alembic_version")
            print("alembic_version:", [r[0] for r in cur.fetchall()])
        else:
            print("alembic_version: (missing)")
        if not table_exists(cur, "leads"):
            print("schema looks empty (no leads table)")
            return counts
        cur.execute(COUNT_SQL)
        for t, n in cur.fetchall():
            counts[t] = int(n)
            print(f"  {t}: {n}")

        hosts = Counter()
        if table_exists(cur, "call_logs"):
            cur.execute(
                "SELECT recording_url FROM call_logs "
                "WHERE recording_url ILIKE '%blob.core.windows.net%'"
            )
            for (u,) in cur.fetchall():
                try:
                    hosts[urlparse(u).netloc] += 1
                except Exception:
                    hosts["unparsed"] += 1
            print("  recording hosts:", dict(hosts))

        for table in ("whatsapp_logs", "sms_logs"):
            if not table_exists(cur, table):
                continue
            cur.execute(f"SELECT media_urls FROM {table} WHERE media_urls IS NOT NULL")
            media_hosts = Counter()
            n_urls = 0
            for (urls,) in cur.fetchall():
                items = urls if isinstance(urls, list) else []
                for u in items:
                    if not isinstance(u, str):
                        continue
                    n_urls += 1
                    if "blob.core.windows.net" in u:
                        media_hosts[urlparse(u).netloc] += 1
                    elif "twilio.com" in u:
                        media_hosts["twilio"] += 1
            print(f"  {table} media urls={n_urls} hosts={dict(media_hosts)}")

        if table_exists(cur, "lead_stip_documents"):
            cur.execute("SELECT blob_path FROM lead_stip_documents LIMIT 3")
            print("  lead stip samples:", [r[0] for r in cur.fetchall()])
        if table_exists(cur, "customer_stip_documents"):
            cur.execute("SELECT blob_path FROM customer_stip_documents LIMIT 3")
            print("  customer stip samples:", [r[0] for r in cur.fetchall()])
        return counts
    finally:
        cur.close()
        cnx.close()


def blob_inventory(label: str, conn: str) -> dict[str, int]:
    print(f"\n===== BLOB {label} =====")
    counts: dict[str, int] = {}
    try:
        svc = BlobServiceClient.from_connection_string(conn)
    except Exception as e:
        print(f"BLOB CONNECT FAIL: {e}")
        return counts
    print("account:", svc.account_name)
    containers = list(svc.list_containers())
    print("containers:", [c.name for c in containers] or "(none)")
    for c in containers:
        cc = svc.get_container_client(c.name)
        n = 0
        size = 0
        prefixes: Counter[str] = Counter()
        samples: list[str] = []
        for b in cc.list_blobs():
            n += 1
            size += b.size or 0
            prefixes[b.name.split("/")[0] if "/" in b.name else "(root)"] += 1
            if len(samples) < 3:
                samples.append(b.name)
        counts[c.name] = n
        print(f"  {c.name}: {n} blobs, {size / 1024 / 1024:.1f} MB, prefixes={dict(prefixes.most_common(8))}")
        if samples:
            print(f"    samples: {sample_join(samples)}")
    return counts


def sample_join(items: Iterable[str]) -> str:
    return ", ".join(items)


def ensure_container(svc: BlobServiceClient, name: str, public_blob: bool = False):
    client = svc.get_container_client(name)
    try:
        client.get_container_properties()
    except ResourceNotFoundError:
        print(f"  creating container {name}")
        client.create_container(public_access="blob" if public_blob else None)
    return client


def copy_blobs(cfg: dict[str, str]) -> None:
    print("\n===== COPY BLOBS =====")
    old_svc = BlobServiceClient.from_connection_string(cfg["old_blob"])
    new_svc = BlobServiceClient.from_connection_string(cfg["new_blob"])
    account, key = _parse_account(cfg["old_blob"])
    dest_map = {
        "lead-stips": cfg["stips_container"],
        "whatsapp-media": cfg["whatsapp_container"],
        "call-recordings": cfg["recordings_container"],
    }
    created = set()
    for src_name, dest_name in dest_map.items():
        src = old_svc.get_container_client(src_name)
        try:
            src.get_container_properties()
        except ResourceNotFoundError:
            print(f"  skip missing source container {src_name}")
            continue
        if dest_name not in created:
            ensure_container(new_svc, dest_name, public_blob=(src_name == "whatsapp-media"))
            created.add(dest_name)
        dest = new_svc.get_container_client(dest_name)
        copied = skipped = failed = 0
        print(f"  {src_name} -> {new_svc.account_name}/{dest_name}")
        existing = {b.name for b in dest.list_blobs()}
        names = []
        for blob in src.list_blobs():
            if blob.name in existing:
                skipped += 1
            else:
                names.append(blob.name)

        def _copy_one(blob_name: str) -> str:
            sas = generate_blob_sas(
                account_name=account,
                container_name=src_name,
                blob_name=blob_name,
                account_key=key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc) + timedelta(hours=12),
            )
            source_url = f"https://{account}.blob.core.windows.net/{src_name}/{blob_name}?{sas}"
            dest.get_blob_client(blob_name).start_copy_from_url(source_url)
            return blob_name

        if names:
            workers = 16
            print(f"    copying {len(names)} blobs with {workers} workers ({skipped} already present)")
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(_copy_one, n) for n in names]
                for fut in as_completed(futures):
                    try:
                        fut.result()
                        copied += 1
                    except Exception as e:
                        failed += 1
                        print(f"    FAIL: {e}")
                    if (copied + failed) % 200 == 0 and (copied + failed):
                        print(f"    progress copied={copied} skipped={skipped} failed={failed}")
        expected = skipped + copied
        dest_count = 0
        for i in range(180):
            dest_count = sum(1 for _ in dest.list_blobs())
            if dest_count >= expected or copied == 0:
                break
            if i % 5 == 0:
                print(f"    waiting for copies: dest={dest_count} expected={expected}")
            time.sleep(2)
        print(
            f"    done started={copied} skipped_existing={skipped} failed={failed} "
            f"dest_blobs={dest_count}"
        )


def _run_pg(cmd: list[str], password: str | None, sslmode: str) -> None:
    env = os.environ.copy()
    if password:
        env["PGPASSWORD"] = password
    if sslmode and sslmode != "disable":
        env["PGSSLMODE"] = sslmode
    print(" ", " ".join(cmd[:8]), "...")
    subprocess.run(cmd, env=env, check=True)


def restore_db_if_needed(cfg: dict[str, str], force: bool) -> None:
    print("\n===== DB RESTORE =====")
    src_counts = db_inventory("SOURCE(old)", cfg["source_db"])
    tgt_counts = db_inventory("TARGET(new)", cfg["target_db"])
    src_leads = src_counts.get("leads", 0)
    tgt_leads = tgt_counts.get("leads", 0)
    if not force and src_leads and tgt_leads >= src_leads:
        print("Target already has >= source leads; skipping dump/restore.")
        return
    if not force and tgt_leads > 0:
        print(
            f"Target has {tgt_leads} leads vs source {src_leads}. "
            "Refusing to overwrite. Re-run with --restore-db --force-restore to dump/restore."
        )
        return
    if not src_leads:
        print("Source has no leads; nothing to restore.")
        return

    backups = os.path.join(_backend_dir, "backups")
    os.makedirs(backups, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    dump_path = os.path.join(backups, f"leedscrm_cutover_{stamp}.dump")
    src = _psycopg_kwargs(cfg["source_db"])
    tgt = _psycopg_kwargs(cfg["target_db"])
    print(f"Dumping source to {dump_path}")
    _run_pg(
        [
            "pg_dump",
            "--host", src["host"],
            "--port", str(src["port"]),
            "--username", src["user"],
            "--dbname", src["database"],
            "--no-password",
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--file", dump_path,
        ],
        src["password"],
        src["sslmode"],
    )
    print("Restoring into target (this can take a while)...")
    _run_pg(
        [
            "pg_restore",
            "--host", tgt["host"],
            "--port", str(tgt["port"]),
            "--username", tgt["user"],
            "--dbname", tgt["database"],
            "--no-password",
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            dump_path,
        ],
        tgt["password"],
        tgt["sslmode"],
    )
    print("Restore finished.")


def _rewrite_text(cur, sql: str, params: tuple) -> int:
    cur.execute(sql, params)
    return cur.rowcount or 0


def rewrite_urls(cfg: dict[str, str]) -> None:
    print("\n===== REWRITE STORED AZURE URLS (target DB) =====")
    dest_host = f"{NEW_ACCOUNT_HOST}"
    replacements = [
        (f"https://{OLD_ACCOUNT_HOST}/lead-stips/", f"https://{dest_host}/{cfg['stips_container']}/"),
        (f"https://{OLD_ACCOUNT_HOST}/call-recordings/", f"https://{dest_host}/{cfg['recordings_container']}/"),
        (f"https://{OLD_ACCOUNT_HOST}/whatsapp-media/", f"https://{dest_host}/{cfg['whatsapp_container']}/"),
        (f"https://{OLD_ACCOUNT_HOST}/", f"https://{dest_host}/"),
    ]
    cnx = connect_db(cfg["target_db"])
    cnx.autocommit = False
    cur = cnx.cursor()
    try:
        if table_exists(cur, "call_logs"):
            total = 0
            for old, new in replacements:
                total += _rewrite_text(
                    cur,
                    "UPDATE call_logs SET recording_url = replace(recording_url, %s, %s) "
                    "WHERE recording_url LIKE %s",
                    (old, new, f"%{old}%"),
                )
            print(f"  call_logs.recording_url rows touched (sum of replaces): {total}")

        for table in ("whatsapp_logs", "sms_logs"):
            if not table_exists(cur, table):
                continue
            total = 0
            for old, new in replacements:
                total += _rewrite_text(
                    cur,
                    f"UPDATE {table} SET media_urls = replace(media_urls::text, %s, %s)::jsonb "
                    f"WHERE media_urls::text LIKE %s",
                    (old, new, f"%{old}%"),
                )
            print(f"  {table}.media_urls rows touched (sum of replaces): {total}")
        cnx.commit()
        print("  committed.")
    except Exception:
        cnx.rollback()
        raise
    finally:
        cur.close()
        cnx.close()


def verify(cfg: dict[str, str]) -> int:
    print("\n===== VERIFY STIPS + RECORDINGS =====")
    errors = 0
    new_svc = BlobServiceClient.from_connection_string(cfg["new_blob"])
    dest_names = {b.name for b in new_svc.get_container_client(cfg["stips_container"]).list_blobs()}
    print(f"  new container {cfg['stips_container']}: {len(dest_names)} blobs")

    db_label = "target"
    try:
        cnx = connect_db(cfg["target_db"])
    except Exception as e:
        print(f"  target DB unreachable ({e}); verifying against SOURCE DB metadata")
        db_label = "source"
        cnx = connect_db(cfg["source_db"])
    print(f"  using {db_label} database for path lists")
    cur = cnx.cursor()
    try:
        missing_stips: list[str] = []
        for table in ("lead_stip_documents", "customer_stip_documents"):
            if not table_exists(cur, table):
                print(f"  {table}: missing table")
                errors += 1
                continue
            cur.execute(f"SELECT blob_path FROM {table}")
            paths = [r[0] for r in cur.fetchall() if r[0]]
            miss = [p for p in paths if p not in dest_names]
            print(f"  {table}: {len(paths)} rows, {len(miss)} blobs missing in {cfg['stips_container']}")
            errors += len(miss)
            missing_stips.extend(f"{table}:{p}" for p in miss[:15])

        if table_exists(cur, "call_logs"):
            cur.execute(
                "SELECT recording_url FROM call_logs "
                "WHERE recording_url ILIKE '%blob.core.windows.net%'"
            )
            rec_missing = 0
            old_host = 0
            n = 0
            for (u,) in cur.fetchall():
                n += 1
                if OLD_ACCOUNT_HOST in (u or ""):
                    old_host += 1
                name = (u or "").split("?")[0].rstrip("/").split("/")[-1]
                if name not in dest_names:
                    rec_missing += 1
            print(
                f"  call recordings: {n} azure urls, {rec_missing} blobs missing, "
                f"{old_host} still on old account host"
            )
            errors += rec_missing
            if db_label == "target":
                errors += old_host

        if table_exists(cur, "whatsapp_logs"):
            cur.execute(
                "SELECT media_urls FROM whatsapp_logs WHERE media_urls::text LIKE '%blob.core.windows.net%'"
            )
            wa_missing = old_host = n = 0
            for (urls,) in cur.fetchall():
                for u in (urls or []):
                    if not isinstance(u, str) or "blob.core.windows.net" not in u:
                        continue
                    n += 1
                    if OLD_ACCOUNT_HOST in u:
                        old_host += 1
                    parsed = urlparse(u)
                    parts = parsed.path.lstrip("/").split("/", 1)
                    blob_name = unquote(parts[1] if len(parts) == 2 else parts[0])
                    if blob_name not in dest_names:
                        wa_missing += 1
            print(
                f"  whatsapp azure media: {n} urls, {wa_missing} blobs missing, "
                f"{old_host} still on old account host"
            )
            errors += wa_missing
            if db_label == "target":
                errors += old_host

        if missing_stips:
            print("  missing stip samples:")
            for s in missing_stips:
                print("   ", s)
        if db_label == "source":
            print(
                "  NOTE: run backend/scripts/rewrite_azure_urls.sql on the NEW database "
                "(this machine cannot reach tikuncrmdb until its firewall allows you)."
            )
    finally:
        cur.close()
        cnx.close()

    if errors:
        print(f"\nVERIFY FAILED with {errors} issue(s).")
    else:
        print("\nVERIFY OK: stip paths, recordings, and WhatsApp Azure URLs exist on the new account.")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate Azure blobs and stored URLs for TikunCRM cutover")
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--copy-blobs", action="store_true")
    parser.add_argument("--restore-db", action="store_true")
    parser.add_argument("--force-restore", action="store_true")
    parser.add_argument("--rewrite-urls", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    run_all = not any([args.inventory, args.copy_blobs, args.restore_db, args.rewrite_urls, args.verify])

    cfg = load_config()
    print("Cutover config:")
    print(f"  dest recordings container: {cfg['recordings_container']}")
    print(f"  dest stips container:     {cfg['stips_container']}")
    print(f"  dest whatsapp container:  {cfg['whatsapp_container']}")

    if run_all or args.inventory:
        db_inventory("SOURCE(old)", cfg["source_db"])
        db_inventory("TARGET(new)", cfg["target_db"])
        blob_inventory("OLD", cfg["old_blob"])
        blob_inventory("NEW", cfg["new_blob"])

    if run_all or args.copy_blobs:
        copy_blobs(cfg)

    if args.restore_db or (run_all and False):
        # Restore is explicit-only: user said DB is already shifted.
        restore_db_if_needed(cfg, force=args.force_restore)
    elif run_all:
        tgt = db_inventory("TARGET(new) before URL rewrite", cfg["target_db"])
        src = {}  # already printed above; re-check emptiness only
        if not tgt.get("leads"):
            print(
                "\nTarget DB has no leads. If the restore is not done yet, re-run:\n"
                "  python -m scripts.migrate_azure_cutover --restore-db"
            )

    if run_all or args.rewrite_urls:
        try:
            cnx = connect_db(cfg["target_db"])
            cur = cnx.cursor()
            has_leads = table_exists(cur, "leads")
            cur.close()
            cnx.close()
        except Exception as e:
            print(f"Cannot rewrite URLs, target DB unreachable: {e}")
            has_leads = False
        if has_leads:
            rewrite_urls(cfg)
        else:
            print("Skipping URL rewrite (target has no leads table).")

    if run_all or args.verify:
        return 1 if verify(cfg) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
