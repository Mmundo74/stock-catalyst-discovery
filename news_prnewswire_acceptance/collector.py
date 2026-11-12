#!/usr/bin/env python3
"""One-shot PR Newswire public RSS acceptance probe. No schedules or notifications."""
import argparse
import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from uuid import uuid4

SOURCE = "news-prnewswire-all"
URL = "https://www.prnewswire.com/rss/news-releases-list.rss"
ALL_SOURCES = [
    "news-exa", "news-tickerbot", "news-issuer-announcements", "news-general-rss",
    "news-prnewswire-all", "news-globenewswire-public", "news-bbc-business",
    "news-bbc-world", "news-bbc-technology", "news-bbc-science",
    "news-guardian-world", "news-physorg", "news-newscentral-json-all",
]
MAX_BYTES = 5_000_000
MAX_ITEMS = 2000
DC = "{http://purl.org/dc/elements/1.1/}"

def utcnow():
    return datetime.now(timezone.utc)

def iso(d):
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def sha(b):
    return hashlib.sha256(b).hexdigest()

def encoded_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")

def write_verified(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise RuntimeError("REFUSE_TO_OVERWRITE_EXISTING_FILE")
    path.write_bytes(data)
    check = path.read_bytes()
    if check != data or sha(check) != sha(data):
        raise RuntimeError("LOCAL_FILE_READBACK_MISMATCH")
    return {"path": str(path), "bytes": len(data), "sha256": sha(data), "local_readback": True,
            "independent_durable_readback_verified": False}

def parse_rss(raw, fetched_at):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("INVALID_FEED_SIZE")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise ValueError("MALFORMED_RSS_XML") from e
    if root.tag != "rss":
        raise ValueError("UNEXPECTED_ROOT")
    channel = root.find("channel")
    if channel is None or (channel.findtext("title") or "").strip() != "All News Releases":
        raise ValueError("UNEXPECTED_RSS_SOURCE")
    items = channel.findall("item")
    if len(items) > MAX_ITEMS:
        raise ValueError("FEED_ITEM_LIMIT_EXCEEDED")
    rows = []
    seen = {}
    for i, item in enumerate(items):
        def get(tag):
            return (item.findtext(tag) or "").strip()
        guid, title, link, published = (get("guid"), get("title"), get("link"), get("pubDate"))
        if not guid or not title or not link or not published:
            raise ValueError("INCOMPLETE_SOURCE_ITEM_" + str(i))
        url = urllib.parse.urlsplit(link)
        if url.scheme != "https" or url.hostname != "www.prnewswire.com" or url.username or url.password:
            raise ValueError("ARTICLE_LINK_NOT_ON_PROVIDER_" + str(i))
        try:
            dt = parsedate_to_datetime(published)
        except (TypeError, ValueError) as e:
            raise ValueError("INVALID_SOURCE_TIME_" + str(i)) from e
        if dt.tzinfo is None or dt.astimezone(timezone.utc) > fetched_at + timedelta(hours=1):
            raise ValueError("UNTRUSTED_SOURCE_TIME_" + str(i))
        # Entire raw RSS bytes retain every occurrence and source metadata.
        # One row per distinct GUID+source-payload version; amended releases survive.
        fingerprint = sha(ET.tostring(item, encoding="utf-8"))
        key = (guid, fingerprint)
        if key in seen:
            rows[seen[key]]["duplicate_occurrence_count"] += 1
            rows[seen[key]]["raw_occurrence_indices"].append(i)
            continue
        seen[key] = len(rows)
        rows.append({
            "schema_version": "1.0", "source_id": SOURCE,
            "record_key": sha((SOURCE + "\0" + guid + "\0" + fingerprint).encode()),
            "source_record_id": guid, "source_guid_original": guid,
            "title_original": title,
            "publisher_original": get(DC + "publisher") or None,
            "original_name": get(DC + "contributor") or None,
            "ticker_original": None, "source_url": link,
            "source_timestamps": [{"name": "pubDate", "original": published,
                                   "utc": iso(dt), "precision": "source_supplied"}],
            "retrieved_at_utc": iso(fetched_at), "full_text_retrieved": False,
            "content_type": "rss_item_metadata",
            "raw_path": "sources/" + SOURCE + "/raw/page-0001.xml",
            "raw_sha256": sha(raw), "raw_locator": "channel.item[" + str(i) + "]",
            "raw_occurrence_indices": [i], "duplicate_occurrence_count": 1,
            "source_payload_sha256": fingerprint,
            "metadata": {"description_original": get("description") or None,
                         "category_original": [e.text or "" for e in item.findall("category")],
                         "language_original": get(DC + "language") or None},
        })
    return {"items": items, "rows": rows, "title": channel.findtext("title"),
            "latest_build_original": channel.findtext("lastBuildDate")}

def classify_http_error(code):
    return "BLOCKED" if code in (401, 403, 429, 451) else "FAILED"

def fetch():
    request = urllib.request.Request(URL, headers={
        "User-Agent": "StockNewsDiscovery/1.0 (+https://github.com/Mmundo74/stock-catalyst-discovery)",
        "Accept": "application/rss+xml,application/xml,text/xml",
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as resp:
            final_url = resp.geturl()
            status = resp.status
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read(MAX_BYTES + 1)
            limits = {k.lower(): v for k, v in resp.headers.items()
                      if k.lower().startswith(("retry-after", "x-ratelimit"))}
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP_" + str(e.code)) from e
    if final_url != URL or status != 200:
        raise RuntimeError("HTTP_REDIRECT_OR_STATUS_UNEXPECTED")
    if not any(t in content_type.lower() for t in ("xml", "rss")):
        raise RuntimeError("CONTENT_TYPE_NOT_RSS")
    if not raw or len(raw) > MAX_BYTES:
        raise RuntimeError("RESPONSE_SIZE_INVALID")
    return raw, content_type, limits

def main():
    began = utcnow()
    run_id = began.strftime("%Y%m%dT%H%M%SZ") + "--" + uuid4().hex[:12]
    root = Path("stock-news-collection") / began.strftime("%Y-%m-%d") / run_id
    started = iso(began)
    ended = None
    window_start = iso(began - timedelta(hours=1))
    manifest = {}
    src = {}
    for name in ALL_SOURCES:
        src[name] = {
            "schema_version": "1.0", "source_id": name,
            "provider": "PR Newswire" if name == SOURCE else None,
            "channel": "All News Releases RSS" if name == SOURCE else None,
            "status": "NOT_RUN", "implementation_state": "ONE_SHOT_PROBE" if name == SOURCE else "NOT_TESTED_IN_THIS_RUN",
            "query_scope": "rolling publisher RSS snapshot; no server-side UTC time filter" if name == SOURCE else "NOT_RUN",
            "requested_window_start_utc": window_start, "requested_window_end_utc": started,
            "requests": [], "provider_reported_total": None,
            "retrieved_item_occurrences": None, "unique_item_records": None,
            "duplicate_occurrences": None, "retained_raw_occurrences": None,
            "verified_record_count": None, "full_text_retrieved_count": None,
            "source_time_coverage": None, "missing_pages": [],
            "known_unknowns": ["Not polled in this one-source run"],
            "files": [], "last_safe_checkpoint": None, "checkpoint_committed": False,
            "last_successful_at_utc": None,
        }
    source = src[SOURCE]
    source["status"] = "FAILED"
    source["known_unknowns"] = ["Publisher feed exposes rolling latest-N items only; history and paging not documented."]
    run_errors = []
    raw = None
    try:
        raw, content_type, limits = fetch()
        downloaded = utcnow()
        source["requests"].append({
            "method": "GET", "url": URL, "started_at_utc": started,
            "ended_at_utc": iso(downloaded), "http_status": 200,
            "bytes": len(raw), "content_type": content_type, "rate_limit_headers": limits,
            "cursor": None, "next_cursor": None, "pagination": "none documented",
        })
        rel = Path("sources") / SOURCE / "raw" / "page-0001.xml"
        entry = write_verified(root / rel, raw)
        entry["path"] = str(rel)
        source["files"].append(entry)
        parsed = parse_rss(raw, downloaded)
        jsonl = b"".join(json.dumps(r, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
                         for r in parsed["rows"])
        rows_check = [json.loads(line) for line in jsonl.splitlines()]
        if len(rows_check) != len(parsed["rows"]):
            raise RuntimeError("JSONL_COUNT_MISMATCH")
        if sum(r["duplicate_occurrence_count"] for r in rows_check) != len(parsed["items"]):
            raise RuntimeError("RSS_OCCURRENCE_MISMATCH")
        rel2 = Path("sources") / SOURCE / "records.jsonl"
        entry2 = write_verified(root / rel2, jsonl)
        entry2["path"] = str(rel2)
        source["files"].append(entry2)
        source.update({
            "status": "VERIFIED_PARTIAL",
            "retrieved_item_occurrences": len(parsed["items"]),
            "unique_item_records": len(parsed["rows"]),
            "duplicate_occurrences": len(parsed["items"]) - len(parsed["rows"]),
            "retained_raw_occurrences": len(parsed["items"]),
            "verified_record_count": len(parsed["rows"]),
            "full_text_retrieved_count": 0,
            "source_time_coverage": {"feed_last_build_original": parsed["latest_build_original"],
                                     "server_side_time_filter": False},
            "last_successful_at_utc": iso(downloaded),
            "known_unknowns": [
                "Rolling latest-N feed: unknown skipped items between polls.",
                "No documented RSS pagination or historical replay.",
                "No verified article FULL TEXT; RSS descriptions are summaries.",
                "GitHub artifact independent durable readback not yet completed.",
                "No checkpoint committed in this one-shot acceptance probe.",
            ],
        })
    except Exception as e:
        error = str(e)[:200]
        run_errors.append(error)
        if error.startswith("HTTP_"):
            try:
                status = int(error.split("_")[1])
            except ValueError:
                status = None
            source["status"] = classify_http_error(status) if status else "FAILED"
            source["requests"].append({
                "method": "GET", "url": URL, "started_at_utc": started,
                "ended_at_utc": iso(utcnow()), "http_status": status, "error": error,
                "cursor": None, "next_cursor": None,
            })
        else:
            source["status"] = "FAILED"
            source["requests"].append({
                "method": "GET", "url": URL, "started_at_utc": started,
                "ended_at_utc": iso(utcnow()), "error": error, "http_status": None,
            })
        source["known_unknowns"].append("Probe failed: " + error + "; no zero-story success claim.")
    ended = iso(utcnow())
    for name in ALL_SOURCES:
        rel = Path("sources") / name / "manifest.json"
        b = encoded_json(src[name])
        info = write_verified(root / rel, b)
        manifest[name] = {"path": str(rel), "sha256": info["sha256"],
                          "status": src[name]["status"], "bytes": info["bytes"]}
    run = {
        "schema_version": "1.0", "run_id": run_id, "scheduled_for_utc": None,
        "started_at_utc": started, "ended_at_utc": ended, "engine": "news",
        "status": "PARTIAL", "registered_source_ids": ALL_SOURCES,
        "source_manifests": manifest,
        "coverage_gaps": ["Only one rolling source probed; required news sources not complete"],
        "storage_root": str(root), "files_verified": 0,
        "unverified_files": 1 + len(ALL_SOURCES) + len(source["files"]),
        "verification_completed_at_utc": None, "cost_usd": None,
        "quota_evidence": "RSS no API token; GitHub standard public runner costs not independently checked",
        "checkpoint_committed": False, "project_version": "1.0",
        "example_only": False, "errors": run_errors,
    }
    write_verified(root / "run-manifest.json", encoded_json(run))
    print(json.dumps({"run_id": run_id, "status": source["status"],
                      "source": SOURCE, "raw": source["retrieved_item_occurrences"],
                      "unique": source["unique_item_records"],
                      "raw_sha256": sha(raw) if raw else None,
                      "root": str(root), "checkpoint_committed": False,
                      "artifact_readback": "PENDING_INDEPENDENT_DOWNLOAD",
                      "errors": run_errors}, ensure_ascii=False))
    return 0 if source["status"] == "VERIFIED_PARTIAL" else 1

def self_test():
    item = '<item><guid>g</guid><title>Original</title><link>https://www.prnewswire.com/news-releases/a.html</link><pubDate>Thu, 12 Nov 2026 16:35:00 +0000</pubDate><description>Summary</description></item>'
    xml = ('<rss version="2.0"><channel><title>All News Releases</title>' + item + item + '</channel></rss>').encode()
    expected = datetime(2026, 11, 12, 17, tzinfo=timezone.utc)
    p = parse_rss(xml, expected)
    assert len(p["items"]) == 2 and len(p["rows"]) == 1
    assert p["rows"][0]["duplicate_occurrence_count"] == 2
    assert p["rows"][0]["title_original"] == "Original"
    assert p["rows"][0]["source_timestamps"][0]["utc"].startswith("2026-11-12T16:35:00")
    assert p["rows"][0]["full_text_retrieved"] is False
    for bad in (b"<rss><bad>", b"<not-rss/>", b""):
        try:
            parse_rss(bad, expected)
            raise AssertionError("Invalid RSS accepted")
        except ValueError:
            pass
    revised = xml.replace(b"<description>Summary</description>", b"<description>Revised</description>", 1)
    assert len(parse_rss(revised, expected)["rows"]) == 2
    assert classify_http_error(403) == "BLOCKED"
    assert classify_http_error(429) == "BLOCKED"
    assert classify_http_error(503) == "FAILED"
    with tempfile.TemporaryDirectory() as d:
        info = write_verified(Path(d) / "x.jsonl", b'{"ok":true}\n')
        assert info["sha256"] == sha(b'{"ok":true}\n')
        try:
            write_verified(Path(d) / "x.jsonl", b'{}\n')
            raise AssertionError("Overwrite succeeded")
        except RuntimeError:
            pass
    print("SELF_TEST_PASS 13 checks")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        raise SystemExit(main())
