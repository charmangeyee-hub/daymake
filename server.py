#!/usr/bin/env python3
"""
Tasks PWA — static file server + Web Push backend.

Runs everything on one port:
  • serves the PWA (index.html, app.js, …)
  • /api/vapid  -> the public VAPID key the browser subscribes with
  • /api/sync   -> store a push subscription + that device's habit reminder schedule
  • /api/test   -> send an immediate test push
A background thread delivers a push at each habit's reminder time every day,
so reminders arrive even when the app (and browser tab) is closed.

Requires: pip install pywebpush py-vapid cryptography
Run:      python3 server.py   then open http://localhost:4599
"""
import json, os, threading, time, base64, functools, hashlib, secrets
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from pywebpush import webpush, WebPushException

ROOT = os.path.dirname(os.path.abspath(__file__))
VAPID_FILE = os.path.join(ROOT, 'vapid.json')
PRIV_PEM = os.path.join(ROOT, 'vapid_private.pem')
STORE_FILE = os.path.join(ROOT, 'push_store.json')
USERS_FILE = os.path.join(ROOT, 'users.json')
SESSIONS_FILE = os.path.join(ROOT, 'sessions.json')
DATA_FILE = os.path.join(ROOT, 'user_data.json')
SUBJECT = 'mailto:admin@localhost'
PORT = 4599

lock = threading.Lock()


# ---------- tiny JSON persistence ----------
def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f)


# ---------- accounts ----------
users = load_json(USERS_FILE, {})        # { email: {salt, hash, created} }
sessions = load_json(SESSIONS_FILE, {})  # { token: email }
userdata = load_json(DATA_FILE, {})      # { email: {tasks, habits, events, profile} }


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200_000)
    return salt, h.hex()


def verify_password(password, salt, expected):
    _, h = hash_password(password, salt)
    return secrets.compare_digest(h, expected)


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def load_or_create_vapid():
    """Load the VAPID keypair, or generate one on first run."""
    if os.path.exists(VAPID_FILE) and os.path.exists(PRIV_PEM):
        with open(VAPID_FILE) as f:
            return json.load(f)
    priv = ec.generate_private_key(ec.SECP256R1())
    pem = priv.private_bytes(serialization.Encoding.PEM,
                             serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())
    with open(PRIV_PEM, 'wb') as f:
        f.write(pem)
    pub = priv.public_key().public_bytes(serialization.Encoding.X962,
                                          serialization.PublicFormat.UncompressedPoint)
    data = {'public_key': b64url(pub)}
    with open(VAPID_FILE, 'w') as f:
        json.dump(data, f)
    print('Generated a new VAPID keypair.')
    return data


VAPID = load_or_create_vapid()


