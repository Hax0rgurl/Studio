"""Bundled adapters for the shared Studio producer. One transaction per crew handoff."""
from contextlib import contextmanager
from http.client import HTTPSConnection
from urllib.request import HTTPSHandler, HTTPRedirectHandler, build_opener
import hashlib
import sqlite3
import uuid
from datetime import datetime, timezone

MEDIA = ROOT.parent / 'Productions'
BASE = 'https://token-plan.maas.qwencloudapi.com'
def safe_id(value):
    if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,125}', value) or value in ('.','..'):
        raise ValueError('Invalid production identifier')
    return value

def reserve_submission(receipt, evidence):
    with receipt.open('x') as marker:
        json.dump(dict(evidence, submitting=True, submissionId=str(uuid.uuid4())), marker)
        marker.flush()
        os.fsync(marker.fileno())


def qwen_admission(url, body, headers, reserve):
    # urllib still handles the system proxy. Its CONNECT tunnel and TLS
    # handshake finish before the generation request can leave this Mac.
    class Connection(HTTPSConnection):
        def connect(self):
            try:
                super().connect()
            except OSError as error:
                raise ConnectionError('Connection unavailable before submission. No generation request was sent.') from error
            try:
                reserve()
            except BaseException:
                self.close()
                raise

    class AdmissionHandler(HTTPSHandler):
        def https_open(self, req):
            return self.do_open(Connection, req, context=self._context)

    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = build_opener(AdmissionHandler(), NoRedirect())
    req = Request(url, data=json.dumps(body).encode(), headers={'Content-Type':'application/json', **headers})
    try:
        with opener.open(req, timeout=180) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f'{urlsplit(url).hostname} returned HTTP {error.code}') from None


@contextmanager
def shot_lock(receipt):
    with receipt.with_suffix('.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another worker owns this shot submission. Try again after its receipt arrives.') from None
        yield


def uncertain_photo(receipt):
    if not receipt.is_file():
        return None
    raw = receipt.read_bytes()
    record = json.loads(raw)
    if not record.get('submitting') or record.get('url') or record.get('id') or receipt.with_suffix('.jpg').exists():
        return None
    return dict(receipt=receipt.name, shotId=record['shotId'], digest=hashlib.sha256(raw).hexdigest())


def photo_recovery(action, data):
    folder = MEDIA / safe_id(data['runId'])
    if action=='uncertain_photos':
        return [row for receipt in sorted(folder.glob('still-*.json')) if (row:=uncertain_photo(receipt))]
    name = safe_id(data['receipt'])
    if not name.startswith('still-') or not name.endswith('.json') or data.get('approved') is not True:
        raise ValueError('Select and authorize one missing storyboard photo.')
    receipt = folder / name
    with shot_lock(receipt):
        row = uncertain_photo(receipt)
        if not row or row['digest']!=data['digest'] or row['shotId']!=data['shotId']:
            raise ValueError('This shot receipt changed. Refresh the booking before authorizing another attempt.')
        archive = folder / 'unconfirmed-attempts'
        archive.mkdir(exist_ok=True)
        receipt.rename(archive / (row['digest']+'.json'))
    return True


