"""Exercise the same bundled adapters as the desktop bridge without a provider charge."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

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

    def test_connection_failure_leaves_no_billable_attempt(self):
        target = runtime['MEDIA'] / 'still.json'
        reserve = lambda: runtime['reserve_submission'](target, {'shotId':'scene-1'})
        def exercise(fail_at):
            def open_request(req, timeout):
                handler = runtime['build_opener'].call_args.args[0]
                with patch.object(handler, 'do_open', side_effect=lambda cls, req, **kwargs: cls('localhost').connect()):
                    handler.https_open(req)
                raise TimeoutError('while waiting for provider reply')
            with patch.dict(runtime, build_opener=Mock()), patch.object(runtime['HTTPSConnection'], 'connect', side_effect=fail_at):
                runtime['build_opener'].return_value.open.side_effect = open_request
                return runtime['qwen_admission']('https://localhost/generate', {}, {}, reserve)
        with self.assertRaisesRegex(ConnectionError, 'before submission'):
            exercise(TimeoutError('TLS handshake'))
        self.assertFalse(target.exists())
        with self.assertRaisesRegex(TimeoutError, 'provider reply'):
            exercise(None)
        self.assertTrue(json.loads(target.read_text())['submitting'])
        with self.assertRaises(FileExistsError):
            exercise(None)

    def test_recovery_is_scoped_to_one_unconfirmed_photo(self):
        folder = runtime['MEDIA'] / 'film'
        folder.mkdir()
        pending = folder / 'still-s1-1.json'
        runtime['reserve_submission'](pending, {'shotId':'s1'})
        (folder/'still-s2-1.json').write_text(json.dumps({'shotId':'s2','url':'https://example.invalid/frame'}))
        data = {'runId':'film'}
        recovery = runtime['photo_recovery']
        [row] = recovery('uncertain_photos',data)
        args = dict(data, **row, approved=True)
        with self.assertRaisesRegex(ValueError, 'authorize'):
            recovery('authorize_photo_retry',dict(args, approved=False))
        with runtime['shot_lock'](pending), self.assertRaisesRegex(ValueError, 'Another worker'):
            recovery('authorize_photo_retry',args)
        with self.assertRaisesRegex(ValueError, 'changed'):
            recovery('authorize_photo_retry',dict(args, digest='stale'))
        self.assertTrue(recovery('authorize_photo_retry',args))
        self.assertFalse(pending.exists())
        self.assertTrue((folder/'unconfirmed-attempts'/(row['digest']+'.json')).exists())
        runtime['reserve_submission'](pending, {'shotId':'s1'})
        with self.assertRaisesRegex(ValueError, 'changed'):
            recovery('authorize_photo_retry',args)

    def test_review_gate_and_idempotent_video(self):
        calls = []
        def request(url, data, headers, reserve):
            reserve()
            calls.append(data)
            return {'output': {'task_id': 'real-provider-id'}}
        original = runtime['qwen_admission']
        self.addCleanup(runtime.__setitem__, 'qwen_admission', original)
        runtime['qwen_admission'] = request
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
