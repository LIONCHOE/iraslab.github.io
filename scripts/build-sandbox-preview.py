"""개인 Pages 경로용 산출물 생성. 원본 수정·외부 요청·기존 산출물 덮어쓰기 없음."""
import argparse
from datetime import datetime
import hashlib
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path, PurePosixPath
import re
import subprocess
from urllib.parse import unquote, urlsplit
import uuid

BASE = Path(__file__).resolve().parent
SOURCE = BASE.parent / 'iras-admin-work-target-isolation'
OUTPUT = BASE / 'sandbox-preview'
PREFIX = '/iraslab.github.io/'
ROOT_FILES = {
    '.nojekyll', 'index.html', '404.html', 'branding.css', 'visitor-counter.css',
    'visitor-counter.js', 'apple-touch-icon.png', 'favicon-32.png', 'favicon.ico',
    'favicon.svg', 'icon-192.png', 'icon-512.png', 'iras-logo.svg', 'postech-logo.png',
    'postech-logo.svg', 'postech-wordmark.jpg',
    *(f'research-domain-{i}.svg' for i in range(1, 6)),
}
PAGES = {'contact', 'figures', 'lab-life', 'news', 'people', 'projects', 'publications', 'research'}
ADMIN = {'admin/admin.js', 'admin/admin.css', 'admin/index.html', 'admin/content-rules.js', 'admin/environment.js'}
ASSET_TYPES = {'.css', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.woff2', '.ico'}
URL_ATTRS = {'href', 'src', 'poster', 'action', 'data-photo', 'data-full', *(f'data-d{i}-image' for i in range(1, 6))}
ATTR = re.compile(r'''(?P<key>[\w:-]+)(?P<eq>\s*=\s*)(?P<q>["'])(?P<val>.*?)(?P=q)''', re.S)
CSS_URL = re.compile(r'''(url\(\s*)(["']?)([^\s)'"]+)(\2\s*\))''', re.I)
SCRIPT_ASSET = re.compile(r'''(["'])(/(?:_astro|images)/[^"'\s]*)(\1)''')


def allowed(name):
    p = PurePosixPath(name)
    if p.is_absolute() or any(x in {'.', '..'} for x in p.parts):
        return False
    if name in ROOT_FILES or name in ADMIN:
        return True
    if len(p.parts) == 2 and p.parts[0] in PAGES and p.name == 'index.html':
        return True
    if len(p.parts) == 3 and p.parts[0] == 'people' and p.name == 'index.html':
        return bool(re.fullmatch('[a-z0-9-]+', p.parts[1]))
    return (p.parts[0] == '_astro' or p.parts[:2] == ('images', 'admin')) and p.suffix.lower() in ASSET_TYPES


def url(value):
    if value.startswith('/') and not value.startswith('//') and not value.startswith(PREFIX):
        return PREFIX + value[1:]
    return value


def srcset(value):
    # URL 중간의 쉼표/data URL은 그대로 두고 루트 상대 후보만 보정합니다.
    return re.sub(r'(^|,\s*)(/(?!/)[^\s,]+)', lambda m: m[1] + url(m[2]), value)


def css(text):
    return CSS_URL.sub(lambda m: m[1] + m[2] + url(m[3]) + m[4], text)


class HTMLPaths(HTMLParser):
    """원본 HTML을 다시 직렬화하지 않고 경로 값만 치환합니다."""
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.offsets = [0]
        for m in re.finditer('\n', text):
            self.offsets.append(m.end())
        self.edits = []
        self.raw_tag = None

    def edit(self, old, new):
        if old != new:
            line, col = self.getpos()
            offset = self.offsets[line - 1] + col
            self.edits.append((offset, offset + len(old), new))

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text()
        def replace(m):
            key, value = m['key'].lower(), m['val']
            if key in URL_ATTRS:
                value = url(value)
            elif key == 'srcset':
                value = srcset(value)
            elif key == 'style':
                value = css(value)
            return m['key'] + m['eq'] + m['q'] + value + m['q']
        self.edit(raw, ATTR.sub(replace, raw))
        if tag in {'script', 'style'}:
            self.raw_tag = tag

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        if tag == self.raw_tag:
            self.raw_tag = None

    def handle_data(self, data):
        if self.raw_tag == 'script':
            self.edit(data, SCRIPT_ASSET.sub(lambda m: m[1] + url(m[2]) + m[3], data))
        elif self.raw_tag == 'style':
            self.edit(data, css(data))

    def transformed(self):
        self.feed(self.text)
        result = self.text
        for start, end, replacement in reversed(self.edits):
            result = result[:start] + replacement + result[end:]
        return result


def transform(name, data):
    # 관리자 파서/정책/저장 데이터는 배포 원본과 동일해야 합니다.
    if name in ADMIN or name == 'visitor-counter.js':
        return data
    if name.endswith('.html'):
        return HTMLPaths(data.decode('utf-8')).transformed().encode('utf-8')
    if name.endswith('.css'):
        return css(data.decode('utf-8')).encode('utf-8')
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_source(name):
    if not allowed(name):
        raise ValueError('공개 파일 허용 목록 밖의 경로')
    path = SOURCE / name
    if not path.resolve().is_relative_to(SOURCE.resolve()):
        raise ValueError('원본 경로 범위 이탈')
    if any(p.is_symlink() for p in [path, *path.parents] if p.is_relative_to(SOURCE)):
        raise ValueError('심볼릭 링크는 복사하지 않습니다')
    return path


def build():
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=SOURCE, text=True).strip()).resolve()
    if root != SOURCE.resolve():
        raise ValueError('원본은 Git 작업 트리의 최상위 폴더여야 합니다')
    if OUTPUT.resolve().is_relative_to(SOURCE.resolve()):
        raise ValueError('산출물은 원본 작업 트리 밖에 생성해야 합니다')
    if any(p.is_symlink() for p in [OUTPUT, *OUTPUT.parents]):
        raise ValueError('산출물 경로에 심볼릭 링크를 사용할 수 없습니다')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=SOURCE).decode('utf-8').split('\0')
    names = sorted({n for n in tracked if n and allowed(n)} | ADMIN)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    directory = OUTPUT / ('build-' + stamp + '-' + uuid.uuid4().hex[:8])
    if not directory.resolve().is_relative_to(OUTPUT.resolve()):
        raise ValueError('산출물 경로 범위 이탈')
    site = directory / PREFIX.strip('/')
    site.mkdir(parents=True, exist_ok=False)
    records = []
    for name in names:
        before = checked_source(name).read_bytes()
        after = transform(name, before)
        destination = site / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as stream:
            stream.write(after)
        records.append({'path': name, 'sourceSha256': digest(before), 'outputSha256': digest(after), 'changed': before != after})
    for record in records:
        if digest(checked_source(record['path']).read_bytes()) != record['sourceSha256']:
            raise RuntimeError('생성 중 원본 변경 감지. 산출물을 배포하지 마세요.')
    manifest = {'schema': 1, 'baseHead': head, 'prefix': PREFIX, 'site': PREFIX.strip('/'),
                'note': 'baseHead는 원본 HEAD입니다. 미커밋 변경 포함 여부는 별도 확인하며 파일 대응은 SHA-256으로 확인합니다.', 'files': records}
    with (directory / 'manifest.json').open('x', encoding='utf-8') as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
    return directory


