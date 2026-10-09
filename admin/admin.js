(() => {
  'use strict';
  const environment = window.IRASAdminEnvironment;
  let target = null;
  let REPO = '', BRANCH = '';
  const paths = {people:'people/index.html', publications:'publications/index.html', news:'news/index.html', 'lab-life':'lab-life/index.html'};
  const $ = (s,root=document) => root.querySelector(s);
  let token = '', page = 'people', source = '', sha = '', doc = null, selected = null, pending = null, user = '';
  const rules = window.IRASContentRules;
  const drafts = new Map(), images = new Map();
  const galleryCache = new WeakMap();
  let busy = false, formDirty = false, operationCount = 0;
  const serialize = d => '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const dirtyDrafts = () => [...drafts.entries()].filter(([, d]) => d.dirty);
  function updateDraftStatus() {
    const count = dirtyDrafts().length;
    $('#draft-count').textContent = count ? `${operationCount}건 변경 · ${count}개 페이지 업로드 대기` : '업로드할 변경사항 없음';
    $('#publish').disabled = busy || !count;
    $('#discard').disabled = busy || !count;
  }
  function setBusy(value) {
    busy = value;
    for (const control of document.querySelectorAll('#editor button, #editor input, #editor select, #editor textarea')) control.disabled = value;
    $('#editor').setAttribute('aria-busy', String(value));
    updateDraftStatus();
  }
  function guardForm() {
    return !formDirty || confirm('아직 변경사항에 반영하지 않은 입력이 있습니다. 이 입력을 취소하고 이동할까요?');
  }
  function clearImages() {
    for (const image of images.values()) URL.revokeObjectURL(image.preview);
    images.clear();
  }
  function stage() {
    if (page === 'people') rules.normalizePeople(doc);
    renumber();
    const state = drafts.get(paths[page]);
    state.doc = doc; state.dirty = true;
    operationCount++; render(); updateDraftStatus();
    status('변경사항에 반영했습니다. 상단의 변경사항 업로드를 누르면 게시됩니다.');
  }

  const status = (message,error=false) => { $('#status').textContent=message; $('#status').classList.toggle('error',error); };
  const safe = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0)));
  const encode = s => {const bytes=new TextEncoder().encode(s);let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);};
  async function api(path, options={}) {
    environment.assertReady(target, window);
    environment.assertRequest(target, path, options);
    const response = await fetch(`https://api.github.com${path}`, { ...options, headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})} });
    const body = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(body.message||`GitHub HTTP ${response.status}`);
    return body;
  }
  const contentPath = p => `/repos/${REPO}/contents/${p}`;
  const children = (parent, selector) => [...parent.children].filter(x=>x.matches(selector));
  function sections() {return [...doc.querySelectorAll('main section')].filter(s=>s.querySelector(':scope > h2') && s.querySelector(':scope > div'))}
  function grid(section){return section.querySelector(':scope > div')}
  function list(){if(page==='people')return sections().flatMap(s=>children(grid(s),'div').map(node=>({node,section:s.querySelector('h2').textContent.trim()})));
    if(page==='publications')return [...doc.querySelectorAll('li[data-pub]')].map(node=>({node}));
    return [...doc.querySelectorAll('main article')].map(node=>({node}));}
  function galleryScript(){return [...doc.querySelectorAll('script')].find(s=>s.textContent.includes('const lightboxData ='))}
  function gallery(){const s=galleryScript();const cached=galleryCache.get(doc);if(cached)return cached;const m=s&&s.textContent.match(/const lightboxData\s*=\s*(\[[\s\S]*?\]);/);if(!m)throw Error('사진 목록 데이터를 찾지 못했습니다.');const items=JSON.parse(m[1]);galleryCache.set(doc,items);return items;}
  function setGallery(items){galleryCache.set(doc,items);const s=galleryScript();s.textContent=s.textContent.replace(/const lightboxData\s*=\s*\[[\s\S]*?\];/,()=> 'const lightboxData = '+JSON.stringify(items).replace(/</g,'\\u003c')+';');}
  function data(item){const n=item.node;
    if(page==='people'){const trigger=$('[data-person-trigger]',n)||$('a',n);return {name:trigger?.dataset.name||$('h3',n)?.textContent.trim()||'',section:item.section,role:trigger?.dataset.role||$('p',n)?.textContent.trim()||'',title:trigger?.dataset.title||'',email:trigger?.dataset.email||'',photo:trigger?.dataset.photo||$('img',n)?.getAttribute('src')||'',affiliation:$('.alumni-affiliation',n)?.textContent.trim()||''};}
    if(page==='publications')return {title:$('p',n)?.textContent.trim()||'',citation:$('p + p',n)?.textContent.trim()||'',type:n.dataset.pubType||'',year:n.dataset.pubYear||'',month:String(rules.publicationDate(n).month || '')};
    const index=page==='lab-life'?Number(n.querySelector('[data-item-index]')?.dataset.itemIndex):-1;
    const g=page==='lab-life'?gallery()[index]:null;
    return {title:$('h3',n)?.textContent.trim()||'',date:$('p.text-sm',n)?.textContent.trim()||'',description:page==='lab-life'?($('h3 + p',n)?.textContent.trim()||''):'',photo:g?.images?.[0]||$('[data-lightbox]',n)?.dataset.full||$('img',n)?.getAttribute('src')||'',photos:g?.images?.join('\n')||[...n.querySelectorAll('[data-lightbox]')].map(b=>b.dataset.full).join('\n'),index};
  }
  function render(){const q=$('#search').value.toLowerCase().trim();const items=list().filter(x=>!q||JSON.stringify(data(x)).toLowerCase().includes(q));$('#count').textContent=`${items.length}개 항목`;
    $('#items').replaceChildren(...items.map(item=>{const d=data(item);const row=document.createElement('div');row.className='item';const image=document.createElement('img');image.src=images.get(d.photo)?.preview||environment.previewUrl(window.location.href,d.photo||'');image.alt='';image.onerror=()=>image.removeAttribute('src');const body=document.createElement('div');body.innerHTML=`<strong>${safe(d.name||d.title)}</strong><small>${safe(d.section||d.type||d.date)} ${safe(d.role||d.year||'')}</small>`;const actions=document.createElement('div');actions.className='actions';for(const [label,fn,cls] of [['수정',()=>form(item)],['↑',()=>move(item,-1)],['↓',()=>move(item,1)],['삭제',()=>remove(item),'danger']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=cls||'';b.onclick=fn;actions.append(b)}row.append(image,body,actions);return row}));}
  const types=rules.types;
  function fields(){if(page==='people')return [{key:'name',label:'이름',required:true},{key:'section',label:'섹션',options:sections().map(s=>s.querySelector('h2').textContent.trim())},{key:'role',label:'직책 / 학위'},{key:'title',label:'연구 분야 / 상세 정보'},{key:'email',label:'이메일'},{key:'affiliation',label:'졸업생 소속'},{key:'photo',label:'사진 주소',placeholder:'/_astro/... 또는 업로드'}];
    if(page==='publications')return [{key:'title',label:'논문 제목',required:true},{key:'citation',label:'서지 정보',multiline:true,required:true},{key:'type',label:'분류',options:types},{key:'year',label:'연도',required:true},{key:'month',label:'월 (1–12, 모르면 비워두기)',placeholder:'예: 9'}];
    if(page==='news')return [{key:'title',label:'제목',required:true},{key:'date',label:'게시 날짜',required:true,placeholder:'October 6, 2026'},{key:'photos',label:'사진 주소 (한 줄에 하나)',multiline:true}];
    return [{key:'title',label:'제목',required:true},{key:'date',label:'게시 날짜',required:true},{key:'description',label:'본문',multiline:true},{key:'photos',label:'사진 주소 (한 줄에 하나)',multiline:true,placeholder:'/_astro/photo-1.jpg'}];}
  function form(item=null){if(busy||!guardForm())return;formDirty=false;selected=item;pending=null;const d=item?data(item):{};$('#form-title').textContent=item?'항목 수정':'새 항목 추가';$('#fields').replaceChildren(...fields().map(f=>{const label=document.createElement('label');label.textContent=f.label;let control;if(f.options){control=document.createElement('select');for(const opt of f.options){const o=document.createElement('option');o.value=o.textContent=opt;control.append(o)}}else{control=document.createElement(f.multiline?'textarea':'input');if(!f.multiline)control.type='text';control.placeholder=f.placeholder||''}control.name=f.key;control.value=d[f.key]||'';control.required=!!f.required;label.append(control);return label}));
    if(page!=='publications'){const label=document.createElement('label');label.textContent=page==='lab-life'?'새 사진 파일 (여러 장 가능)':'새 사진 파일';const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/gif';input.multiple=page==='lab-life'||page==='news';input.onchange=()=>{pending=[...input.files];formDirty=true;status(`${pending.length}개 파일은 저장을 누르면 업로드됩니다.`)};label.append(input);$('#fields').append(label)}$('#form-area').hidden=false;$('#form-area').scrollIntoView({behavior:'smooth',block:'start'});}
  function personCard(d){const wrap=doc.createElement('div');wrap.className='text-center';wrap.innerHTML=`<button type="button" data-person-trigger class="group block w-full text-center"><div class="mx-auto h-32 w-32 overflow-hidden rounded-full ring-1 ring-slate-200 transition duration-300 group-hover:shadow-md group-hover:ring-2 group-hover:ring-primary-300"><img class="h-full w-full object-cover" loading="lazy" alt=""></div><h3 class="mt-3 font-serif text-base text-slate-900 group-hover:text-primary-700"></h3><p class="text-sm text-slate-600"></p></button>`;return wrap;}
  function updatePerson(node,d) {
    const t = $('[data-person-trigger]',node) || $('a',node);
    if (t?.matches('[data-person-trigger]')) {
      for (const k of ['name','role','title','email']) t.dataset[k] = d[k] || '';
      t.dataset.photo = d.photo || '';
      t.dataset.initials = (d.name || '').split(/\s+/).map(x=>x[0]).join('').slice(0,3);
    }
    $('h3',node).textContent = d.name;
    let role = $('p:not(.alumni-affiliation)',node);
    // 학위 정보는 상세 팝업에 유지하고 박사과정 목록에는 표시하지 않습니다.
    if (d.section === 'Ph.D. Students') {
      for (const paragraph of node.querySelectorAll('p:not(.alumni-affiliation)')) paragraph.remove();
    } else {
      if (!role) {
        role = doc.createElement('p');
        role.className = 'text-sm text-slate-600';
        $('h3',node).after(role);
      }
      role.textContent = d.role || '';
    }
    let aff = $('.alumni-affiliation',node);
    if (d.section === 'Alumni' && d.affiliation) {
      if (!aff) {
        aff = doc.createElement('p');
        aff.className = 'alumni-affiliation mt-1 text-xs text-slate-500';
        role.after(aff);
      }
      aff.textContent = d.affiliation;
    } else aff?.remove();
    const im = $('img',node);
    if (im) { im.src = d.photo || ''; im.removeAttribute('srcset'); im.alt = d.name; }
  }
  function pubCard(){const li=doc.createElement('li');li.className='pl-1';li.setAttribute('data-pub','');li.innerHTML='<p class="font-medium text-slate-900"></p><p class="mt-1 text-sm leading-relaxed text-slate-600"></p>';return li}
  function updatePub(node,d){if(!/^\d{4}$/.test(d.year)&&d.year!=='unknown')throw Error('연도는 네 자리 숫자로 입력하세요.');const month=d.month.trim();if(month&&!/^(?:[1-9]|1[0-2])$/.test(month))throw Error('월은 1–12 또는 빈칸으로 입력하세요.');node.dataset.pubType=d.type;node.dataset.pubYear=d.year;node.dataset.pubMonth=month||'0';$('p',node).textContent=d.title;$('p + p',node).textContent=d.citation;}
  function articleCard(){const a=doc.createElement('article');a.className=page==='news'?'grid gap-5 border-b border-slate-200 pb-10 last:border-b-0 sm:grid-cols-[minmax(0,15rem)_1fr]':'grid gap-5 border-b border-slate-200 pb-8 last:border-b-0 sm:grid-cols-[9rem_1fr]';a.innerHTML='<div class="grid gap-1.5 grid-cols-1"><button type="button" class="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-lg border border-slate-200 bg-slate-50"><img loading="lazy" class="aspect-[4/3] w-full object-cover"></button></div><div><p class="text-sm text-slate-500"></p><h3 class="mt-1 font-serif text-lg text-slate-900"></h3></div>';return a}
  function updateArticle(node,d){const date=$('p.text-sm',node);if(date)date.textContent=d.date;const h=$('h3',node);if(h)h.textContent=d.title;const img=$('img',node);if(img){img.src=d.photo||'';img.removeAttribute('srcset');img.alt=d.title}const button=$('button',node);if(page==='news'){const photos=d.photos||[d.photo].filter(Boolean);const holder=button.parentElement;const template=button.cloneNode(true);holder.replaceChildren(...photos.map(url=>{const b=template.cloneNode(true);b.setAttribute('data-lightbox','');b.dataset.full=url;b.dataset.caption=d.title;b.dataset.date=d.date;b.setAttribute('aria-label','View full-size photo: '+d.title);const im=$('img',b);im.src=url;im.removeAttribute('srcset');im.alt=d.title;return b}))}else{button.setAttribute('data-lightbox-open','');button.dataset.itemIndex=d.index;button.setAttribute('aria-label','View photos: '+d.title);const badge=$('span',button);if(badge){if(d.photos.length>1)badge.textContent='+'+(d.photos.length-1);else badge.remove()}else if(d.photos.length>1){const span=doc.createElement('span');span.className='absolute bottom-1.5 right-1.5 rounded-full bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-white';span.textContent='+'+(d.photos.length-1);button.append(span)}let description=$('h3 + p',node);if(d.description){if(!description){description=doc.createElement('p');description.className='mt-2 text-sm leading-relaxed text-slate-600';h.after(description)}description.textContent=d.description}else description?.remove()}for(const a of node.querySelectorAll('a[href*="iras.postech.ac.kr/main/bbs"]')){if(a.closest('h3'))a.replaceWith(doc.createTextNode(a.textContent));else a.remove()}}
  function articleContainer(){return doc.querySelector('main .space-y-10')||doc.querySelector('main .space-y-8')}
  function renumber() {
    if (page === 'publications') rules.normalizePublications(doc);
    if (page === 'lab-life') list().forEach(({node}, i) => {
      const button = node.querySelector('[data-item-index]');
      if (button) button.dataset.itemIndex = i;
    });
  }
  // Read images into this session's draft; no GitHub write occurs here.
  async function upload(files) {
    for (const file of files) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw Error('JPG, PNG, WebP, GIF 사진만 사용할 수 있습니다.');
      if (file.size > 8 * 1024 * 1024) throw Error('사진 한 장은 8 MB 이하로 선택하세요.');
    }
    const staged = [];
    for (const file of files) {
      const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[file.type];
      const path = `/images/admin/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let raw = '';
      for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
      staged.push([path, {content:btoa(raw), preview:URL.createObjectURL(file)}]);
    }
    for (const [path, image] of staged) images.set(path, image);
    return staged.map(([path]) => path);
  }
  async function save(event){event.preventDefault();if(busy)return;const d=Object.fromEntries(new FormData($('#content-form')));const backup=serialize(doc);const selectedIndex=selected?list().findIndex(x=>x.node===selected.node):-1;setBusy(true);try{if(pending?.length){status('사진을 변경사항에 추가하는 중…');const urls=await upload(pending);if(page==='lab-life'||page==='news')d.photos=[d.photos||'',...urls].filter(Boolean).join('\n');else d.photo=urls[0];}
      if(page==='people'){const section=sections().find(s=>s.querySelector('h2').textContent.trim()===d.section);if(!section)throw Error('섹션을 찾지 못했습니다.');const node=selected?.node||personCard(d);updatePerson(node,d);if(!selected||selected.section!==d.section)grid(section).append(node)}
      else if(page==='publications'){const node=selected?.node||pubCard();updatePub(node,d);if(!selected){const list=doc.querySelector('[data-pub-list]')||doc.querySelector('li[data-pub]')?.parentElement;const first=[...list.querySelectorAll(':scope > li[data-pub]')].find(x=>x.dataset.pubType===d.type);first?list.insertBefore(node,first):list.append(node)}}
      else{const node=selected?.node||articleCard();if(page==='news'){d.photos=(d.photos||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!d.photos.length)throw Error('사진 주소나 업로드할 사진을 입력하세요.');d.photo=d.photos[0]}if(page==='lab-life'){const galleries=gallery(),photos=(d.photos||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!photos.length)throw Error('사진 주소나 업로드할 사진을 입력하세요.');d.photo=photos[0];d.photos=photos;const index=selected?list().findIndex(x=>x.node===node):0;if(selected)galleries[index]={images:photos,caption:d.title,date:d.date};else galleries.unshift({images:photos,caption:d.title,date:d.date});setGallery(galleries);d.index=index}updateArticle(node,d);if(!selected)articleContainer().prepend(node)}
      stage();$('#form-area').hidden=true;selected=null;pending=null;formDirty=false;
    }catch(e){doc=parse(backup);drafts.get(paths[page]).doc=doc;selected=selectedIndex>=0?list()[selectedIndex]:null;formDirty=true;render();status(e.message+' 입력을 다시 확인하세요.',true)}finally{setBusy(false)}}
  function remove(item) {
    if (busy || !guardForm()) return;
    const d = data(item);
    if (!confirm(`“${d.name || d.title}” 항목을 삭제 목록에 추가할까요? 업로드 전에는 변경사항 취소로 복원할 수 있습니다.`)) return;
    const backup = serialize(doc);
    try {
      if (page === 'lab-life') { const g = gallery(); g.splice(list().findIndex(x => x.node === item.node), 1); setGallery(g); }
      item.node.remove(); stage();
      $('#form-area').hidden = true; selected = null; pending = null; formDirty = false;
    } catch (e) { doc = parse(backup); drafts.get(paths[page]).doc = doc; render(); status(e.message, true); }
  }
  function move(item, delta) {
    if (busy || !guardForm()) return;
    const items = list(), i = items.findIndex(x => x.node === item.node), other = items[i + delta];
    if (!other) return;
    if (page === 'people' && other.section !== item.section) return status('섹션 간 이동은 수정에서 섹션을 선택하세요.', true);
    if (page === 'people' && item.section === 'Alumni' && rules.compareAlumni(item.node, other.node)) return status('졸업 연도·학위 정렬을 유지합니다. 같은 연도·학위 안에서 이동하세요.', true);
    if (page === 'publications' && (data(other).type !== data(item).type || rules.comparePublications(item.node, other.node))) return status('연도·월 정렬을 유지합니다. 같은 분류·연도·월 안에서 이동하세요.', true);
    const backup = serialize(doc);
    try {
      if (page === 'lab-life') { const g = gallery(); [g[i], g[i + delta]] = [g[i + delta], g[i]]; setGallery(g); }
      if (delta < 0) other.node.before(item.node); else other.node.after(item.node);
      stage(); $('#form-area').hidden = true; selected = null; pending = null; formDirty = false;
    } catch (e) { doc = parse(backup); drafts.get(paths[page]).doc = doc; render(); status(e.message, true); }
  }
  async function getDraft(path, ref = BRANCH) {
    if (drafts.has(path)) return drafts.get(path);
    const r = await api(contentPath(path) + `?ref=${ref}`);
    const source = decode(r.content);
    const state = {source, sha:r.sha, doc:parse(source), dirty:false};
    drafts.set(path, state);
    return state;
  }
  async function load() {
    status('목록을 불러오는 중…');
    const state = await getDraft(paths[page]);
    doc = state.doc; source = state.source; sha = state.sha;
    selected = null; pending = null; formDirty = false; $('#form-area').hidden = true;
    render(); updateDraftStatus();
    status(state.dirty ? '업로드 대기 중인 수정본을 불러왔습니다.' : '최신 파일을 불러왔습니다.');
  }
  async function head() { return (await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha; }
  const post = (path, body) => api(`/repos/${REPO}/git/${path}`, {method:'POST', body:JSON.stringify(body)});
  async function publishAll() {
    if (busy) return;
    try { environment.assertReady(target, window); }
    catch (e) { return status(e.message, true); }
    if (formDirty) return status('입력 중인 항목의 변경사항에 반영 버튼을 먼저 누르세요.', true);
    if (!dirtyDrafts().length) return;
    setBusy(true);
    let newCommit = null, committed = false;
    try {
      status('업로드 준비 중…');
      const baseHead = await head();
      const publications = drafts.get(paths.publications);
      if (publications?.dirty) {
        rules.normalizePublications(publications.doc);
        const home = await getDraft('index.html', baseHead);
        rules.syncRecentWork(home.doc, publications.doc);
        home.dirty = true;
      }
      const entries = dirtyDrafts();
      // Check the exact revision being used as parent before creating any objects.
      const current = await Promise.all(entries.map(async ([path, state]) => {
        const remote = await api(contentPath(path) + `?ref=${baseHead}`);
        return {path, expected:state.sha, actual:remote.sha};
      }));
      const conflicts = current.filter(x => x.expected !== x.actual).map(x => x.path);
      if (conflicts.length) throw Error(`다른 곳에서 수정된 파일이 있습니다: ${conflicts.join(', ')}. 임시 수정은 유지했습니다. 수정 내용을 따로 보관한 뒤 변경사항 취소 → 연결 해제 → 다시 연결해 최신 파일에서 반영하세요.`);
      const parent = await api(`/repos/${REPO}/git/commits/${baseHead}`);
      const snapshots = new Map(entries.map(([path, state]) => [path, serialize(state.doc)]));
      const tree = [...snapshots].map(([path, content]) => ({path, mode:'100644', type:'blob', content}));
      const usedImages = [...images.entries()].filter(([path]) => [...snapshots.values()].some(html => html.includes(path)));
      // Blob uploads do not update the branch or start a Pages deployment.
      for (let i = 0; i < usedImages.length; i += 3) {
        status(`사진 업로드 중… ${Math.min(i + 3, usedImages.length)}/${usedImages.length}`);
        const blobs = await Promise.all(usedImages.slice(i, i + 3).map(async ([path, image]) => {
          const blob = await post('blobs', {content:image.content, encoding:'base64'});
          return {path:path.slice(1), mode:'100644', type:'blob', sha:blob.sha};
        }));
        tree.push(...blobs);
      }
      status('변경사항을 한 번에 게시하는 중…');
      const createdTree = await post('trees', {base_tree:parent.tree.sha, tree});
      newCommit = (await post('commits', {message:`Update site content (${operationCount} draft changes)`, tree:createdTree.sha, parents:[baseHead]})).sha;
      try {
        await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {method:'PATCH', body:JSON.stringify({sha:newCommit, force:false})});
        committed = true;
      } catch (e) {
        // A response can be lost after GitHub accepted the ref update.
        // Check ancestry as well as equality if another edit followed our commit.
        const latest = await head();
        if (latest === newCommit) committed = true;
        else {
          const comparison = await api(`/repos/${REPO}/compare/${newCommit}...${latest}`);
          if (comparison.status === 'ahead' || comparison.status === 'identical') committed = true;
        }
        if (!committed) throw Error('업로드 중 다른 변경이 반영되었거나 게시가 실패했습니다. 임시 수정은 유지했습니다. ' + e.message);
      }
      for (const [path, state] of entries) {
        state.source = snapshots.get(path); state.doc = parse(state.source); state.dirty = false;
        // Git blob SHA: needed for the next conflict check without another read.
        const raw = new TextEncoder().encode(state.source);
        const prefix = new TextEncoder().encode(`blob ${raw.length}\0`);
        const combined = new Uint8Array(prefix.length + raw.length); combined.set(prefix); combined.set(raw, prefix.length);
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', combined));
        state.sha = [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
      }
      clearImages(); operationCount = 0;
      const active = drafts.get(paths[page]); doc = active.doc; source = active.source; sha = active.sha;
      render(); selected = null; pending = null; formDirty = false; $('#form-area').hidden = true;
      status('모든 변경사항을 한 번에 업로드했습니다. GitHub Pages 배포가 끝나면 반영됩니다.' + (publications?.dirty === false && snapshots.has('index.html') ? ' Recent work도 함께 갱신했습니다.' : ''));
    } catch (e) {
      status((committed ? 'GitHub 게시가 완료됐지만 화면 갱신에 실패했습니다. 다시 연결해 최신 파일을 확인하세요. ' : '') + e.message, true);
    } finally { setBusy(false); }
  }
  function discardAll() {
    if (busy || !confirm('아직 업로드하지 않은 모든 변경사항을 취소할까요?')) return;
    for (const state of drafts.values()) {state.doc = parse(state.source); state.dirty = false;}
    clearImages(); operationCount = 0; selected = null; pending = null; formDirty = false;
    doc = drafts.get(paths[page]).doc; $('#form-area').hidden = true;
    render(); updateDraftStatus(); status('업로드 전 변경사항을 모두 취소했습니다.');
  }
  $('#login-form').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    try { environment.assertReady(target, window); }
    catch (err) { status(err.message, true); return; }
    const button = $('#login-form button'); button.disabled = true; token = $('#token').value.trim();
    $('#token').value = '';
    try {
      user = (await api('/user')).login;
      const repo = await api(`/repos/${REPO}`);
      if (!repo.permissions?.push) throw Error('이 저장소에 쓰기 권한이 없습니다.');
      await load();
      $('#token').value = ''; $('#account').textContent = `${user} 계정 연결됨`;
      $('#login').hidden = true; $('#editor').hidden = false;
    } catch (err) { status(err.message, true); token = ''; drafts.clear(); $('#login').hidden = false; $('#editor').hidden = true; }
    finally { button.disabled = false; }
  };
  $('#logout').onclick = () => {
    if (busy) return;
    if ((dirtyDrafts().length || formDirty) && !confirm('업로드하지 않은 변경사항이 있습니다. 취소하고 연결을 해제할까요?')) return;
    token = ''; $('#token').value = ''; doc = null; source = ''; sha = ''; user = ''; selected = null; pending = null; drafts.clear(); clearImages(); operationCount = 0; formDirty = false;
    $('#editor').hidden = true; $('#login').hidden = false; updateDraftStatus(); status('연결을 해제했습니다.');
  };
  $('#tabs').onclick = async e => {
    const button = e.target.closest('[data-page]');
    if (busy || !button || button.dataset.page === page || !guardForm()) return;
    const previous = page; page = button.dataset.page; setBusy(true);
    try {
      $('#search').value = ''; await load();
      for (const b of $('#tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
    } catch (err) { page = previous; status(err.message, true); }
    finally { setBusy(false); }
  };
  $('#content-form').oninput = e => {
    formDirty = true;
    if (page === 'publications' && e.target.name === 'citation') {
      const month = $('#content-form [name="month"]');
      month.value = String(rules.citationMonth(e.target.value) || '');
    }
  };
  $('#content-form').onchange = () => { formDirty = true; };
  $('#search').oninput = () => { if (doc && !busy) render(); };
  $('#add').onclick = () => form();
  $('#cancel').onclick = () => {$('#form-area').hidden = true; selected = null; pending = null; formDirty = false;};
  $('#content-form').onsubmit = save;
  $('#publish').onclick = publishAll;
  $('#discard').onclick = discardAll;
  window.addEventListener('beforeunload', e => {
    if (dirtyDrafts().length || formDirty) {e.preventDefault(); e.returnValue = '';}
  });
  try {
    if (!environment) throw Error('대상 정책을 불러오지 못했습니다. 연결과 게시를 차단했습니다.');
    target = environment.resolve(window.location.href);
    REPO = target.repo; BRANCH = target.branch;
    $('#environment').textContent = `${target.label} · ${REPO} · ${BRANCH}`;
    $('#environment').dataset.mode = target.mode;
    environment.assertReady(target, window);
    $('#token').disabled = false;
    $('#login-form button').disabled = false;
  } catch (err) {
    $('#environment').textContent = target ? `${target.label} · ${REPO} · ${BRANCH} · 연결 차단` : '환경 확인 실패 · 연결 차단';
    $('#environment').dataset.mode = 'blocked';
    $('#token').disabled = true;
    $('#login-form button').disabled = true;
    status(err.message, true);
  }
})();
