(() => {
  'use strict';

  const production = Object.freeze({mode:'production', label:'운영', repo:'iraslab/iraslab.github.io', branch:'main'});
  const sandbox = Object.freeze({mode:'sandbox', label:'개인 테스트', repo:'LIONCHOE/iraslab.github.io', branch:'admin/sandbox-content'});
  const adminPaths = ['/admin/', '/admin/index.html'];
  const contentFiles = ['people/index.html', 'publications/index.html', 'news/index.html', 'lab-life/index.html', 'index.html'];
  const isSha = value => /^[a-f0-9]{40}$/.test(value);

  function resolve(href) {
    const url = new URL(href);
    if (url.username || url.password) throw Error('인증정보가 포함된 관리자 주소는 사용할 수 없습니다.');
    if (url.protocol === 'https:' && url.hostname === 'iras.postech.ac.kr' && !url.port && adminPaths.includes(url.pathname)) return production;
    if (url.protocol === 'https:' && url.hostname === 'lionchoe.github.io' && !url.port && adminPaths.some(path => url.pathname === '/iraslab.github.io' + path)) return sandbox;
    if (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && adminPaths.includes(url.pathname)) return sandbox;
    throw Error('허용되지 않은 관리자 환경입니다. 저장소 연결과 게시를 차단했습니다.');
  }

  function assertReady(target, runtime) {
    if (target !== production && target !== sandbox) throw Error('관리자 대상 정책을 확인할 수 없습니다.');
    if (!runtime.isSecureContext || typeof runtime.crypto?.subtle?.digest !== 'function') throw Error('보안 기능이 필요한 관리자입니다. HTTPS 또는 안전한 localhost 환경에서 다시 여세요.');
    for (const name of ['fetch', 'TextEncoder', 'TextDecoder', 'DOMParser']) {
      if (typeof runtime[name] !== 'function') throw Error('관리자 실행에 필요한 브라우저 기능이 없습니다: ' + name);
    }
  }

  function assertRequest(target, path, options = {}) {
    if (target !== production && target !== sandbox) throw Error('허용되지 않은 저장소 정책입니다.');
    const method = (options.method || 'GET').toUpperCase();
    const prefix = '/repos/' + target.repo;
    if (method === 'GET') {
      if (path === '/user' || path === prefix || path === prefix + '/git/ref/heads/' + target.branch) return;
      if (path.startsWith(prefix + '/contents/')) {
        const suffix = path.slice((prefix + '/contents/').length);
        const separator = suffix.indexOf('?');
        const file = suffix.slice(0, separator);
        const query = separator >= 0 ? new URLSearchParams(suffix.slice(separator + 1)) : null;
        if (contentFiles.includes(file) && query && [...query].length === 1 && query.has('ref') && (query.get('ref') === target.branch || isSha(query.get('ref')))) return;
      }
      if (path.startsWith(prefix + '/git/commits/') && isSha(path.slice((prefix + '/git/commits/').length))) return;
      if (path.startsWith(prefix + '/compare/')) {
        const parts = path.slice((prefix + '/compare/').length).split('...');
        if (parts.length === 2 && parts.every(isSha)) return;
      }
    }
    if (method === 'POST' && ['blobs', 'trees', 'commits'].some(kind => path === prefix + '/git/' + kind)) return;
    if (method === 'PATCH' && path === prefix + '/git/refs/heads/' + target.branch) {
      let body;
      try { body = JSON.parse(options.body); } catch { throw Error('게시 요청 내용을 확인할 수 없습니다.'); }
      if (isSha(body?.sha) && body.force === false) return;
    }
    throw Error('허용되지 않은 GitHub 대상 또는 요청입니다. 요청을 전송하지 않았습니다.');
  }

  function previewUrl(href, photo) {
    resolve(href);
    if (photo.startsWith('/') && !photo.startsWith('//')) return new URL('../' + photo.slice(1), href).href;
    return photo;
  }

  window.IRASAdminEnvironment = Object.freeze({resolve, assertReady, assertRequest, previewUrl});
})();
