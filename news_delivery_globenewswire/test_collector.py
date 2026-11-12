import json
import hashlib
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from xml.sax.saxutils import escape

import collector as c

NOW = datetime(2026, 11, 12, 5, 0, tzinfo=timezone.utc)
BASE = c.BASELINE_UTC
DATE0 = 'Thu, 12 Nov 2026 02:38 GMT'  # before source baseline
DATE1 = 'Thu, 12 Nov 2026 04:01 GMT'  # after source baseline

def item(guid='news1', title='Original source headline', link='https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companiesnews/2026-11/example.html',
         pub=DATE1, desc='source description', cat='Physics'):
    return f'<item><title>{escape(title)}</title><description>{escape(desc)}</description><link>{escape(link)}</link><category>{escape(cat)}</category><pubDate>{escape(pub)}</pubDate><guid isPermaLink="false">{escape(guid)}</guid></item>'

def rss(items=None, *, title='GlobeNewswire - News about Public Companies', channel_link='https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies'):
    if items is None:
        items=[item()]
    return (f'<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>{escape(title)}</title><link>{escape(channel_link)}</link><description>desc</description>' + ''.join(items) + '</channel></rss>').encode('utf-8')

def state():
    return {'schema_version':1,'source_id':c.SOURCE_ID,'baseline_utc':BASE,'versions':{},'last_status':'NOT_RUN','delivered_batches':0}

def body(state_obj=None):
    return 'Physical source independent state.\n\n'+c.STATE_OPEN+json.dumps(state_obj or state(),sort_keys=True,separators=(',',':'))+c.STATE_CLOSE+'\n'

