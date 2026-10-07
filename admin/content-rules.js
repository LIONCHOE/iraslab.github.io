/* Shared content rules for the administrator's drafts and publication upload. */
(() => {
  'use strict';
  const types = ['International Journal', 'Domestic Journal', 'International Conference', 'Domestic Conference', 'Patent'];
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function citationMonth(text) {
    // Ignore the quoted title, where a word such as "May" can occur.
    const citation = String(text || '');
    const tail = citation.slice(citation.lastIndexOf('"') + 1);
    const matches = [...tail.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\b/gi)];
    if (matches.length) return months.indexOf(matches.at(-1)[1].slice(0, 3).toLowerCase()) + 1;
    const numeric = tail.match(/\b(?:19|20)\d{2}[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?\b/);
    return numeric ? Number(numeric[1]) : 0;
  }
  function publicationDate(node) {
    const rawYear = node.dataset.pubYear;
    const citation = node.querySelector('p + p')?.textContent || '';
    const years = citation.match(/\b(?:19|20)\d{2}\b/g);
    const year = /^\d{4}$/.test(rawYear || '') ? Number(rawYear) : rawYear === 'unknown' ? 0 : Number(years?.at(-1) || 0);
    const explicit = node.dataset.pubMonth;
    const month = explicit !== undefined ? Number(explicit) : citationMonth(citation);
    return {year, month: month >= 1 && month <= 12 ? month : 0};
  }
  function comparePublications(a, b) {
    const x = publicationDate(a), y = publicationDate(b);
    // Unknown month comes before all dated entries in the same year.
    return y.year - x.year || (y.month || 13) - (x.month || 13);
  }
  function normalizePublications(doc) {
    const parent = doc.querySelector('[data-pub-list]');
    if (!parent) throw new Error('논문 목록을 찾지 못했습니다.');
    const all = [...parent.querySelectorAll(':scope > li[data-pub]')];
    const ordered = [];
    for (const type of types) {
      const group = all.filter(n => n.dataset.pubType === type).sort(comparePublications);
      group.forEach((n, i) => { n.value = group.length - i; });
      ordered.push(...group);
      const button = [...doc.querySelectorAll('#pub-type-filters [data-type]')].find(n => n.dataset.type === type);
      if (button) button.textContent = `${type} (${group.length})`;
    }
    if (ordered.length !== all.length) throw new Error('알 수 없는 논문 분류가 있습니다. 분류를 확인하세요.');
    parent.append(...ordered);
    return ordered;
  }
  function alumniDate(node) {
    const trigger = node.querySelector('[data-person-trigger]');
    const role = trigger?.dataset.role || node.querySelector('p:not(.alumni-affiliation)')?.textContent || '';
    return {year: Number(role.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0), phd: /ph\s*\.?\s*d/i.test(role) ? 1 : 0};
  }
  function compareAlumni(a, b) {
    const x = alumniDate(a), y = alumniDate(b);
    return y.year - x.year || y.phd - x.phd;
  }
  function normalizePeople(doc) {
    const alumni = [...doc.querySelectorAll('main section')].find(s => s.querySelector(':scope > h2')?.textContent.trim() === 'Alumni');
    const grid = alumni?.querySelector(':scope > div');
    if (grid) grid.append(...[...grid.children].filter(n => n.matches('div')).sort(compareAlumni));
  }
  function syncRecentWork(home, publications) {
    const heading = [...home.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Recent work');
    const target = heading?.closest('section')?.querySelector('ol');
    if (!target) throw new Error('메인의 Recent work 목록을 찾지 못했습니다.');
    const latest = [...publications.querySelectorAll('li[data-pub]')]
      .filter(n => n.dataset.pubType === 'International Journal').sort(comparePublications).slice(0, 5);
    target.replaceChildren(...latest.map(n => {
      const clone = home.importNode(n, true);
      clone.removeAttribute('value'); clone.removeAttribute('hidden');
      return clone;
    }));
    return latest.length;
  }
  window.IRASContentRules = {types, citationMonth, publicationDate, comparePublications, normalizePublications, alumniDate, compareAlumni, normalizePeople, syncRecentWork};
})();