def room(action, r, owner):
    MEDIA.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(MEDIA/'crew.sqlite',timeout=15)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS threads (project TEXT PRIMARY KEY, thread TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS messages (thread TEXT, k TEXT, body TEXT, PRIMARY KEY(thread,k));
    CREATE TABLE IF NOT EXISTS leases (thread TEXT,k TEXT,role TEXT,id TEXT,owner TEXT,until REAL,status TEXT,PRIMARY KEY(thread,k));
    """)
    with db:
        db.execute('BEGIN IMMEDIATE')
        project=safe_id(r['projectId'])
        found=db.execute('select thread from threads where project=?',(project,)).fetchone()
        if action=='open_production_thread':
            thread=found[0] if found else str(uuid.uuid4())
            db.execute('insert or ignore into threads values(?,?)',(project,thread))
            return dict(projectId=project,created=not found,thread=dict(id=thread))
        thread=r['threadId']
        if not found or found[0]!=thread:raise ValueError('Conversation belongs to a different project')
        if action=='fetch_production_thread':
            return dict(messages=[json.loads(v) for v, in db.execute('select body from messages where thread=? order by rowid',(thread,))])
        message={}
        if action in ('send_conversation','post_role_step'):
            event=action=='send_conversation'
            k=r['eventId' if event else 'stepId']
            message=dict(id=str(uuid.uuid4()),summary=('[studio-event:' if event else '[studio:')+k+'] '+r['summary'],details=r['details'],author=r.get('fromRoleId',r.get('roleId')),intent=r.get('intent','fyi'),action_requested=r.get('actionRequested',''),created_at=datetime.now(timezone.utc).isoformat())
            db.execute('insert or ignore into messages values(?,?,?)',(thread,k,json.dumps(message)))
            message=json.loads(db.execute('select body from messages where thread=? and k=?',(thread,k)).fetchone()[0])
            if not event:return message
        k=r.get('eventId') or r['workId']
        role=r.get('toRoleId') or r['roleId']
        row=db.execute('select role,id,owner,until,status from leases where thread=? and k=?',(thread,k)).fetchone()
        now=time.time()
        def owns_live_lease():
            if not row or row[2]==owner or row[3]<=now:return False
            pid=row[2].partition(':')[0]
            if pid.isdecimal():
                try:os.kill(int(pid),0)
                except ProcessLookupError:return False
            return True
        if action in ('claim_role_work','send_conversation'):
            if row and (row[0]!=role or (row[4]=='claimed' and owns_live_lease())):
                raise ValueError('Another worker owns this assignment')
            ident=row[1] if row else str(uuid.uuid4())
            status=row[4] if row and row[4]=='acknowledged' else 'claimed'
            db.execute('insert or replace into leases values(?,?,?,?,?,?,?)',(thread,k,role,ident,owner,now+120,status))
            return dict(delivery=dict(id=ident,status=status),message=message,reused=bool(row),hostId=owner)
        if not row or (role,r['deliveryId'])!=row[:2] or owns_live_lease():raise ValueError('Assignment ownership changed')
        status={'renew_role_work':'claimed','ack_role_work':'acknowledged','release_role_work':'released','ack_conversation':'acknowledged','release_conversation':'released'}[action]
        db.execute('update leases set until=?,status=? where thread=? and k=?',(now+120,status,thread,k))
        return dict(id=row[1],status=status)

def prompt_fingerprint(prompt):
    value = 2166136261
    encoded = prompt.encode('utf-16-le', errors='surrogatepass')
    for offset in range(0, len(encoded), 2):
        unit = int.from_bytes(encoded[offset:offset+2], 'little')
        value = ((value ^ unit) * 16777619) & 0xffffffff
    return f'fnv1a-{value:08x}'

def qwen_headers():
    token = credential(b'Studio.QwenTokenPlan')
    if not token:
        raise ValueError('Add your Qwen Token Plan key in Settings')
    return {'Authorization':'Bearer '+token}

def adapter(call):
    action=call['action'];r=call['data']
    if action in ('uncertain_photos','authorize_photo_retry'):return photo_recovery(action,r)
    if action.startswith('room/'):return room(action[5:],r,call['owner'])
    if action=='health':
        MEDIA.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(MEDIA/'crew.sqlite') as db:db.execute('select 1')
        return True
    if action=='chat':
        body={k:r[k] for k in ('messages','model','temperature','max_tokens') if k in r}
        if body['model'] not in ('qwen3.8-max','qwen4-max'):raise ValueError('Unknown crew model')
        if r.get('json'):body['response_format']={'type':'json_object'}
        return request(BASE+'/compatible-mode/v1/chat/completions',{**body,'enable_thinking':False},qwen_headers(),timeout=600)['choices'][0]['message']['content']
    FF=str(Path(sys.executable).absolute().parents[2]/'ffmpeg')
    def folder(run):
        path=MEDIA/safe_id(run);path.mkdir(parents=True,exist_ok=True);return path
    if action=='screen':
        path=MEDIA/safe_id(r['runId'])/'cut.mp4'
        if not path.is_file():raise ValueError('The finished cut is missing from this Mac')
        info=subprocess.run([FF,'-hide_banner','-i',str(path)],capture_output=True,text=True)
        stamp=re.search(r'Duration: (\d+):(\d+):([\d.]+)',info.stderr)
        if not stamp:raise ValueError('The cut has no readable duration')
        duration=int(stamp[1])*3600+int(stamp[2])*60+float(stamp[3])
        stamps=[round(duration*f,2) for f in (.1,.4,.6,.9)]
        images=[base64.b64encode(subprocess.check_output([FF,'-v','error','-ss',str(t),'-i',str(path),'-frames:v','1','-vf','scale=480:-2','-f','image2pipe','-c:v','mjpeg','-'])).decode() for t in stamps]
        if not all(images):raise ValueError('A screening frame did not decode')
        return dict(images=images,seconds=stamps)
    path=folder(r['runId'])
    if action=='/api/video/assemble':
        files=[path/(safe_id(k)+'.mp4') for k in r['ids']]
        if not files or not all(f.is_file() for f in files):raise ValueError('Missing circled take')
        listing=path/'edit.txt';listing.write_text(''.join("file '"+f.name+"'\n" for f in files))
        out=path/'assembling.mp4'
        subprocess.run([FF,'-v','error','-y','-f','concat','-safe','1','-i',str(listing),'-c','copy','-movflags','+faststart',str(out)],check=True)
        out.replace(path/'cut.mp4')
        return dict(outputPath=str(path/'cut.mp4'))
    plugin=r.get('renderer')
    client=(VideoAPI(plugin) if plugin.get('kind')=='api' else Plugin(plugin['url'])) if plugin else None
    if action=='/api/video/jobs':
        jobs=[]
        for k in r['ids']:
            k=safe_id(k);clip=path/(k+'.mp4')
            if not clip.exists():
                if client:
                    receipt=path/(k+'.plugin.json')
                    job=json.loads(receipt.read_text());url=job.get('video')
                    if not url:
                        reply=client.call(plugin['poll'],{plugin['jobArg']:job['id']})
                        url=field(reply,plugin['video'])
                        if url:job['video']=url;save(receipt,job)
                        elif str(reply.get('status','')).lower() in ('failed','error','cancelled'):
                            jobs.append(dict(id=k,status='failed',error='Plugin render failed'));continue
                    out={'task_status':'SUCCEEDED' if url else 'RUNNING','video_url':url}
                else:out=request(BASE+'/api/v1/tasks/'+k,headers=qwen_headers())['output']
                phase=out['task_status']
                if phase=='SUCCEEDED':
                    url=out['video_url']
                    if urlsplit(url).scheme!='https':raise ValueError('Invalid video URL')
                    with urlopen(url,timeout=150) as resp,clip.with_suffix('.part').open('wb') as dest:shutil.copyfileobj(resp,dest)
                    clip.with_suffix('.part').replace(clip)
                elif phase in ('RUNNING','PENDING'):jobs.append(dict(id=k,status='running'));continue
                else:jobs.append(dict(id=k,status='failed',error=phase));continue
            jobs.append(dict(id=k,status='done',outputPath=str(clip)))
        return dict(jobs=jobs)
    still=action=='/api/image/generate'
    if not still and action!='/api/video/queue-batch':raise ValueError('Unknown production operation')
    spec=r if still else r['shots'][0]
    if r.get('billingApproval')!={'approved':True,'providerId':r['providerId']} or spec['review']['gate']!='approved':raise ValueError('Missing production approval')
    if spec['review'].get('promptFingerprint')!=prompt_fingerprint(spec['prompt']):
        raise ValueError('The prompt changed after review. A fresh sign-off is required.')
    if spec['review'].get('craft',{}).get('verdict')!='pass' or spec['review'].get('taste',{}).get('verdict')=='kill':
        raise ValueError('A department review still blocks this shot.')
    ident=safe_id(spec['studioShotId'])+'-'+str(int(spec.get('attempt',1)))
    receipt=path/(('still-' if still else 'video-')+ident+'.json')
    fingerprint=spec['review']['promptFingerprint']
    evidence=dict(fingerprint=fingerprint,shotId=spec['studioShotId'],provider=r['providerId'],model=spec.get('model') or r.get('model'),review=spec['review'])
    if not still:
        header,encoded=spec['imageDataUrl'].split(',',1)
        if not header.startswith('data:image/') or not header.endswith(';base64'):raise ValueError('Missing approved storyboard photo')
        evidence['frameSha256']=hashlib.sha256(base64.b64decode(encoded,validate=True)).hexdigest()
    with shot_lock(receipt):
        if not receipt.exists():
            def reserve():
                reserve_submission(receipt, evidence)
            if still:
                reply=qwen_admission(BASE+'/api/v1/services/aigc/multimodal-generation/generation',dict(model='qwen-image-3.0-pro',input={'messages':[{'role':'user','content':[{'text':spec['prompt']}]}]},parameters={'size':'1280*720'}),qwen_headers(),reserve)
                save(receipt,dict(evidence,url=reply['output']['choices'][0]['message']['content'][0]['image']))
            elif client:
                reserve()
                args={**plugin.get('args',{}),plugin['prompt']:spec['prompt'],plugin['frameArg']:spec['imageDataUrl']}
                reply=client.call(plugin['tool'],args)
                job=dict(video=field(reply,plugin['video']),id=field(reply,plugin['job']) if plugin.get('job') else None)
                if not job['video'] and not (job['id'] and plugin.get('poll')):raise ValueError('Missing renderer receipt')
                k=str(uuid.uuid4());save(path/(k+'.plugin.json'),job);save(receipt,dict(evidence,id=k))
            else:
                reply=qwen_admission(BASE+'/api/v1/services/aigc/video-generation/video-synthesis',dict(model=MODEL,input={'prompt':spec['prompt'],'media':[{'type':'first_frame','url':spec['imageDataUrl']}]},parameters={'resolution':'720P','ratio':'16:9','duration':5}),{**qwen_headers(),'X-DashScope-Async':'enable'},reserve)
                save(receipt,dict(evidence,id=reply['output']['task_id']))
        record=json.loads(receipt.read_text())
        if record.get('fingerprint',fingerprint)!=fingerprint:raise ValueError('A different approved prompt already owns this attempt.')
        if not still and record.get('frameSha256',evidence['frameSha256'])!=evidence['frameSha256']:raise ValueError('The storyboard photo changed after submission.')
        if record.get('submitting'):raise ValueError('Submission interrupted before provider receipt. Check provider history.')
        if not still:return dict(results=[record])
        frame=receipt.with_suffix('.jpg')
        if not frame.exists():
            if urlsplit(record['url']).scheme!='https':raise ValueError('Invalid image URL')
            with urlopen(record['url'],timeout=150) as resp:
                subprocess.run([FF,'-v','error','-y','-i','pipe:0','-frames:v','1',str(frame.with_suffix('.tmp.jpg'))],input=resp.read(),check=True)
            frame.with_suffix('.tmp.jpg').replace(frame)
        return dict(imageDataUrl='data:image/jpeg;base64,'+base64.b64encode(frame.read_bytes()).decode(),outputPath=str(frame))

try:print(json.dumps({'value':adapter(json.load(sys.stdin))}))
except Exception as error:print(json.dumps({'error':str(error)[:500]}))
