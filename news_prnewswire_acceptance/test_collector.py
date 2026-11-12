import hashlib
import pathlib
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from unittest.mock import patch

import collector as c

NOW = datetime(2026, 11, 12, 17, 0, tzinfo=timezone.utc)
BASE = '<rss version="2.0"><channel><title>All News Releases</title>{items}</channel></rss>'
def item(guid="g1", title="News", desc="Source summary", date="Thu, 12 Nov 2026 16:35:00 +0000",
         link="https://www.prnewswire.com/news-releases/example.html", publisher=None):
    extra = '<dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">PR Newswire Association LLC.</dc:publisher>' if publisher else ""
    return f"<item><guid>{guid}</guid><title>{title}</title><link>{link}</link><pubDate>{date}</pubDate><description>{desc}</description>{extra}</item>"
def rss(contents=None):
    return BASE.format(items=item() if contents is None else contents).encode("utf-8")

class SourceTests(unittest.TestCase):
    def parse(self, b=None):
        return c.parse_rss(rss() if b is None else b, NOW)
    def test_valid_items(self): self.assertEqual(len(self.parse()["items"]), 1)
    def test_source_guid(self): self.assertEqual(self.parse()["rows"][0]["source_guid_original"], "g1")
    def test_source_title_untouched(self): self.assertEqual(self.parse(rss(item(title="Unicode—测试")))["rows"][0]["title_original"], "Unicode—测试")
    def test_source_url_untouched(self): self.assertEqual(self.parse()["rows"][0]["source_url"], "https://www.prnewswire.com/news-releases/example.html")
    def test_source_timestamp_utc(self): self.assertTrue(self.parse()["rows"][0]["source_timestamps"][0]["utc"].startswith("2026-11-12T16:35:00"))
    def test_preserve_original_time_offset(self): self.assertEqual(self.parse(rss(item(date="Thu, 12 Nov 2026 11:35:00 -0500")))["rows"][0]["source_timestamps"][0]["original"], "Thu, 12 Nov 2026 11:35:00 -0500")
    def test_preserve_provider_name(self): self.assertEqual(self.parse(rss(item(publisher=True)))["rows"][0]["publisher_original"], "PR Newswire Association LLC.")
    def test_no_inferred_ticker(self): self.assertIsNone(self.parse()["rows"][0]["ticker_original"])
    def test_no_full_article_claim(self): self.assertIs(self.parse()["rows"][0]["full_text_retrieved"], False)
    def test_summary_is_feed_text_only(self): self.assertEqual(self.parse()["rows"][0]["metadata"]["description_original"], "Source summary")
    def test_raw_checksum(self): self.assertEqual(self.parse()["rows"][0]["raw_sha256"], c.sha(rss()))
    def test_duplicate_exact_occurrence_preserved(self):
        p=self.parse(rss(item()+item()))
        self.assertEqual(len(p["items"]),2)
        self.assertEqual(len(p["rows"]),1)
        self.assertEqual(p["rows"][0]["raw_occurrence_indices"],[0,1])
    def test_revision_same_guid_preserved(self):
        p=self.parse(rss(item()+item(desc="Changed source description")))
        self.assertEqual(len(p["rows"]),2)
        self.assertNotEqual(p["rows"][0]["source_payload_sha256"],p["rows"][1]["source_payload_sha256"])
    def test_replay_stable_record_key(self):
        a=self.parse()["rows"][0]["record_key"]
        b=self.parse()["rows"][0]["record_key"]
        self.assertEqual(a,b)
    def test_original_old_item_retained_not_filtered(self):
        p=self.parse(rss(item(date="Thu, 12 Nov 2026 01:35:00 +0000")))
        self.assertEqual(len(p["rows"]),1)
    def test_no_ticker_or_price_gate(self):
        self.assertEqual(len(self.parse(rss(item(title="Weather in Europe")))["rows"]),1)
    def test_empty_valid_feed_is_zero_source_items(self): self.assertEqual(len(self.parse(rss(""))["rows"]),0)
    def test_xml_malformed_fails(self):
        with self.assertRaisesRegex(ValueError,"MALFORMED_RSS_XML"): self.parse(b"<rss><bad>")
    def test_truncated_feed_fails(self):
        with self.assertRaises(ValueError): self.parse(rss()[:-9])
    def test_zero_byte_feed_fails(self):
        with self.assertRaisesRegex(ValueError,"INVALID_FEED_SIZE"): self.parse(b"")
    def test_wrong_root_fails(self):
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_ROOT"): self.parse(b"<notrss/>")
    def test_wrong_channel_fails(self):
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_RSS_SOURCE"): self.parse(b'<rss><channel><title>Other</title></channel></rss>')
    def test_missing_title_fails(self):
        with self.assertRaisesRegex(ValueError,"INCOMPLETE_SOURCE_ITEM"): self.parse(rss(item(title="")))
    def test_missing_guid_fails(self):
        with self.assertRaisesRegex(ValueError,"INCOMPLETE_SOURCE_ITEM"): self.parse(rss(item(guid="")))
    def test_http_article_link_fails(self):
        with self.assertRaisesRegex(ValueError,"ARTICLE_LINK_NOT_ON_PROVIDER"): self.parse(rss(item(link="http://www.prnewswire.com/a")))
    def test_external_article_link_fails(self):
        with self.assertRaisesRegex(ValueError,"ARTICLE_LINK_NOT_ON_PROVIDER"): self.parse(rss(item(link="https://evil.example/a")))
    def test_invalid_time_fails(self):
        with self.assertRaisesRegex(ValueError,"INVALID_SOURCE_TIME"): self.parse(rss(item(date="yesterday")))
    def test_future_time_fails(self):
        with self.assertRaisesRegex(ValueError,"UNTRUSTED_SOURCE_TIME"): self.parse(rss(item(date="Fri, 13 Nov 2026 16:35:00 +0000")))
    def test_explicit_http_restrictions(self):
        for code in [401,403,429,451]: self.assertEqual(c.classify_http_error(code),"BLOCKED")
    def test_server_failure_not_zero(self): self.assertEqual(c.classify_http_error(503),"FAILED")
    def test_fetch_403_fails_not_empty(self):
        with patch("urllib.request.urlopen",side_effect=urllib.error.HTTPError(c.URL,403,"Forbidden",{},None)):
            with self.assertRaisesRegex(RuntimeError,"HTTP_403"): c.fetch()
    def test_fetch_429_fails_not_empty(self):
        with patch("urllib.request.urlopen",side_effect=urllib.error.HTTPError(c.URL,429,"Too Many",{},None)):
            with self.assertRaisesRegex(RuntimeError,"HTTP_429"): c.fetch()
    def test_network_timeout_propagates(self):
        with patch("urllib.request.urlopen",side_effect=TimeoutError("timeout")):
            with self.assertRaises(TimeoutError): c.fetch()
    def test_raw_sha256_reproducible(self): self.assertEqual(c.sha(rss()),hashlib.sha256(rss()).hexdigest())
    def test_file_readback_hash(self):
        with tempfile.TemporaryDirectory() as d:
            info=c.write_verified(pathlib.Path(d)/"raw.xml",rss())
            self.assertEqual(info["sha256"],c.sha(rss()))
            self.assertFalse(info["independent_durable_readback_verified"])
    def test_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            f=pathlib.Path(d)/"raw.xml"
            c.write_verified(f,rss())
            with self.assertRaisesRegex(RuntimeError,"REFUSE_TO_OVERWRITE"): c.write_verified(f,rss())
    def test_no_silent_truncation_of_source_items(self):
        p=self.parse(rss("".join(item(guid=str(i)) for i in range(25))))
        self.assertEqual(len(p["rows"]),25)

if __name__=="__main__":
    unittest.main()
