(() => {
  'use strict';
  const environment = window.IRASAdminEnvironment;
  let target = null;
  let REPO = '', BRANCH = '';
  const paths = {people:'people/index.html', publications:'publications/index.html', news:'news/index.html', 'lab-life':'lab-life/index.html', badminton:'badminton/records.json'};
  const $ = (s,root=document) => root.querySelector(s);
  let token = '', page = 'people', source = '', sha = '', doc = null, selected = null, pending = null, user = '';
  const rules = window.IRASContentRules;
  const drafts = new Map(), images = new Map();
  const galleryCache = new WeakMap();
  let busy = false, formDirty = false, operationCount = 0, lookupRequest = null;
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
    if (!response.ok) { const error = new Error(body.message||`GitHub HTTP ${response.status}`); error.status = response.status; throw error; }
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
    if(page==='publications'){const citation=$('p + p',n)?.cloneNode(true);citation?.querySelector('[data-pub-link]')?.remove();return {title:$('p',n)?.textContent.trim()||'',citation:citation?.textContent.trim()||'',paperUrl:$('[data-pub-link]',n)?.getAttribute('href')||'',type:n.dataset.pubType||'',year:n.dataset.pubYear||'',month:String(rules.publicationDate(n).month || '')};}
    const index=page==='lab-life'?Number(n.querySelector('[data-item-index]')?.dataset.itemIndex):-1;
    const g=page==='lab-life'?gallery()[index]:null;
    return {title:$('h3',n)?.textContent.trim()||'',date:$('p.text-sm',n)?.textContent.trim()||'',description:page==='lab-life'?($('h3 + p',n)?.textContent.trim()||''):'',photo:g?.images?.[0]||$('[data-lightbox]',n)?.dataset.full||$('img',n)?.getAttribute('src')||'',photos:g?.images?.join('\n')||[...n.querySelectorAll('[data-lightbox]')].map(b=>b.dataset.full).join('\n'),index};
  }
  function render(){
    $('#search').closest('.toolbar').hidden = page === 'badminton';
    if (page === 'badminton') return renderBadminton();
    const q=$('#search').value.toLowerCase().trim();const items=list().filter(x=>!q||JSON.stringify(data(x)).toLowerCase().includes(q));$('#count').textContent=`${items.length}개 항목`;
    $('#items').replaceChildren(...items.map(item=>{const d=data(item);const row=document.createElement('div');row.className=page==='publications'?'item publication-item':'item';const body=document.createElement('div');body.innerHTML=`<strong>${safe(d.name||d.title)}</strong><small>${safe(d.section||d.type||d.date)} ${safe(d.role||d.year||'')}</small>`;const actions=document.createElement('div');actions.className='actions';for(const [label,fn,cls] of [['수정',()=>form(item)],['↑',()=>move(item,-1)],['↓',()=>move(item,1)],['삭제',()=>remove(item),'danger']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=cls||'';b.onclick=fn;actions.append(b)}if(page!=='publications'){const image=document.createElement('img');image.src=images.get(d.photo)?.preview||environment.previewUrl(window.location.href,d.photo||'');image.alt='';image.onerror=()=>image.removeAttribute('src');row.append(image)}row.append(body,actions);return row}));}
  const types=rules.types;
  function updateClassificationButtons(picker) {
    const kind=picker.dataset.kind, region=picker.dataset.region;
    for(const button of picker.querySelectorAll('[data-kind]'))button.setAttribute('aria-pressed',String(button.dataset.kind===kind));
    for(const button of picker.querySelectorAll('[data-region]'))button.setAttribute('aria-pressed',String(button.dataset.region===region));
    picker.querySelector('.publication-region').hidden=kind==='Patent';
    picker.querySelector('[name="type"]').value=kind==='Patent'?'Patent':kind&&region?`${region} ${kind}`:'';
  }
  function setPublicationClassification(kind,region,emit=true) {
    const picker=$('.publication-classification');
    if(!picker)return;
    picker.dataset.kind=['Journal','Conference','Patent'].includes(kind)?kind:'';
    picker.dataset.region=picker.dataset.kind==='Patent'?'':['International','Domestic'].includes(region)?region:'';
    updateClassificationButtons(picker);
    if(emit)picker.querySelector('[name="type"]').dispatchEvent(new Event('input',{bubbles:true}));
  }
  function publicationClassification(value) {
    const picker=document.createElement('fieldset');picker.className='publication-classification';
    const legend=document.createElement('legend');legend.textContent='분류';picker.append(legend);
    const createGroup=(className,title,choices,key)=>{
      const group=document.createElement('div');group.className=className;
      const heading=document.createElement('span');heading.className='classification-heading';heading.textContent=title;
      const buttons=document.createElement('div');buttons.className='classification-buttons';
      for(const [choice,label] of choices){const button=document.createElement('button');button.type='button';button.dataset[key]=choice;button.textContent=label;button.setAttribute('aria-pressed','false');button.onclick=()=>setPublicationClassification(key==='kind'?choice:picker.dataset.kind,key==='region'?choice:picker.dataset.region);buttons.append(button)}
      group.append(heading,buttons);return group;
    };
    picker.append(createGroup('publication-kind','유형',[['Journal','저널'],['Conference','학회'],['Patent','특허']],'kind'));
    picker.append(createGroup('publication-region','지역',[['International','국외'],['Domestic','국내']],'region'));
    const input=document.createElement('input');input.type='hidden';input.name='type';picker.append(input);
    const parts=/^(International|Domestic) (Journal|Conference)$/.exec(value||'');
    picker.dataset.kind=value==='Patent'?'Patent':parts?.[2]||'';
    picker.dataset.region=parts?.[1]||'';
    updateClassificationButtons(picker);
    return picker;
  }
  function showClassificationDialog(message,group) {
    let dialog=$('#classification-dialog');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='classification-dialog';dialog.className='classification-dialog';dialog.setAttribute('aria-labelledby','classification-dialog-title');
      const title=document.createElement('h2');title.id='classification-dialog-title';title.textContent='분류를 선택해 주세요';
      const detail=document.createElement('p');
      const button=document.createElement('button');button.type='button';button.textContent='확인';button.onclick=()=>dialog.close();
      dialog.append(title,detail,button);document.body.append(dialog);
      dialog.addEventListener('close',()=>$('#fields .publication-'+dialog.dataset.focus+' button')?.focus());
    }
    dialog.querySelector('p').textContent=message;dialog.dataset.focus=group;dialog.showModal();
  }
  function confirmPublicationCandidate(query,work,mismatch,replaced,trigger) {
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='classification-dialog publication-candidate-dialog';
      dialog.setAttribute('aria-labelledby','publication-candidate-dialog-title');
      const title=document.createElement('h2');title.id='publication-candidate-dialog-title';title.textContent='같은 논문인지 확인해 주세요';
      const introduction=document.createElement('p');introduction.textContent='검색 결과의 제목과 저자를 입력한 논문과 대조한 뒤 적용하세요.';
      const details=document.createElement('div');details.className='publication-candidate-details';
      const currentCitation=$('#fields [name="citation"]').value.trim();
      const candidateType=work.type==='journal-article'?'저널':work.type==='proceedings-article'?'학회':work.type||'유형 정보 없음';
      for(const [label,value] of [['입력 제목',query],...(currentCitation?[['입력 서지',currentCitation]]:[]),['검색 제목',work.title],['검색 저자',work.authors.join(', ')||'저자 정보 없음'],['검색 연도',work.year||'연도 정보 없음'],['검색 유형',candidateType]]){
        const row=document.createElement('div');const term=document.createElement('strong');const description=document.createElement('span');
        term.textContent=label;description.textContent=value;row.append(term,description);details.append(row);
      }
      const notice=document.createElement('p');notice.className='publication-candidate-notice';
      notice.textContent=[mismatch.length?`입력값과 다른 항목: ${mismatch.join(' · ')}.`:'',replaced.length?`교체할 기존 항목: ${replaced.join(' · ')}.`:'','논문 제목은 자동으로 바뀌지 않습니다.'].filter(Boolean).join(' ');
      const actions=document.createElement('div');actions.className='publication-candidate-actions';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';cancel.onclick=()=>dialog.close('cancel');
      const apply=document.createElement('button');apply.type='button';apply.textContent='이 정보 사용';apply.className='publication-candidate-apply';apply.onclick=()=>dialog.close('apply');
      actions.append(cancel,apply);dialog.append(title,introduction,details,notice,actions);document.body.append(dialog);
      dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('cancel')});
      dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dialog.close('cancel')}});
      dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='apply';dialog.remove();trigger.focus();resolve(accepted)},{once:true});
      dialog.showModal();cancel.focus();
    });
  }
  function fields(){if(page==='people')return [{key:'name',label:'이름',required:true},{key:'section',label:'섹션',options:sections().map(s=>s.querySelector('h2').textContent.trim())},{key:'role',label:'직책 / 학위'},{key:'title',label:'연구 분야 / 상세 정보'},{key:'email',label:'이메일'},{key:'affiliation',label:'졸업생 소속'},{key:'photo',label:'사진 주소',placeholder:'/_astro/... 또는 업로드'}];
    if(page==='publications')return [{key:'title',label:'논문 제목',required:true},{key:'citation',label:'서지 정보',multiline:true,required:true},{key:'paperUrl',label:'논문 URL (선택)',placeholder:'https://doi.org/...'},{key:'type',label:'분류',options:types},{key:'year',label:'연도',required:true},{key:'month',label:'월 (1–12, 모르면 비워두기)',placeholder:'예: 9'}];
    if(page==='news')return [{key:'title',label:'제목',required:true},{key:'date',label:'게시 날짜',required:true,placeholder:'October 6, 2026'},{key:'photos',label:'사진 주소 (한 줄에 하나)',multiline:true}];
    return [{key:'title',label:'제목',required:true},{key:'date',label:'게시 날짜',required:true},{key:'description',label:'본문',multiline:true},{key:'photos',label:'사진 주소 (한 줄에 하나)',multiline:true,placeholder:'/_astro/photo-1.jpg'}];}
  function form(item=null){if(busy||!guardForm())return;lookupRequest?.abort();lookupRequest=null;formDirty=false;selected=item;pending=null;const d=item?data(item):{};$('#form-title').textContent=item?'항목 수정':'새 항목 추가';$('#fields').replaceChildren(...fields().map(f=>{if(page==='publications'&&f.key==='type')return publicationClassification(d.type);const label=document.createElement('label');label.textContent=f.label;let control;if(f.options){control=document.createElement('select');for(const opt of f.options){const o=document.createElement('option');o.value=o.textContent=opt;control.append(o)}}else{control=document.createElement(f.multiline?'textarea':'input');if(!f.multiline)control.type=f.key==='paperUrl'?'url':'text';control.placeholder=f.placeholder||''}control.name=f.key;control.value=d[f.key]||'';control.required=!!f.required;label.append(control);return label}));
    if(page==='publications')addPublicationLookup();
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
    // 학위 정보는 상세 팝업에 유지하고 학생·인턴·직원 목록에는 표시하지 않습니다.
    if (['Ph.D. Students', 'M.S. Students', 'Research Interns', 'Staff'].includes(d.section)) {
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
  function addPublicationLookup(){
    const panel=document.createElement('div');panel.className='publication-lookup';
    const button=document.createElement('button');button.type='button';button.textContent='논문 링크 찾기';
    const note=document.createElement('p');note.className='note';note.textContent='후보의 제목·저자·연도와 입력안을 확인한 뒤 선택하세요. 검색과 선택만으로는 변경사항에 반영되지 않습니다.';
    const summary=document.createElement('p');summary.className='publication-lookup-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
    const results=document.createElement('div');results.className='publication-lookup-results';
    const title=$('#fields [name="title"]');
    title.closest('label').after(panel);panel.append(button,note,summary,results);
    const clearLookup=()=>{lookupRequest?.abort();lookupRequest=null;results.replaceChildren();summary.textContent='';button.disabled=false;};
    for(const input of [title,$('#fields [name="year"]'),$('#fields [name="type"]')])input.addEventListener('input',clearLookup);
    button.onclick=async()=>{
      const query=title.value.trim();
      if(query.length<8){summary.textContent='논문 제목을 8자 이상 입력하세요.';return;}
      lookupRequest?.abort();const request=new AbortController();lookupRequest=request;
      const timeout=setTimeout(()=>request.abort(),10000);button.disabled=true;results.replaceChildren();summary.textContent='Crossref에서 논문을 찾는 중…';
      try{
        const params=new URLSearchParams({'query.title':query,rows:'5',select:'DOI,title,author,published,published-print,published-online,issued,type,container-title,volume,issue,page,article-number'});
        const response=await fetch(`https://api.crossref.org/works?${params}`,{signal:request.signal});
        if(!response.ok)throw Error(response.status===429?'검색 요청이 많습니다. 잠시 후 다시 시도하세요.':`검색 서비스 오류 (HTTP ${response.status})`);
        const body=await response.json();
        if(lookupRequest!==request)return;
        const expectedYear=$('#fields [name="year"]').value.trim();
        const expectedType=$('#fields [name="type"]').value;
        const normalizedTitle=value=>value.toLowerCase().replace(/[^a-z0-9가-힣]+/g,' ').trim();
        const titleWords=value=>new Set(normalizedTitle(value).split(/\s+/).filter(Boolean));
        const inputWords=titleWords(query);
        const works=(body?.message?.items||[]).filter(work=>work.DOI&&work.title?.[0]).map(work=>{
          const dateSources=work.type==='journal-article'?['published-print','published','published-online','issued']:['published','published-print','published-online','issued'];
          const dateSource=dateSources.find(key=>work[key]?.['date-parts']?.[0]?.[0]);
          const dateParts=work[dateSource]?.['date-parts']?.[0]||[];
          const year=Number(dateParts[0])||null;
          const month=Number(dateParts[1])>=1&&Number(dateParts[1])<=12?Number(dateParts[1]):null;
          const doi=work.DOI.trim();
          const authors=(work.author||[]).map(a=>[a.given,a.family].filter(Boolean).join(' '));
          const citationAuthors=(work.author||[]).map(a=>{
            if(!a.family)return a.given||'';
            const initials=(a.given||'').split(/[\s-]+/).filter(Boolean).map(part=>`${part[0]}.`).join('-');
            return [initials,a.family].filter(Boolean).join(' ');
          }).filter(Boolean);
          return {title:work.title[0],authors,citationAuthors,year,month,dateSource,type:work.type||'',journal:work['container-title']?.[0]||'',volume:work.volume||'',issue:work.issue||'',page:work.page||'',articleNumber:work['article-number']||'',doi,url:`https://doi.org/${doi}`};
        }).filter(work=>{try{const url=new URL(work.url);if(url.protocol!=='https:'||url.hostname!=='doi.org'||/\s/.test(work.doi))return false;const words=titleWords(work.title);const overlap=[...words].filter(word=>inputWords.has(word)).length;return overlap/new Set([...words,...inputWords]).size>=0.4}catch{return false}});
        if(!works.length){summary.textContent='일치하는 DOI 후보를 찾지 못했습니다. URL을 직접 입력할 수 있습니다.';return;}
        summary.textContent=`후보 ${works.length}건 · 제목, 저자, 연도와 발행처를 대조하세요.`;
        for(const work of works){
          const card=document.createElement('div');card.className='publication-lookup-item';
          const heading=document.createElement('strong');heading.textContent=work.title;
          const meta=document.createElement('p');meta.textContent=[work.year||'연도 미상',work.type,work.journal,work.authors.join(', ')||'저자 미상'].filter(Boolean).join(' · ');
          const titleMismatch=normalizedTitle(work.title)!==normalizedTitle(query);
          const yearMismatch=!!expectedYear&&expectedYear!=='unknown'&&String(work.year)!==expectedYear;
          const typeMismatch=(expectedType.includes('Journal')&&work.type!=='journal-article')||(expectedType.includes('Conference')&&work.type!=='proceedings-article')||(expectedType==='Patent'&&['journal-article','proceedings-article'].includes(work.type));
          if(titleMismatch){const warning=document.createElement('p');warning.className='publication-lookup-warning';warning.textContent='입력 제목과 다릅니다. 같은 논문인지 확인하세요.';card.append(warning)}
          if(yearMismatch){const warning=document.createElement('p');warning.className='publication-lookup-warning';warning.textContent=`입력 연도 ${expectedYear}와 다릅니다.`;card.append(warning)}
          if(typeMismatch){const warning=document.createElement('p');warning.className='publication-lookup-warning';warning.textContent='선택한 논문 분류와 검색 결과의 유형이 다릅니다.';card.append(warning)}
          const doi=document.createElement('p');doi.textContent=`DOI ${work.doi}`;
          const candidateKind=work.type==='journal-article'?'Journal':work.type==='proceedings-article'?'Conference':null;
          const region=$('.publication-classification').dataset.region;
          const category=candidateKind&&region?`${region} ${candidateKind}`:null;
          const dateLabels={'published-print':'인쇄 발행일',published:'발행일','published-online':'온라인 발행일',issued:'등록된 발행일'};
          const dateText=work.year?`${work.month||'월 미상'} / ${work.year} (${dateLabels[work.dateSource]})`:'발행일 미상';
          const monthNames=['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sep.','Oct.','Nov.','Dec.'];
          const citation=work.citationAuthors.length&&work.journal?[
            `${work.citationAuthors.join(', ')}, "${query}," ${work.type==='proceedings-article'?'in ':''}${work.journal}`,
            work.volume?`vol. ${work.volume}`:'',work.issue?`no. ${work.issue}`:'',
            work.page?`pp. ${work.page}`:work.articleNumber?`Art. no. ${work.articleNumber}`:'',
            [work.month?monthNames[work.month-1]:'',work.year||''].filter(Boolean).join(' ')
          ].filter(Boolean).join(', ')+'.':'';
          const preview=document.createElement('div');preview.className='publication-lookup-preview';
          const previewLabel=document.createElement('span');previewLabel.textContent='입력안';
          const previewCitation=document.createElement('p');previewCitation.textContent=`서지 정보: ${citation||'메타데이터 부족 · 기존 입력 유지'}`;
          const previewDetails=document.createElement('p');previewDetails.textContent=`유형: ${candidateKind==='Journal'?'저널':candidateKind==='Conference'?'학회':'확인 필요'} · 지역: ${region==='Domestic'?'국내':region==='International'?'국외':'미선택'} · 발행: ${dateText}`;
          const previewNote=document.createElement('p');previewNote.textContent=`${titleMismatch?'서지 제목은 현재 입력 제목을 사용합니다. ':''}${candidateKind?'후보 선택 시 유형은 자동으로 선택됩니다. 국내·국외는 직접 선택하세요.':'이 논문 유형은 자동 선택하지 않습니다.'}`;
          preview.append(previewLabel,previewCitation,previewDetails,previewNote);
          const link=document.createElement('a');link.href=work.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='후보 페이지 열기 ↗';
          const choose=document.createElement('button');choose.type='button';choose.textContent='이 정보 사용';choose.onclick=async()=>{
            const formFields=Object.fromEntries(['citation','paperUrl','type','year','month'].map(name=>[name,$(`#fields [name="${name}"]`)]));
            const next={citation:citation||formFields.citation.value,paperUrl:work.url,type:candidateKind?category||'':formFields.type.value,year:work.year?String(work.year):formFields.year.value,month:work.month?String(work.month):formFields.month.value};
            const replaced=selected?Object.entries(next).filter(([name,value])=>formFields[name].value.trim()&&formFields[name].value.trim()!==value).map(([name])=>({citation:'서지 정보',paperUrl:'논문 URL',type:'분류',year:'연도',month:'월'})[name]):[];
            const mismatch=[titleMismatch?'제목':'',yearMismatch?'연도':'',typeMismatch?'논문 유형':''].filter(Boolean);
            if((mismatch.length||replaced.length)&&!await confirmPublicationCandidate(query,work,mismatch,replaced,choose))return;
            for(const [name,value] of Object.entries(next))if(name!=='type')formFields[name].value=value;
            if(candidateKind)setPublicationClassification(candidateKind,region);
            formDirty=true;summary.textContent='입력안이 채워졌습니다. 분류와 서지 정보를 확인한 뒤 변경사항에 반영을 누르세요.';
          };
          const actions=document.createElement('div');actions.className='publication-lookup-actions';actions.append(link,choose);
          card.prepend(heading,meta);card.append(doi,preview,actions);results.append(card);
        }
      }catch(error){if(lookupRequest!==request)return;summary.textContent=request.signal.aborted?'검색 시간이 초과됐습니다. 다시 시도하거나 URL을 직접 입력하세요.':`${error.message} URL을 직접 입력할 수 있습니다.`;}
      finally{clearTimeout(timeout);if(lookupRequest===request){lookupRequest=null;button.disabled=false;}}
    };
  }
  function updatePub(node,d){if(!/^\d{4}$/.test(d.year)&&d.year!=='unknown')throw Error('연도는 네 자리 숫자로 입력하세요.');const month=d.month.trim();if(month&&!/^(?:[1-9]|1[0-2])$/.test(month))throw Error('월은 1–12 또는 빈칸으로 입력하세요.');const paperUrl=(d.paperUrl||'').trim();if(paperUrl){let parsed;try{parsed=new URL(paperUrl)}catch{throw Error('논문 URL은 https://로 시작하는 전체 주소를 입력하세요.')}if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password)throw Error('논문 URL은 https://로 시작하는 전체 주소를 입력하세요.')}node.dataset.pubType=d.type;node.dataset.pubYear=d.year;node.dataset.pubMonth=month||'0';$('p',node).textContent=d.title;const citation=$('p + p',node);citation.textContent=d.citation;if(paperUrl){const link=doc.createElement('a');link.setAttribute('data-pub-link','');link.href=paperUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View Paper ↗';citation.append(' ',link);}}
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
  async function save(event){event.preventDefault();if(busy)return;
    if(page==='publications'){
      const picker=$('.publication-classification');
      if(!picker.dataset.kind)return showClassificationDialog('논문 유형을 선택하지 않았습니다. 저널, 학회 또는 특허를 선택해 주세요.','kind');
      if(picker.dataset.kind!=='Patent'&&!picker.dataset.region)return showClassificationDialog('지역을 선택하지 않았습니다. 국외 또는 국내를 선택해 주세요.','region');
    }
    lookupRequest?.abort();lookupRequest=null;const d=Object.fromEntries(new FormData($('#content-form')));const backup=serialize(doc);const selectedIndex=selected?list().findIndex(x=>x.node===selected.node):-1;setBusy(true);try{if(pending?.length){status('사진을 변경사항에 추가하는 중…');const urls=await upload(pending);if(page==='lab-life'||page==='news')d.photos=[d.photos||'',...urls].filter(Boolean).join('\n');else d.photo=urls[0];}
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
  async function getDraft(path, ref = BRANCH, allowMissing = false) {
    if (drafts.has(path)) return drafts.get(path);
    let r;
    try { r = await api(contentPath(path) + '?ref=' + ref); }
    catch (e) { if (!allowMissing || e.status !== 404 || !/^badminton\/records\/[a-zA-Z0-9-]+\.md$/.test(path)) throw e; r={content:'',sha:null}; }
    const source = decode(r.content), raw = path.startsWith('badminton/');
    const state = {source, sha:r.sha, doc:raw ? null : parse(source), dirty:false, raw, text:raw ? source : undefined};
    drafts.set(path, state);
    return state;
  }
  async function load() {
    status('목록을 불러오는 중…');
    if (page === 'badminton') await loadBadminton();
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
        let actual;
        try { actual = (await api(contentPath(path) + `?ref=${baseHead}`)).sha; }
        catch (e) { if (state.raw && state.sha === null && e.status === 404) actual = null; else throw e; }
        return {path, expected:state.sha, actual};
      }));
      const conflicts = current.filter(x => x.expected !== x.actual).map(x => x.path);
      if (conflicts.length) throw Error(`다른 곳에서 수정된 파일이 있습니다: ${conflicts.join(', ')}. 임시 수정은 유지했습니다. 수정 내용을 따로 보관한 뒤 변경사항 취소 → 연결 해제 → 다시 연결해 최신 파일에서 반영하세요.`);
      const parent = await api(`/repos/${REPO}/git/commits/${baseHead}`);
      const snapshots = new Map(entries.map(([path, state]) => [path, state.raw ? state.text : serialize(state.doc)]));
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
        state.source = snapshots.get(path); state.doc = state.raw ? null : parse(state.source); if (state.raw) state.text = state.source; state.dirty = false;
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
    for (const [path,state] of drafts) { if (state.raw && state.sha === null) {drafts.delete(path); continue;} state.doc = state.raw ? null : parse(state.source); if (state.raw) state.text = state.source; state.dirty = false;}
    clearImages(); operationCount = 0; selected = null; pending = null; formDirty = false;
    doc = drafts.get(paths[page]).doc; $('#form-area').hidden = true;
    render(); updateDraftStatus(); status('업로드 전 변경사항을 모두 취소했습니다.');
  }

  // The rules factory is also embedded in badminton/index.html for standalone scoring.
  // Regression checks require both copies to stay identical.
  /* BADMINTON_CORE_START */
function createBadmintonRules() {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const fail = message => { throw Error(message); };
  const check = (ok, message) => { if (!ok) fail(message); };
  const idOk = x => typeof x === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(x);
  const nameOk = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 80 && !/[\r\n]/.test(x);
  const rules = '21-deuce-30-interval-11-v1';
  function roster(value) {
    check(value && value.schemaVersion === 1 && Array.isArray(value.players) && value.players.length <= 500, '선수 명단 형식이 올바르지 않습니다.');
    const ids = new Set();
    const players = value.players.map(p => {
      check(p && idOk(p.id) && !ids.has(p.id) && nameOk(p.name) && [1,2,3].includes(p.tier), '선수 ID·이름·티어를 확인하세요.'); ids.add(p.id);
      const history = Array.isArray(p.history) ? p.history.map(h => {
        check(h && [1,2,3].includes(h.to) && (h.from === null || [1,2,3].includes(h.from)) && typeof h.at === 'string' && Number.isFinite(Date.parse(h.at)) && typeof h.reason === 'string' && h.reason.length <= 500, '티어 변경 이력이 올바르지 않습니다.');
        return {from:h.from, to:h.to, at:h.at, reason:h.reason};
      }) : [];
      return {id:p.id, name:p.name.trim(), tier:p.tier, history};
    });
    return {schemaVersion:1, players};
  }
  function balanced(players, count) {
    check(Number.isInteger(count) && count >= 2 && count <= 6 && players.length >= count*2 && players.length <= count*3, '팀당 2~3명, 전체 2~6팀으로 설정하세요.');
    const ordered = [...players].sort((a,b)=>a.tier-b.tier || a.name.localeCompare(b.name,'ko'));
    const teams = Array.from({length:count},(_,i)=>({id:'t'+(i+1),name:String.fromCharCode(65+i)+'팀',players:[]}));
    ordered.forEach((p,i)=>{const round=Math.floor(i/count), col=i%count; teams[round%2 ? count-1-col : col].players.push(p.id);});
    const tier=id=>players.find(p=>p.id===id).tier;
    const cost=()=>{const avg=teams.map(t=>t.players.reduce((n,id)=>n+tier(id),0)/t.players.length); return Math.max(...avg)-Math.min(...avg);};
    for(let pass=0;pass<20;pass++) {let best=cost(), swap=null; for(let a=0;a<count;a++)for(let b=a+1;b<count;b++)for(let i=0;i<teams[a].players.length;i++)for(let j=0;j<teams[b].players.length;j++) {const A=teams[a].players,B=teams[b].players; [A[i],B[j]]=[B[j],A[i]]; const c=cost(); [A[i],B[j]]=[B[j],A[i]]; if(c<best-0.001){best=c;swap=[a,b,i,j];}} if(!swap)break;const [a,b,i,j]=swap; [teams[a].players[i],teams[b].players[j]]=[teams[b].players[j],teams[a].players[i]];}
    return teams;
  }
  function schedule(teams,courts) {
    let ring=teams.map(t=>t.id); if(ring.length%2)ring.push(null);
    const matches=[]; let slot=0;
    for(let round=1;round<ring.length;round++) {
      const pairs=[];for(let i=0;i<ring.length/2;i++){const a=ring[i],b=ring[ring.length-1-i];if(a&&b)pairs.push([a,b]);}
      pairs.forEach((teamIds,i)=>matches.push({id:'m'+(matches.length+1),round,slot:slot+Math.floor(i/courts)+1,court:i%courts+1,teams:teamIds,lineups:null,events:[],finished:false,revisions:[]}));
      slot+=Math.ceil(pairs.length/courts); ring=[ring[0],ring.at(-1),...ring.slice(1,-1)];
    }
    return matches;
  }
  function pairOk(pair,team) {return Array.isArray(pair)&&pair.length===2&&new Set(pair).size===2&&pair.every(id=>team.players.includes(id));}
  function won(score) {const hi=Math.max(...score),lo=Math.min(...score);return hi===30 || hi>=21&&hi-lo>=2;}
  function replay(session,match) {
    const teams=match.teams.map(id=>session.teams.find(t=>t.id===id));
    check(teams.every(Boolean),'경기의 팀을 찾을 수 없습니다.');
    if(match.result!==undefined){
      const score=match.result;
      check(Array.isArray(score)&&score.length===2&&score.every(n=>Number.isInteger(n)&&n>=0&&n<=30),'점수는 0~30 사이 정수로 입력하세요.');
      const hi=Math.max(...score),lo=Math.min(...score);
      check((hi===21&&lo<=19)||(hi>=22&&hi<=29&&hi-lo===2)||(hi===30&&(lo===28||lo===29)),'21점·2점 차 듀스·30점 상한에 맞는 최종 점수를 입력하세요.');
      check(match.finished&&match.lineups===null&&match.events.length===0,'최종 결과와 출전 기록을 함께 저장할 수 없습니다.');
      return {score:[...score],pending:false,over:true,interval:null,after:null};
    }
    const score=[0,0]; let interval=null, pending=false, after=null;
    if(match.lineups===null) {check(match.events.length===0&&!match.finished,'시작하지 않은 경기에는 점수가 없어야 합니다.');return {score,pending:false,over:false,interval:null,after:null};}
    check(Array.isArray(match.lineups)&&match.lineups.length===2&&match.lineups.every((p,i)=>pairOk(p,teams[i])),'경기 시작 출전자 2명을 확인하세요.');
    for(const event of match.events) {
      check(!won(score),'승리 점수 이후의 득점은 허용하지 않습니다.');
      if(event.type==='point') {check(!pending && [0,1].includes(event.team),'11점 코트 변경과 교체를 먼저 확인하세요.');score[event.team]++; if(!interval&&Math.max(...score)===11){pending=true;interval=[...score];}}
      else if(event.type==='interval') {
        check(pending&&!after&&Array.isArray(event.lineups)&&event.lineups.length===2,'코트 변경 시점이 올바르지 않습니다.');
        event.lineups.forEach((p,i)=>{check(pairOk(p,teams[i]),'교체 후 출전자 2명을 확인하세요.');const shared=p.filter(id=>match.lineups[i].includes(id)).length;check(shared===(teams[i].players.length===3?1:2),'3인 팀은 대기 선수와 1명을 교체해야 합니다.');});
        after=copy(event.lineups);pending=false;
      } else fail('알 수 없는 점수 기록입니다.');
    }
    check(!match.finished || won(score)&&!pending,'종료 점수가 아닌 경기를 확정할 수 없습니다.');
    return {score,pending,over:won(score),interval,after};
  }
  function validate(input) {
    check(input&&input.schemaVersion===1&&input.rules===rules&&idOk(input.id)&&nameOk(input.title),'지원하지 않는 모임 형식입니다.');
    check(typeof input.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)&&new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)===input.date,'모임 날짜를 확인하세요.');
    check(Number.isInteger(input.courts)&&input.courts>=1&&input.courts<=3,'코트 수는 1~3개입니다.');
    const players=roster({schemaVersion:1,players:input.players}).players.map(({history,...p})=>p);
    check(players.length>=4&&players.length<=18,'참석자는 4~18명입니다.');
    check(Array.isArray(input.teams)&&input.teams.length>=2&&input.teams.length<=6,'팀 수는 2~6개입니다.');
    const teamIds=new Set(),assigned=new Set();
    const teams=input.teams.map(t=>{check(t&&idOk(t.id)&&!teamIds.has(t.id)&&nameOk(t.name)&&Array.isArray(t.players)&&t.players.length>=2&&t.players.length<=3,'팀 구성을 확인하세요.');teamIds.add(t.id);for(const id of t.players){check(players.some(p=>p.id===id)&&!assigned.has(id),'선수가 중복되거나 누락되었습니다.');assigned.add(id);}return {id:t.id,name:t.name.trim(),players:[...t.players]};});
    check(assigned.size===players.length,'모든 참석자를 팀에 배정하세요.');
    const expected=teams.length*(teams.length-1)/2;
    check(Array.isArray(input.matches)&&input.matches.length===expected,'리그 전체 대진이 필요합니다.');
    const pairs=new Set(),matchIds=new Set(),slots=new Map();
    const matches=input.matches.map(m=>{
      check(m&&idOk(m.id)&&!matchIds.has(m.id)&&Array.isArray(m.teams)&&m.teams.length===2&&m.teams[0]!==m.teams[1]&&m.teams.every(id=>teamIds.has(id)),'경기 ID·대진을 확인하세요.');matchIds.add(m.id);
      const key=[...m.teams].sort().join('/');check(!pairs.has(key),'중복 대진이 있습니다.');pairs.add(key);
      check([m.round,m.slot,m.court].every(Number.isInteger)&&m.round>=1&&m.round<=7&&m.slot>=1&&m.slot<=15&&m.court>=1&&m.court<=input.courts,'경기 배치를 확인하세요.');
      const sl=slots.get(m.slot)||{courts:new Set(),teams:new Set()};check(!sl.courts.has(m.court)&&m.teams.every(id=>!sl.teams.has(id)),'같은 시간대에 팀 또는 코트가 중복됩니다.');sl.courts.add(m.court);m.teams.forEach(id=>sl.teams.add(id));slots.set(m.slot,sl);
      check(Array.isArray(m.events)&&m.events.length<=60&&typeof m.finished==='boolean','점수 기록 형식이 올바르지 않습니다.');
      const events=m.events.map(e=>e?.type==='point'?{type:'point',team:e.team}:e?.type==='interval'?{type:'interval',lineups:copy(e.lineups)}:fail('알 수 없는 점수 기록입니다.'));
      const revisions=Array.isArray(m.revisions)?m.revisions.map(r=>{check(r&&typeof r.at==='string'&&Number.isFinite(Date.parse(r.at))&&typeof r.reason==='string'&&r.reason.trim()&&r.reason.length<=500&&Array.isArray(r.score)&&r.score.length===2&&r.score.every(n=>Number.isInteger(n)&&n>=0&&n<=30),'결과 수정 이력이 올바르지 않습니다.');return {at:r.at,reason:r.reason,score:[...r.score]};}):[];
      return {id:m.id,round:m.round,slot:m.slot,court:m.court,teams:[...m.teams],lineups:m.lineups===null?null:copy(m.lineups),events,finished:m.finished,revisions,...(m.result!==undefined?{result:copy(m.result)}:{})};
    });
    const result={schemaVersion:1,id:input.id,title:input.title.trim(),date:input.date,courts:input.courts,rules,players,teams,matches};
    matches.forEach(m=>replay(result,m));
    const active=matches.filter(m=>m.lineups&&!m.finished);check(active.every((m,i)=>active.slice(i+1).every(n=>m.court!==n.court&&!m.teams.some(id=>n.teams.includes(id)))),'진행 중 경기의 팀 또는 코트가 중복됩니다.');
    return result;
  }
  function standings(s) {
    const rows=s.teams.map(t=>({id:t.id,name:t.name,played:0,wins:0,losses:0,for:0,against:0,diff:0}));
    for(const m of s.matches.filter(m=>m.finished)){const {score}=replay(s,m);m.teams.forEach((id,i)=>{const r=rows.find(r=>r.id===id);r.played++;r.wins+=Number(score[i]>score[1-i]);r.losses+=Number(score[i]<score[1-i]);r.for+=score[i];r.against+=score[1-i];r.diff=r.for-r.against;});}
    rows.sort((a,b)=>b.wins-a.wins||b.diff-a.diff||b.for-a.for||a.name.localeCompare(b.name,'ko'));
    rows.forEach((r,i)=>{const prev=rows[i-1];r.rank=prev&&r.wins===prev.wins&&r.diff===prev.diff&&r.for===prev.for?prev.rank:i+1;});return rows;
  }
  function stats(sessions) {
    const out=new Map();
    for(const s of sessions)for(const m of s.matches.filter(m=>m.finished)){const r=replay(s,m);if(m.result!==undefined)continue;m.teams.forEach((id,i)=>{const before=m.lineups[i],after=r.after[i];for(const pid of new Set([...before,...after])){const p=s.players.find(p=>p.id===pid);const row=out.get(pid)||{id:pid,name:p.name,played:0,wins:0,losses:0,first:0,second:0};row.played++;row.wins+=Number(r.score[i]>r.score[1-i]);row.losses+=Number(r.score[i]<r.score[1-i]);row.first+=Number(before.includes(pid));row.second+=Number(after.includes(pid));out.set(pid,row);}});}return [...out.values()];
  }
  const cell=x=>String(x).replace(/[|\r\n]/g,' ').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function markdown(input) {
    const s=validate(input), ranks=standings(s), complete=s.matches.every(m=>m.finished);
    const lines=['# '+cell(s.title),'', '날짜: '+s.date,'모임 ID: '+s.id,'상태: '+(complete?'완료':'진행 중'),'규칙: 21점 단판 · 듀스 · 30점 상한','기록: 최종 점수 입력 경기는 팀 결과만 집계합니다. 개인 출전·교체 통계는 기존 상세 기록이 있는 경기만 포함합니다.','','## 팀 구성','','| 팀 | 선수 (당시 티어) |','| --- | --- |',...s.teams.map(t=>'| '+cell(t.name)+' | '+t.players.map(id=>{const p=s.players.find(p=>p.id===id);return cell(p.name)+' ('+p.tier+'티어)';}).join(', ')+' |'),'','## 팀 순위','','| 순위 | 팀 | 경기 | 승 | 패 | 득점 | 실점 | 득실차 |','| --- | --- | --- | --- | --- | --- | --- | --- |',...ranks.map(r=>'| '+[r.rank,cell(r.name),r.played,r.wins,r.losses,r.for,r.against,r.diff].join(' | ')+' |'),'','## 경기 결과','','| 경기 | 대진 | 점수 | 상태 |','| --- | --- | --- | --- |',...s.matches.map(m=>'| '+[m.id,m.teams.map(id=>cell(s.teams.find(t=>t.id===id).name)).join(' vs '),replay(s,m).score.join(' : '),m.finished?'확정':m.lineups?'진행':'대기'].join(' | ')+' |'),'','## 개인 출전 통계','','| 선수 | 경기 | 팀 승 | 팀 패 | 전반 | 후반 |','| --- | --- | --- | --- | --- | --- |',...stats([s]).map(p=>'| '+[cell(p.name),p.played,p.wins,p.losses,p.first,p.second].join(' | ')+' |'),'','## 다시 불러오기용 원본','','아래 데이터가 원본입니다. 표는 원본에서 다시 계산합니다.','','~~~json iras-badminton-v1',JSON.stringify(s,null,2),'~~~',''];return lines.join('\n');
  }
  function fromMarkdown(text) {check(typeof text==='string'&&text.length<=1024*1024,'MD는 1MB 이하이어야 합니다.');const parts=[...text.matchAll(/^~~~json iras-badminton-v1\r?\n([\s\S]*?)\r?\n~~~\s*$/gm)];check(parts.length===1,'지원하는 배드민턴 MD 원본 블록이 하나 필요합니다.');return validate(JSON.parse(parts[0][1]));}
  function index(value) {check(value&&value.schemaVersion===1&&Array.isArray(value.sessions)&&value.sessions.length<=2000,'기록 목록 형식이 올바르지 않습니다.');const ids=new Set();return {schemaVersion:1,sessions:value.sessions.map(s=>{check(s&&idOk(s.id)&&!ids.has(s.id)&&nameOk(s.title)&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&s.file==='records/'+s.id+'.md','기록 경로 또는 ID가 올바르지 않습니다.');ids.add(s.id);return {id:s.id,title:s.title,date:s.date,file:s.file};})};}
  return {copy,rules,roster,index,balanced,schedule,replay,validate,standings,stats,markdown,fromMarkdown};
}

  /* BADMINTON_CORE_END */
  const badminton = createBadmintonRules();
  const badmintonPaths = {players:'badminton/players.json', index:'badminton/records.json'};
  function badmintonData() {
    const players = badminton.roster(JSON.parse(drafts.get(badmintonPaths.players).text));
    const index = badminton.index(JSON.parse(drafts.get(badmintonPaths.index).text));
    const sessions = index.sessions.map(s => {
      const session = badminton.fromMarkdown(drafts.get('badminton/' + s.file).text);
      if (session.id !== s.id) throw Error('목록과 기록 ID가 다릅니다.');
      return session;
    });
    return {players, index, sessions};
  }
  async function loadBadminton() {
    await getDraft(badmintonPaths.players);
    const indexState = await getDraft(badmintonPaths.index);
    const index = badminton.index(JSON.parse(indexState.text));
    for (let i = 0; i < index.sessions.length; i += 4) {
      await Promise.all(index.sessions.slice(i, i + 4).map(s => getDraft('badminton/' + s.file)));
    }
    badmintonData();
  }
  function stageBadminton(path, text) {
    const state = drafts.get(path);
    if (!state || !state.raw) throw Error('기록 원본을 먼저 불러오세요.');
    state.text = text; state.dirty = state.text !== state.source;
  }
  function badmintonStatsTable(sessions) {
    const rows = badminton.stats(sessions);
    return '<p>개인 출전 통계는 기존 상세 기록만 포함합니다. 최종 점수 경기는 경기 결과 표에서 확인하세요.</p><div class="badminton-table"><table><thead><tr><th>선수</th><th>출전</th><th>팀 승</th><th>팀 패</th><th>전반</th><th>후반</th></tr></thead><tbody>' + rows.map(p => '<tr>' + [p.name,p.played,p.wins,p.losses,p.first,p.second].map(x => '<td>' + safe(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  const badmintonKoreanNames=new Map([["kyung-tae kim","김경태"],["geon lee","이건"],["min-gon cho","조민곤"],["woo-hyuk choi","최우혁"],["seong-ryeol park","박성렬"],["jun-ho jung","정준호"],["hyun-dong kim","김현동"],["oh-tae jang","장오태"],["yeong-jin choe","최영진"],["seung-hwan kim","김승환"],["in-woo bang","방인우"],["young-kang kim","김영강"],["sang-wook park","박상욱"],["won-woo park","박원우"],["so-yeon an","안소연"],["hae-jun lee","이해준"],["ji-hye jeon","전지혜"],["won-jae song","송원제"],["se-jun park","박세준"],["ji-yong ryu","유지용"],["sol-ji kim","김솔지"],["da-seul ji","지다슬"]]);
  function badmintonNameKey(name){
    const value=String(name).normalize('NFKC').replace(/,?\s*Ph\.?D\.?\s*$/i,'').replace(/\s+/g,' ').trim().toLowerCase();
    const alias={'sung-ryul park':'seong-ryeol park','yeong-jin choi':'yeong-jin choe'};
    return badmintonKoreanNames.get(alias[value]||value)||value;
  }
  function badmintonRecentResults(sessions,p){
    const rows=sessions.flatMap(s=>s.matches.filter(m=>m.finished).flatMap(m=>{
      const side=m.teams.findIndex(id=>s.teams.find(t=>t.id===id).players.includes(p.id));
      if(side<0)return [];
      const score=badminton.replay(s,m).score;
      return [{date:s.date,session:s.id,slot:m.slot,opponent:s.teams.find(t=>t.id===m.teams[1-side]).name,score:score[side]+' : '+score[1-side],win:score[side]>score[1-side]}];
    })).sort((a,b)=>b.date.localeCompare(a.date)||b.session.localeCompare(a.session)||b.slot-a.slot).slice(0,5);
    return '<details><summary>최근 팀 경기 '+rows.length+'건</summary>'+(rows.length?rows.map(r=>'<p class="note">'+safe(r.date)+' · '+safe(r.opponent)+' · '+r.score+' · '+(r.win?'승':'패')+'</p>').join(''):'<p class="note">저장된 팀 경기 결과가 없습니다.</p>')+'</details>';
  }
  function renderBadminton() {
    const {players,index,sessions} = badmintonData();
    $('#count').textContent = index.sessions.length + '개 모임 · ' + players.players.length + '명';
    $('#items').innerHTML = '<div class="badminton-admin"><h2>배드민턴 기록·티어</h2><p class="note">완료된 MD를 가져오면 지난 기록에 자동 반영됩니다. 같은 모임 ID는 갱신하며, 상단 업로드로 홈페이지에 저장합니다. <a href="../badminton/" target="_blank" rel="noopener">경기 운영 페이지 열기</a></p>' +
      '<label>결과 MD 가져오기<input type="file" id="badminton-import" accept=".md,text/markdown,text/plain"></label>' +
      '<h3>누적 출전 통계</h3><p class="note">팀 승패와 전·후반 출전 기록입니다. 개인 실력 점수로 자동 환산하지 않습니다.</p>' + badmintonStatsTable(sessions) +
      '<h3>선수 기본 티어 · 영구 설정</h3><p class="note">상단에서 업로드하면 다음 새 모임의 기본값으로 적용됩니다. 경기 페이지의 임시 변경과 과거 경기의 당시 티어는 이 설정을 바꾸지 않습니다. 변경 사유를 적고 반영하세요.</p>' +
      '<div class="badminton-tier-list">' + players.players.map(p => '<div class="badminton-tier-row" data-player-id="' + p.id + '"><strong>' + safe([...badmintonKoreanNames.values()].includes(badmintonNameKey(p.name))?badmintonNameKey(p.name):p.name) + '</strong>'+badmintonRecentResults(sessions,p)+'<label>기본 티어<select data-badminton-tier="' + p.id + '" ' + '' + '>' + [1,2,3].map(n => '<option value="' + n + '" ' + (n === p.tier ? 'selected' : '') + '>' + n + '티어</option>').join('') + '</select></label><label>변경 사유<input data-badminton-reason="' + p.id + '" ' + '' + ' maxlength="500" placeholder="경기 기록을 참고한 판단"></label><details><summary>변경 이력 ' + p.history.length + '건</summary>' + p.history.map(h => '<p class="note">' + safe(h.at) + ' / ' + (h.from ?? '신규') + ' → ' + h.to + ' / ' + safe(h.reason) + '</p>').join('') + '</details></div>').join('') + '</div>' +
      (players.players.length ? '<button id="badminton-stage-tiers" type="button">티어를 변경사항에 반영</button>' : '<p class="note">첫 경기 MD를 반영하면 선수 명단이 등록됩니다. 경기 운영 페이지에서 신규 선수를 추가하세요.</p>') +
      '<h3>저장된 모임</h3>' + index.sessions.slice().sort((a,b) => b.date.localeCompare(a.date)).map(s => '<details class="badminton-record"><summary>' + safe(s.date + ' · ' + s.title) + '</summary>' + badmintonResultTable(sessions.find(x => x.id === s.id)) + '</details>').join('') + '</div>';
    $('#badminton-import').onchange = async e => {
      if (busy) return;
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      if (!guardForm()) return;
      setBusy(true);
      try {
        if (file.size > 1024 * 1024) throw Error('MD 파일은 1MB 이하로 선택하세요.');
        const imported = badminton.fromMarkdown(await file.text());
        if (!imported.matches.every(m => m.finished)) throw Error('모든 경기를 확정한 MD만 게시할 수 있습니다. 경기 운영 페이지에서 마무리하세요.');
        // Loading an existing unindexed path is not permission to overwrite it.
        const path = 'badminton/records/' + imported.id + '.md';
        const original = await getDraft(path, BRANCH, true);
        if (original.sha && !index.sessions.some(s => s.id === imported.id)) throw Error('같은 ID의 파일이 이미 있지만 목록에 없습니다. 원본을 확인하세요.');
        const existingPlayers = new Map(players.players.map(p => [p.id,p]));
        for (const p of imported.players) {
          if (existingPlayers.has(p.id) && badmintonNameKey(existingPlayers.get(p.id).name) !== badmintonNameKey(p.name)) throw Error('기존 선수 ID와 이름이 다릅니다: ' + p.name);
          if (!existingPlayers.has(p.id) && players.players.some(q => badmintonNameKey(q.name) === badmintonNameKey(p.name))) throw Error('같은 이름의 다른 선수 ID가 있습니다. 게시된 명단을 사용해 MD의 선수를 확인하세요: ' + p.name);
        }
        const data=badmintonData(),filename='records/'+imported.id+'.md';
        const existed=data.index.sessions.some(s=>s.id===imported.id);
        data.index.sessions=[...data.index.sessions.filter(s=>s.id!==imported.id),{id:imported.id,title:imported.title,date:imported.date,file:filename}];
        for(const p of imported.players)if(!data.players.players.some(q=>q.id===p.id))data.players.players.push({...p,history:[{from:null,to:p.tier,at:new Date().toISOString(),reason:'첫 경기 기록에서 등록'}]});
        // 모든 내용을 검증한 뒤 초안에 함께 반영합니다.
        const recordText=badminton.markdown(imported),indexText=JSON.stringify(badminton.index(data.index),null,2)+'\n',playersText=JSON.stringify(badminton.roster(data.players),null,2)+'\n';
        stageBadminton('badminton/'+filename,recordText);
        stageBadminton(badmintonPaths.index,indexText);
        stageBadminton(badmintonPaths.players,playersText);
        operationCount++;formDirty=false;renderBadminton();updateDraftStatus();
        status((existed?'기존 모임 수정':'새 모임 추가')+'을 변경사항에 자동 반영했습니다. 기본 티어를 확인하고 상단에서 업로드하세요.');
      } catch (e) { status(e.message,true); }
      finally { setBusy(false); }
    };
    const stageTiers = $('#badminton-stage-tiers');
    if (stageTiers) stageTiers.onclick = () => {
      if (busy) return;
      try {
        const data = badmintonData(); let count = 0;
        for (const p of data.players.players) {
          const tier = Number($('[data-badminton-tier="' + p.id + '"]').value);
          if (tier === p.tier) continue;
          const reason = $('[data-badminton-reason="' + p.id + '"]').value.trim();
          if (!reason) throw Error(p.name + ': 티어 변경 사유를 입력하세요.');
          p.history.push({from:p.tier,to:tier,at:new Date().toISOString(),reason}); p.tier=tier; count++;
        }
        if (!count) {formDirty=false;return status('변경된 티어가 없습니다.');}
        stageBadminton(badmintonPaths.players,JSON.stringify(badminton.roster(data.players),null,2)+'\n');
        operationCount++; formDirty=false; renderBadminton(); updateDraftStatus(); status(count+'명의 티어를 반영했습니다. 상단에서 업로드하세요.');
      } catch (e) { status(e.message,true); }
    };
    $('#items').oninput = e => { if (page==='badminton' && (e.target.dataset.badmintonTier || e.target.dataset.badmintonReason)) formDirty=true; };
    $('#items').onchange = $('#items').oninput;
  }
  function badmintonResultTable(s) {
    return '<div class="badminton-table"><table><thead><tr><th>경기</th><th>대진</th><th>점수</th></tr></thead><tbody>' + s.matches.map(m => '<tr><td>' + safe(m.id) + '</td><td>' + m.teams.map(id => safe(s.teams.find(t => t.id===id).name)).join(' vs ') + '</td><td>' + badminton.replay(s,m).score.join(' : ') + '</td></tr>').join('') + '</tbody></table></div>';
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
    lookupRequest?.abort();lookupRequest=null;token = ''; $('#token').value = ''; doc = null; source = ''; sha = ''; user = ''; selected = null; pending = null; drafts.clear(); clearImages(); operationCount = 0; formDirty = false;
    $('#editor').hidden = true; $('#login').hidden = false; updateDraftStatus(); status('연결을 해제했습니다.');
  };
  $('#tabs').onclick = async e => {
    const button = e.target.closest('[data-page]');
    if (busy || !button || button.dataset.page === page || !guardForm()) return;
    lookupRequest?.abort();lookupRequest=null;const previous = page; page = button.dataset.page; setBusy(true);
    try {
      $('#search').value = ''; await load();
      for (const b of $('#tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
    } catch (err) { page = previous; render(); status(err.message, true); }
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
  $('#cancel').onclick = () => {lookupRequest?.abort();lookupRequest=null;$('#form-area').hidden = true; selected = null; pending = null; formDirty = false;};
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