def serve(build_id, port):
    if not re.fullmatch(r'build-\d{8}-\d{6}-[a-f0-9]{8}', build_id):
        raise ValueError('유효하지 않은 산출물 이름')
    directory = OUTPUT / build_id
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    names = {record['path'] for record in manifest['files']}
    site = (directory / manifest['site']).resolve()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            route = unquote(urlsplit(self.path).path)
            if not route.startswith(PREFIX):
                return self.send_error(404)
            name = route[len(PREFIX):]
            if name + '/index.html' in names:
                self.send_response(301)
                self.send_header('Location', PREFIX + name + '/')
                self.end_headers()
                return
            if not name or name.endswith('/'):
                name += 'index.html'
            if name not in names or not allowed(name):
                return self.send_error(404)
            path = (site / name).resolve()
            if not path.is_relative_to(site):
                return self.send_error(404)
            data = path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'application/octet-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "connect-src 'self'; object-src 'none'")
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'개인 경로 산출물 미리보기: http://localhost:{server.server_address[1]}{PREFIX}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='생성 경로를 JSON으로 출력')
    parser.add_argument('--samples', action='store_true', help='표준입력 JSON의 변환 사례 검사')
    parser.add_argument('--serve', metavar='BUILD_ID', help='기존 산출물 loopback 미리보기')
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--source', type=Path, default=SOURCE, help='원본 Git 작업 트리')
    parser.add_argument('--output-root', type=Path, default=OUTPUT, help='원본 밖의 산출물 폴더')
    args = parser.parse_args()
    SOURCE = args.source.resolve()
    OUTPUT = args.output_root.absolute()
    if args.samples:
        import sys
        values = json.load(sys.stdin)
        print(json.dumps([transform(v['path'], v['text'].encode()).decode() for v in values], ensure_ascii=False))
    elif args.serve:
        serve(args.serve, args.port)
    else:
        output = build()
        print(json.dumps({'build': str(output), 'id': output.name, 'site': str(output / PREFIX.strip('/')), 'manifest': str(output / 'manifest.json')}, ensure_ascii=False) if args.json else '산출물 생성 완료: ' + str(output))