class PhysOrgCollectorUnitTests(unittest.TestCase):
    def parse(self, items=None):
        return c.parse_feed(rss(items), now=NOW)
    def assertInvalid(self, raw, error):
        with self.assertRaisesRegex(ValueError, error):c.parse_feed(raw,now=NOW)

    def test_01_valid_original_rss(self): self.assertEqual(self.parse()['source_id'], 'news-globenewswire-public')
    def test_02_status_never_claims_complete(self): self.assertEqual(self.parse()['status'],'VERIFIED_PARTIAL')
    def test_03_raw_hash_reconciled(self):
        b=rss(); self.assertEqual(self.parse()['raw_sha256'],hashlib.sha256(b).hexdigest())
    def test_04_item_count(self): self.assertEqual(self.parse([item('a'),item('b')])['source_item_occurrences'],2)
    def test_05_original_guid_preserved(self): self.assertEqual(self.parse()['items'][0]['id'],'news1')
    def test_06_original_title_preserved(self): self.assertEqual(self.parse()['items'][0]['title_original'],'Original source headline')
    def test_07_preserve_original_est_timestamp(self): self.assertEqual(self.parse()['items'][0]['publication_original'],DATE1)
    def test_08_normalize_est_to_utc(self): self.assertEqual(self.parse()['items'][0]['publication_utc'],'2026-11-12T04:01:00Z')
    def test_09_no_body_or_image_stored(self):
        s=json.dumps(self.parse()['items'][0]); self.assertNotIn('source description',s);self.assertNotIn('image',s)
    def test_10_no_ticker_inference(self): self.assertNotIn('ticker',json.dumps(self.parse()))
    def test_11_unchanged_same_guid_dedup(self):
        parsed=self.parse([item('a'),item('a')]); self.assertEqual(parsed['source_item_occurrences'],2);self.assertEqual(parsed['retained_variants'],1)
    def test_12_source_revisions_both_retained(self):
        parsed=self.parse([item('a'),item('a',title='revised')]);self.assertEqual(parsed['retained_variants'],2)
    def test_13_fingerprint_ignore_xml_field_order(self):
        b=rss();b2=b.replace(b'<title>Original source headline</title><description>source description</description>',b'<description>source description</description><title>Original source headline</title>')
        self.assertEqual(c.parse_feed(b,now=NOW)['items'][0]['fingerprint'], c.parse_feed(b2,now=NOW)['items'][0]['fingerprint'])
    def test_14_malformed_xml_fails(self): self.assertInvalid(b'<rss><foo>','INVALID_XML')
    def test_15_empty_fails(self): self.assertInvalid(b'','INVALID_RSS_RESPONSE_SIZE')
    def test_16_non_rss_fails(self): self.assertInvalid(b'<root/>','NOT_RSS_2_0')
    def test_17_wrong_channel_publisher_fails(self): self.assertInvalid(rss(title='Some other site'),'UNEXPECTED_RSS_PUBLISHER')
    def test_18_wrong_channel_link_fails(self): self.assertInvalid(rss(channel_link='https://bad.invalid/'),'UNEXPECTED_RSS_PUBLISHER')
    def test_19_unapproved_link_host_fails(self): self.assertInvalid(rss([item(link='https://bad.example/a')]),'ARTICLE_URL_UNTRUSTED')
    def test_20_http_item_link_fails(self): self.assertInvalid(rss([item(link='http://www.globenewswire.com/news/x')]),'ARTICLE_URL_UNTRUSTED')
    def test_21_missing_guid_fails(self): self.assertInvalid(rss([item(guid='')]),'INCOMPLETE_ITEM_0')
    def test_22_missing_title_fails(self): self.assertInvalid(rss([item(title='')]),'INCOMPLETE_ITEM_0')
    def test_23_bad_pubdate_fails(self): self.assertInvalid(rss([item(pub='not a time')]),'INVALID_PUBLISHED_TIME')
    def test_24_future_pubdate_fails(self): self.assertInvalid(rss([item(pub='Sun, 01 Jan 2099 00:00:00 GMT')]),'FUTURE_PUBLISHED_TIME')
    def test_25_oversize_response_fails(self): self.assertInvalid(b' '*(c.MAX_RAW_BYTES+1),'INVALID_RSS_RESPONSE_SIZE')
    def test_26_item_cap_fails(self): self.assertInvalid(rss([item(str(i)) for i in range(c.MAX_ITEMS+1)]),'RSS_ITEM_CAP_EXCEEDED')
    def test_27_valid_empty_feed_is_partial(self):
        p=self.parse([]);self.assertEqual(p['source_item_occurrences'],0);self.assertEqual(p['status'],'VERIFIED_PARTIAL')
    def test_28_state_readback(self): self.assertEqual(c.state_from_issue(body())['versions'],{})
    def test_29_missing_state_fails(self):
        with self.assertRaisesRegex(ValueError,'ISSUE_STATE_MARKERS_INVALID'):c.state_from_issue('blank')
    def test_30_wrong_source_fails(self):
        b=body().replace('news-globenewswire-public','news-central');
        with self.assertRaisesRegex(ValueError,'ISSUE_STATE_IDENTITY_MISMATCH'):c.state_from_issue(b)
    def test_31_wrong_baseline_fails(self):
        with self.assertRaisesRegex(ValueError,'ISSUE_STATE_IDENTITY_MISMATCH'):c.state_from_issue(body().replace(BASE,'2024-01-01T00:00:00Z'))
    def test_32_bad_state_digest_fails(self):
        s=state();s['versions']={'guid':'bogus'};
        with self.assertRaisesRegex(ValueError,'ISSUE_STATE_VERSIONS_INVALID'):c.state_from_issue(body(s))
    def test_33_state_round_trip(self):
        s=state();s['versions']={'guid':'a'*64};self.assertEqual(c.state_from_issue(c.issue_with_state(body(),s))['versions'],s['versions'])
    def test_34_new_post_baseline_selected(self):self.assertEqual(len(c.plan(self.parse(),state())['selected']),1)
    def test_35_prior_item_suppressed(self):self.assertEqual(len(c.plan(self.parse([item(pub=DATE0)]),state())['selected']),0)
    def test_36_prior_item_still_journaled(self):self.assertEqual(len(c.plan(self.parse([item(pub=DATE0)]),state())['versions']),1)
    def test_37_same_digest_never_delivered_twice(self):
        p=self.parse();s=state();s['versions']={p['items'][0]['id']:p['items'][0]['fingerprint']};self.assertEqual(len(c.plan(p,s)['selected']),0)
    def test_38_prior_item_revision_selected_after_initial_observation(self):
        p=self.parse([item(pub=DATE0)]);s=state();s['versions']={p['items'][0]['id']:p['items'][0]['fingerprint']};r=self.parse([item(pub=DATE0,desc='changed')]);self.assertEqual(len(c.plan(r,s)['selected']),1)
    def test_39_wrong_source_plan_blocked(self):
        p=self.parse();p['source_id']='unknown'
        with self.assertRaisesRegex(ValueError,'WRONG_PARSED_SOURCE'):c.plan(p,state())
    def test_40_original_titles_and_links_in_notice(self):
        self.assertIn('Original source headline',c.pack(self.parse()['items'])[0]);self.assertIn('https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companiesnews/',c.pack(self.parse()['items'])[0])
    def test_41_empty_new_items_sends_nothing(self):self.assertEqual(c.pack([]),[])
    def test_42_byte_limit_splits_notices(self):
        p=self.parse([item('a'),item('b')]);self.assertEqual(len(c.pack(p['items'],max_bytes=230)),2)
    def test_43_message_cap_stops_all_sends(self):
        p=self.parse([item('a'),item('b')]);
        with self.assertRaisesRegex(ValueError,'NOTICE_LIMIT_EXCEEDED'):c.pack(p['items'],max_bytes=230,max_messages=1)
    def test_44_http_429_no_normalization_to_zero(self):
        err=__import__('urllib.error',fromlist=['HTTPError']).HTTPError(c.FEED_URL,429,'limit',{},None)
        with patch('urllib.request.urlopen',side_effect=err):
            with self.assertRaisesRegex(RuntimeError,'HTTP_429'):c.fetch_publisher()
    def test_45_network_error_is_not_zero(self):
        err=__import__('urllib.error',fromlist=['URLError']).URLError('failed')
        with patch('urllib.request.urlopen',side_effect=err):
            with self.assertRaises(__import__('urllib.error',fromlist=['URLError']).URLError):c.fetch_publisher()
    def test_46_state_read_failure_prevents_fetch(self):
        with patch.object(c,'github_issue',side_effect=RuntimeError('NO_STATE')) as issue,patch.object(c,'fetch_publisher') as feed:
            with self.assertRaisesRegex(RuntimeError,'NO_STATE'):c.run(dry_run=False)
            issue.assert_called_once();feed.assert_not_called()
    def test_47_malformed_source_prevents_state_patch(self):
        with patch.object(c,'github_issue',return_value={'body':body(),'number':10}) as issue,patch.object(c,'fetch_publisher',side_effect=ValueError('BAD_XML')):
            with self.assertRaisesRegex(ValueError,'BAD_XML'):c.run(dry_run=False)
            issue.assert_called_once()
    def test_48_delivery_failure_prevents_state_patch(self):
        p=self.parse();
        with patch.object(c,'github_issue',return_value={'body':body(),'number':10}) as issue,patch.object(c,'fetch_publisher',return_value=p),patch.object(c,'publish',side_effect=RuntimeError('NTFY_READBACK_FAILURE')),patch.dict('os.environ',{'NEWS_NTFY_TOPIC':'verylongtestingtopicname123456'}):
            with self.assertRaisesRegex(RuntimeError,'NTFY_READBACK_FAILURE'):c.run(dry_run=False)
            issue.assert_called_once()
    def test_49_source_dry_run_no_notification_or_write(self):
        with patch.object(c,'github_issue',return_value={'body':body(),'number':10}) as issue,patch.object(c,'fetch_publisher',return_value=self.parse()),patch.object(c,'publish') as push:
            o=c.run(dry_run=True);self.assertEqual(o['new_variants'],1);self.assertFalse(o['checkpoint_committed']);issue.assert_called_once();push.assert_not_called()
    def test_50_unicode_title_preserved(self):
        p=self.parse([item(title='© Biotechnology — new “result”')]);self.assertIn('© Biotechnology — new “result”',c.pack(p['items'])[0])
    def test_51_two_variants_same_guid_not_replayed(self):
        p=self.parse([item('a',desc='first'),item('a',desc='second')])
        one=c.plan(p,state())
        s=state();s['versions']=one['versions'];s['seen_variants']=one['seen_variants']
        replay=c.plan(p,s)
        self.assertEqual(len(one['selected']),2)
        self.assertEqual(len(replay['selected']),0)
    def test_52_two_old_variants_silenced_during_initial_bootstrap(self):
        p=self.parse([item('a',desc='first',pub=DATE0),item('a',desc='second',pub=DATE0)])
        self.assertEqual(len(c.plan(p,state())['selected']),0)
    def test_53_history_invalid_digest_blocked(self):
        s=state();s['versions']={'a':'0'*64};s['seen_variants']={'a':['bad']}
        with self.assertRaisesRegex(ValueError,'ISSUE_STATE_HISTORY_INVALID'):c.state_from_issue(body(s))
    def test_54_shared_public_notification_budget(self): self.assertEqual(c.MAX_NOTICES,2)

if __name__ == '__main__':
    unittest.main(verbosity=2)
