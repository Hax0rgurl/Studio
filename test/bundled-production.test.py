"""Exercise the same bundled adapters as the desktop bridge without a provider charge."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

source = Path(__file__).resolve().parents[1] / 'src-tauri' / 'double-feature'
runtime = {}
exec((source / 'crew.py').read_text().split("if __name__==")[0], runtime)
exec((source / 'production.py').read_text().split('try:print(json.dumps')[0], runtime)


class ProductionAdapters(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        runtime['MEDIA'] = Path(directory.name)
        runtime['credential'] = lambda service: 'test-only'

    def test_exclusive_assignment_and_reopen(self):
        room = runtime['room']
        project = {'projectId': 'film-one'}
        thread = room('open_production_thread', project, 'studio-A')['thread']
        self.assertEqual(room('open_production_thread', project, 'studio-B')['thread'], thread)
        work = dict(project, threadId=thread['id'], roleId='writer', workId='script')
        delivery = room('claim_role_work', work, 'studio-A')['delivery']
        with self.assertRaisesRegex(ValueError, 'Another worker'):
            room('claim_role_work', work, 'studio-B')
        with self.assertRaisesRegex(ValueError, 'different project'):
            room('fetch_production_thread', dict(work, projectId='film-two'), 'studio-A')
        room('ack_role_work', dict(work, deliveryId=delivery['id']), 'studio-A')
        self.assertEqual(room('claim_role_work', work, 'studio-A')['delivery']['status'], 'acknowledged')

    def test_review_gate_and_idempotent_video(self):
        calls = []
        def request(url, data=None, headers=None):
            calls.append(data)
            return {'output': {'task_id': 'real-provider-id'}}
        runtime['request'] = request
        shot = {'studioShotId': 's1', 'prompt': 'Saved prompt', 'review': {'gate': 'blocked'},
                'imageDataUrl': 'data:image/jpeg;base64,TEST'}
        payload = {'action': '/api/video/queue-batch', 'data': {'shots': [shot], 'runId': 'one',
                   'providerId': 'studio-wan', 'billingApproval': {'approved': True, 'providerId': 'studio-wan'}}}
        adapter = runtime['adapter']
        with self.assertRaisesRegex(ValueError, 'approval'):
            adapter(payload)
        self.assertEqual(calls, [])
        shot['review'].update(gate='approved', craft={'verdict':'pass'}, promptFingerprint='wrong')
        with self.assertRaisesRegex(ValueError, 'changed after review'):
            adapter(payload)
        self.assertEqual(calls, [])
        shot['review']['promptFingerprint'] = runtime['prompt_fingerprint'](shot['prompt'])
        first = adapter(payload)
        self.assertEqual(first, adapter(payload))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['input']['media'][0]['url'], shot['imageDataUrl'])

if __name__ == '__main__':
    unittest.main()