def load_store():
    try:
        with open(STORE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_store(s):
    with open(STORE_FILE, 'w') as f:
        json.dump(s, f)


store = load_store()  # { endpoint: { subscription, reminders:[{time,tag,title,body}] } }


def send_push(sub, payload):
    webpush(subscription_info=sub, data=json.dumps(payload),
            vapid_private_key=PRIV_PEM, vapid_claims={'sub': SUBJECT})


def scheduler():
    """Every 20s, fire any reminder whose HH:MM == now (once per day per tag)."""
    sent = {}  # endpoint -> { tag: 'YYYY-MM-DD' }
    while True:
        now = datetime.now()
        hhmm = now.strftime('%H:%M')
        today = now.strftime('%Y-%m-%d')
        with lock:
            items = list(store.items())
        for endpoint, rec in items:
            for r in rec.get('reminders', []):
                if r.get('time') != hhmm:
                    continue
                tag = r.get('tag', '')
                if sent.get(endpoint, {}).get(tag) == today:
                    continue
                try:
                    send_push(rec['subscription'], {
                        'title': r.get('title', 'Reminder'),
                        'body': r.get('body', ''),
                        'tag': tag,
                    })
                    sent.setdefault(endpoint, {})[tag] = today
                    print(f'[push] sent "{r.get("title")}" @ {hhmm}')
                except WebPushException as e:
                    code = getattr(getattr(e, 'response', None), 'status_code', None)
                    if code in (404, 410):  # subscription expired -> drop it
                        with lock:
                            store.pop(endpoint, None)
                            save_store(store)
                        print('[push] removed expired subscription')
                except Exception as ex:
                    print('[push] error:', ex)
        time.sleep(20)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always revalidate during development so edits show up on reload.
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        return json.loads(self.rfile.read(length) or b'{}')

    def _auth_email(self):
        """Resolve the account email from the Bearer token, or None."""
        h = self.headers.get('Authorization', '')
        if not h.startswith('Bearer '):
            return None
        return sessions.get(h[7:])

    def do_GET(self):
        if self.path == '/api/vapid':
            return self._json(200, {'key': VAPID['public_key']})
        if self.path == '/api/data':
            email = self._auth_email()
            if not email:
                return self._json(401, {'error': 'unauthorized'})
            return self._json(200, {'data': userdata.get(email, {})})
        return super().do_GET()

    def do_PUT(self):
        if self.path == '/api/data':
            email = self._auth_email()
            if not email:
                return self._json(401, {'error': 'unauthorized'})
            body = self._body()
            with lock:
                userdata[email] = body.get('data', {})
                save_json(DATA_FILE, userdata)
            return self._json(200, {'ok': True})
        return self._json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path == '/api/signup':
            body = self._body()
            email = (body.get('email') or '').strip().lower()
            password = body.get('password') or ''
            if '@' not in email or '.' not in email:
                return self._json(400, {'error': 'Enter a valid email address'})
            if len(password) < 6:
                return self._json(400, {'error': 'Password must be at least 6 characters'})
            with lock:
                if email in users:
                    return self._json(409, {'error': 'An account with that email already exists'})
                salt, h = hash_password(password)
                users[email] = {'salt': salt, 'hash': h, 'created': datetime.now().isoformat()}
                save_json(USERS_FILE, users)
                token = secrets.token_urlsafe(32)
                sessions[token] = email
                save_json(SESSIONS_FILE, sessions)
            return self._json(200, {'token': token, 'email': email})

        if self.path == '/api/login':
            body = self._body()
            email = (body.get('email') or '').strip().lower()
            password = body.get('password') or ''
            u = users.get(email)
            if not u or not verify_password(password, u['salt'], u['hash']):
                return self._json(401, {'error': 'Wrong email or password'})
            with lock:
                token = secrets.token_urlsafe(32)
                sessions[token] = email
                save_json(SESSIONS_FILE, sessions)
            return self._json(200, {'token': token, 'email': email})

        if self.path == '/api/logout':
            h = self.headers.get('Authorization', '')
            if h.startswith('Bearer '):
                with lock:
                    sessions.pop(h[7:], None)
                    save_json(SESSIONS_FILE, sessions)
            return self._json(200, {'ok': True})

        if self.path == '/api/sync':
            body = self._body()
            sub = body.get('subscription')
            reminders = body.get('reminders', [])
            if not sub or 'endpoint' not in sub:
                return self._json(400, {'error': 'no subscription'})
            with lock:
                store[sub['endpoint']] = {'subscription': sub, 'reminders': reminders}
                save_store(store)
            return self._json(200, {'ok': True, 'count': len(reminders)})
        if self.path == '/api/test':
            body = self._body()
            sub = body.get('subscription')
            try:
                send_push(sub, {'title': '✅ Push connected',
                                'body': 'Reminders will arrive even when the app is closed.',
                                'tag': 'test'})
                return self._json(200, {'ok': True})
            except Exception as e:
                return self._json(500, {'error': str(e)})
        return self._json(404, {'error': 'not found'})

    def log_message(self, *a):
        pass  # keep the console quiet


def main():
    threading.Thread(target=scheduler, daemon=True).start()
    handler = functools.partial(Handler, directory=ROOT)
    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), handler)
    print(f'Tasks PWA + Push server → http://localhost:{PORT}')
    print('Leave this running to deliver reminders when the app is closed. Ctrl+C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')


if __name__ == '__main__':
    main()
