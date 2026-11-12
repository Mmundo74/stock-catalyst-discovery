"""Independent, source-only Phys.org RSS to ntfy notices.

No article text archiving, trading, impact inference, ticker gating, or SEC interactions.
The public publisher feed is a rolling snapshot: NEVER claim complete coverage.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

SOURCE_ID = "news-physorg"
FEED_URL = "https://phys.org/rss-feed/"
PUBLISHER = "Phys.org"
REPO = "Mmundo74/stock-catalyst-discovery"
BASELINE_UTC = "2026-11-12T03:44:59.214Z"
ISSUE_NUMBER = 3  # separate source-state issue, never the News Central issue
STATE_OPEN = "<!-- PHYSORG_NEWS_STATE_V1\n"
STATE_CLOSE = "\nEND_PHYSORG_NEWS_STATE_V1 -->"
MAX_RAW_BYTES = 250_000
MAX_ITEMS = 150
MAX_ISSUE_VERSIONS = 450
MAX_NOTICE_BYTES = 3200
MAX_NOTICES = 2
API_BASE = f"https://api.github.com/repos/{REPO}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean_timestamp(value: str) -> tuple[str, str]:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("INVALID_PUBLISHED_TIME")
    try:
        parsed = parsedate_to_datetime(value.strip())
    except (TypeError, ValueError, IndexError) as error:
        raise ValueError("INVALID_PUBLISHED_TIME") from error
    if parsed.tzinfo is None:
        raise ValueError("PUBLISHED_TIME_HAS_NO_TIMEZONE")
    return (value, parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))


def valid_article_url(value: str) -> str:
    if not value or not isinstance(value, str):
        raise ValueError("ARTICLE_URL_MISSING")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or parsed.netloc.lower() != "phys.org" or parsed.username or parsed.password:
        raise ValueError("ARTICLE_URL_UNTRUSTED")
    return value


def item_text(item: ET.Element, tag: str) -> str:
    node = item.find(tag)
    return "" if node is None or node.text is None else node.text.strip()


def parse_feed(raw: bytes, now: datetime | None = None) -> dict[str, Any]:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_RAW_BYTES:
        raise ValueError("INVALID_RSS_RESPONSE_SIZE")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as error:
        raise ValueError("INVALID_XML") from error
    if root.tag != "rss" or root.attrib.get("version") != "2.0":
        raise ValueError("NOT_RSS_2_0")
    channel = root.find("channel")
    if channel is None or not item_text(channel, "title").startswith("Phys.org") or item_text(channel, "link") != "https://phys.org/":
        raise ValueError("UNEXPECTED_RSS_PUBLISHER")
    original_items = channel.findall("item")
    if len(original_items) > MAX_ITEMS:
        raise ValueError("RSS_ITEM_CAP_EXCEEDED")
    as_of = now or datetime.now(timezone.utc)
    if as_of.tzinfo is None:
        raise ValueError("CHECK_TIME_HAS_NO_TIMEZONE")
    seen = set()
    records = []
    duplicates = 0
    for i, item in enumerate(original_items):
        guid = item_text(item, "guid")
        title = item_text(item, "title")
        url = valid_article_url(item_text(item, "link"))
        original, iso = clean_timestamp(item_text(item, "pubDate"))
        if not guid or not title or len(title) > 500:
            raise ValueError(f"INCOMPLETE_ITEM_{i}")
        published = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if published > as_of + timedelta(hours=1):
            raise ValueError("FUTURE_PUBLISHED_TIME")
        # Fingerprint original source-supplied fields, but do not store descriptions or images.
        fields = {"guid": guid, "title": title, "url": url,
                  "description": item_text(item, "description"),
                  "category": item_text(item, "category"), "pubDate": original}
        fingerprint = hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode("utf-8")).hexdigest()
        pair = (guid, fingerprint)
        if pair in seen:
            duplicates += 1
            continue
        seen.add(pair)
        records.append({"id": guid, "title_original": title, "url": url,
                        "publication_original": original, "publication_utc": iso,
                        "category_original": fields["category"], "fingerprint": fingerprint,
                        "publisher": PUBLISHER})
    return {"source_id": SOURCE_ID, "status": "VERIFIED_PARTIAL",
            "raw_sha256": hashlib.sha256(raw).hexdigest(), "raw_bytes": len(raw),
            "source_item_occurrences": len(original_items), "retained_variants": len(records),
            "duplicate_exact_occurrences": duplicates, "items": records,
            "coverage_gap": "Latest-30 rolling source feed; missing older/unexposed items unknown; no documented history pagination; updated timestamp not supplied"}


def state_from_issue(body: str) -> dict[str, Any]:
    if not isinstance(body, str):
        raise ValueError("ISSUE_STATE_MISSING")
    if body.count(STATE_OPEN) != 1 or body.count(STATE_CLOSE) != 1:
        raise ValueError("ISSUE_STATE_MARKERS_INVALID")
    try:
        payload = body.split(STATE_OPEN, 1)[1].split(STATE_CLOSE, 1)[0]
        state = json.loads(payload)
    except (IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("ISSUE_STATE_INVALID_JSON") from error
    if not isinstance(state, dict) or state.get("schema_version") != 1 or state.get("source_id") != SOURCE_ID or state.get("baseline_utc") != BASELINE_UTC:
        raise ValueError("ISSUE_STATE_IDENTITY_MISMATCH")
    versions = state.get("versions")
    if not isinstance(versions, dict) or len(versions) > MAX_ISSUE_VERSIONS or any(not isinstance(k, str) or not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v) for k, v in versions.items()):
        raise ValueError("ISSUE_STATE_VERSIONS_INVALID")
    history = state.get("seen_variants", {})
    if not isinstance(history, dict) or len(history) > MAX_ISSUE_VERSIONS:
        raise ValueError("ISSUE_STATE_HISTORY_INVALID")
    for guid, digests in history.items():
        if (guid not in versions or not isinstance(digests, list) or not 1 <= len(digests) <= 6
            or len(set(digests)) != len(digests)
            or any(not isinstance(x, str) or not re.fullmatch(r"[0-9a-f]{64}", x) for x in digests)):
            raise ValueError("ISSUE_STATE_HISTORY_INVALID")
    return state


def issue_with_state(body: str, state: dict[str, Any]) -> str:
    old = state_from_issue(body)
    if old["source_id"] != state.get("source_id") or old["baseline_utc"] != state.get("baseline_utc"):
        raise ValueError("SOURCE_STATE_CHANGED")
    compact = json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (body.split(STATE_OPEN, 1)[0] + STATE_OPEN + compact + STATE_CLOSE
            + body.split(STATE_CLOSE, 1)[1])


def plan(parsed: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    if parsed.get("source_id") != SOURCE_ID or parsed.get("status") != "VERIFIED_PARTIAL":
        raise ValueError("WRONG_PARSED_SOURCE")
    baseline = datetime.fromisoformat(BASELINE_UTC.replace("Z", "+00:00"))
    observed = dict(state["versions"])
    history = {key: list(digests) for key, digests in state.get("seen_variants", {}).items()}
    prior_keys = set(observed)
    selected = []
    new_ids = set()
    for item in parsed["items"]:
        key = item["id"]
        digest = item["fingerprint"]
        known = set(history.get(key, []))
        if key in observed:
            known.add(observed[key])
        if digest in known:
            continue
        published = datetime.fromisoformat(item["publication_utc"].replace("Z", "+00:00"))
        if published >= baseline or key in prior_keys:
            selected.append(item)
            new_ids.add(key)
        older = observed.get(key)
        chain = history.get(key, [])
        if older is not None and older not in chain:
            chain.append(older)
        chain.append(digest)
        history[key] = chain[-6:]
        observed[key] = digest
    if len(observed) > MAX_ISSUE_VERSIONS:
        active_keys = list(dict.fromkeys(item["id"] for item in parsed["items"]))
        keep = active_keys + [key for key in reversed(observed) if key not in active_keys]
        observed = {key: observed[key] for key in keep[:MAX_ISSUE_VERSIONS]}
    history = {key: digests for key, digests in history.items()
               if key in observed and len(digests) > 1}
    return {"selected": selected, "versions": observed, "seen_variants": history,
            "provider_occurrences": parsed["source_item_occurrences"],
            "retained_variants": parsed["retained_variants"],
            "new_unique_ids": len(new_ids)}


def pack(items: list[dict[str, Any]], max_bytes: int = MAX_NOTICE_BYTES,
         max_messages: int = MAX_NOTICES) -> list[str]:
    result, parts, byte_count = [], [], 0
    for item in items:
        # Original publisher title and URL are unmodified. No generated significance filtering.
        line = (f"{item['title_original']}\n{item['url']}\n"
                f"Published (source): {item['publication_original']}\n"
                f"Source: {PUBLISHER}\n")
        length = len((line + "\n").encode("utf-8"))
        if length > max_bytes:
            raise ValueError("SINGLE_NOTICE_TOO_LARGE")
        if parts and length + byte_count > max_bytes:
            result.append("\n".join(parts))
            parts, byte_count = [], 0
        parts.append(line)
        byte_count += length
    if parts:
        result.append("\n".join(parts))
    if len(result) > max_messages:
        raise ValueError("NOTICE_LIMIT_EXCEEDED")
    return result


def request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None,
            payload: bytes | None = None, max_bytes: int = 1_000_000) -> tuple[bytes, dict[str, str], str]:
    req = urllib.request.Request(url, headers=headers or {}, data=payload, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            status = response.status
            if status != 200 and status != 201:
                raise RuntimeError(f"HTTP_{status}")
            raw = response.read(max_bytes + 1)
            if not raw or len(raw) > max_bytes:
                raise RuntimeError("RESPONSE_SIZE_INVALID")
            return raw, {k.lower(): v for k, v in response.headers.items()}, response.url
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP_{error.code}") from error


def github_issue(method: str = "GET", body: str | None = None) -> dict[str, Any]:
    token = os.environ.get("GITHUB_TOKEN")
    if not token or ISSUE_NUMBER <= 0:
        raise RuntimeError("SOURCE_STATE_CREDENTIALS_MISSING")
    data = None if body is None else json.dumps({"body": body}).encode("utf-8")
    raw, _h, _url = request(f"{API_BASE}/issues/{ISSUE_NUMBER}", method=method,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"},
        payload=data)
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("GITHUB_ISSUE_NOT_JSON") from error
    if not isinstance(doc, dict) or doc.get("number") != ISSUE_NUMBER:
        raise RuntimeError("GITHUB_ISSUE_ID_MISMATCH")
    return doc


def fetch_publisher() -> dict[str, Any]:
    raw, hdrs, final_url = request(FEED_URL, headers={"Accept": "application/rss+xml,application/xml,text/xml",
                             "User-Agent": "StockNewsDiscovery/1.0 (https://github.com/Mmundo74/stock-catalyst-discovery)"},max_bytes=MAX_RAW_BYTES)
    if final_url != FEED_URL or "xml" not in hdrs.get("content-type", "").lower():
        raise RuntimeError("PUBLISHER_REDIRECT_OR_CONTENT_TYPE_INVALID")
    return parse_feed(raw)


def verify_ntfy(topic: str, published_id: str) -> None:
    url = f"https://ntfy.sh/{topic}/json?poll=1&since=all"
    for attempt in range(5):
        time.sleep(1 + attempt * 0.5)
        try:
            raw, _headers, final_url = request(url, headers={"Cache-Control": "no-cache"},max_bytes=750_000)
            if not final_url.startswith("https://ntfy.sh/"):
                continue
            for line in raw.splitlines():
                try:
                    response = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if response.get("id") == published_id and response.get("topic") == topic:
                    return
        except (RuntimeError, urllib.error.URLError):
            continue
    raise RuntimeError("NTFY_DELIVERY_READBACK_NOT_CONFIRMED")


def publish(topic: str, body: str, count: int) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{24,96}", topic or ""):
        raise RuntimeError("NTFY_TOPIC_INVALID")
    data = json.dumps({"topic": topic, "title": f"Phys.org: {count} source item(s)",
        "message": body, "priority": 2, "tags": ["microscope"],
        "click": f"https://github.com/{REPO}/issues/{ISSUE_NUMBER}"}, ensure_ascii=False).encode("utf-8")
    raw, _h, _url = request("https://ntfy.sh/", method="POST",
                            headers={"Content-Type": "application/json"}, payload=data)
    try:
        receipt = json.loads(raw)
        message_id = receipt["id"]
    except (ValueError, KeyError, TypeError) as error:
        raise RuntimeError("NTFY_ACK_INVALID") from error
    if not isinstance(message_id, str) or not message_id:
        raise RuntimeError("NTFY_ACK_ID_MISSING")
    verify_ntfy(topic, message_id)
    return message_id


def run(*, dry_run: bool = False) -> dict[str, Any]:
    started = utc_now()
    issue = github_issue()
    state = state_from_issue(issue.get("body", ""))
    received = fetch_publisher()
    decision = plan(received, state)
    notices = pack(decision["selected"])  # Check all caps BEFORE sending anything
    if dry_run:
        return {"mode": "DRY_RUN", "source_id": SOURCE_ID, "source_status": "VERIFIED_PARTIAL",
            "run_started_at_utc": started, "feed_items": received["source_item_occurrences"],
            "retained_variants": received["retained_variants"],
            "new_variants": len(decision["selected"]), "notice_batches": len(notices),
            "source_raw_sha256_in_memory_only": received["raw_sha256"],
            "coverage_gap": received["coverage_gap"], "state_issue": ISSUE_NUMBER,
            "checkpoint_committed": False, "article_full_text_retrieved": False}
    topic = os.environ.get("NEWS_NTFY_TOPIC", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{24,96}", topic):
        raise RuntimeError("NTFY_TOPIC_MISSING_OR_INVALID")
    delivered = [publish(topic, note, len(decision["selected"])) for note in notices]
    updated = {**state, "versions": decision["versions"],
               "seen_variants": decision["seen_variants"],
               "last_checked_at_utc": started, "last_status": "VERIFIED_PARTIAL",
               "last_delivery_at_utc": utc_now() if delivered else state.get("last_delivery_at_utc"),
               "delivered_batches": state.get("delivered_batches", 0) + len(delivered)}
    updated_body = issue_with_state(issue["body"], updated)
    github_issue("PATCH", updated_body)
    independently_read = github_issue("GET")
    actual = state_from_issue(independently_read.get("body", ""))
    if actual["versions"] != updated["versions"] or actual["last_checked_at_utc"] != started:
        raise RuntimeError("STATE_PATCH_READBACK_MISMATCH")
    return {"mode": "HOSTED", "source_id": SOURCE_ID, "source_status": "VERIFIED_PARTIAL",
         "run_started_at_utc": started, "feed_items": received["source_item_occurrences"],
         "retained_variants": received["retained_variants"], "new_variants": len(decision["selected"]),
         "confirmed_ntfy_batches": len(delivered), "ntfy_receipt_ids": delivered,
         "readback_verified": True, "checkpoint_committed": bool(delivered),
         "coverage_gap": received["coverage_gap"], "article_full_text_retrieved": False}


if __name__ == "__main__":
    try:
        print(json.dumps(run(dry_run="--dry-run" in sys.argv), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"source_id": SOURCE_ID, "status": "FAILED", "error_code": str(error)[:170],
                          "checkpoint_committed": False, "no_false_zero": True}), file=sys.stderr)
        sys.exit(1)
