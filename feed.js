// feed.js — busca e interpretação de feeds
// Formatos: RSS 0.9x / 2.0, RSS 1.0 (RDF), Atom 0.3 / 1.0, JSON Feed 1.x
// Também: feeds em ISO-8859-1 etc., XML levemente quebrado, descoberta
// automática a partir de URL de site, YouTube (canal) e Reddit (subreddit).

// ---------- rede (proxies públicos + cache local, sem backend) ----------
// Feeds não enviam CORS, então o navegador não consegue lê-los direto. Sem
// servidor próprio, a busca passa por proxies públicos, com cache local para
// não depender deles a cada abertura:
//   1) cache fresco (TTL de 20 min) → nenhuma requisição;
//   2) proxy que funcionou por último → tentativa isolada;
//   3) corrida entre os demais proxies + acesso direto (alguns feeds mandam CORS);
//   4) tudo falhou → devolve o cache antigo, marcado como "stale".
const LS_CACHE = 'rss.cache';
const LS_RANK = 'rss.proxyRank';

const PUBLIC_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  // corsfix quer a URL crua depois de "?" (não aceita encodeURIComponent)
  (u) => `https://proxy.corsfix.com/?${u}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// github.com/{owner}/{repo}/commits[.atom | /{branch}.atom] → API oficial,
// que manda CORS e dispensa proxy.
const GITHUB_COMMITS = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/commits(?:\/([^/?#]+))?\.atom\/?(?:[?#].*)?$/i;

function githubApiUrl(raw) {
  const m = GITHUB_COMMITS.exec(String(raw || ''));
  if (!m) return '';
  const [, owner, repo, branch] = m;
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=30`;
  return branch ? `${url}&sha=${encodeURIComponent(branch)}` : url;
}

const CACHE_TTL = 20 * 60 * 1000;
const CACHE_MAX_ENTRIES = 30;
const CACHE_MAX_CHARS = 200 * 1024;

const DIRECT_TIMEOUT = 6000;
const PROXY_TIMEOUT = 12000;

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------- cache local ----------
let cache = loadJson(LS_CACHE, {});
let cacheTimer = null;

function cacheGet(url) {
  const e = cache[url];
  return e && typeof e.body === 'string' ? e : null;
}

function cacheSet(url, body) {
  if (typeof body !== 'string' || body.length > CACHE_MAX_CHARS) return;
  cache[url] = { t: Date.now(), body };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0))
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach((k) => { delete cache[k]; });
  }
  if (!cacheTimer) cacheTimer = setTimeout(saveCache, 400);
}

function saveCache() {
  cacheTimer = null;
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify(cache));
  } catch {
    // cota estourada: descarta metade das entradas mais antigas e tenta de novo
    const keys = Object.keys(cache).sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
    keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => { delete cache[k]; });
    try { localStorage.setItem(LS_CACHE, JSON.stringify(cache)); } catch { /* desiste */ }
  }
}

// Usados pela aba Configurações
function cacheStats() {
  const keys = Object.keys(cache);
  let chars = 0;
  for (const k of keys) chars += (cache[k].body || '').length;
  return { count: keys.length, chars };
}

function clearCache() {
  for (const k of Object.keys(cache)) delete cache[k];
  if (cacheTimer) { clearTimeout(cacheTimer); cacheTimer = null; }
  try { localStorage.removeItem(LS_CACHE); } catch { /* ignora */ }
}

// ---------- ranking de proxy ----------
let rank = (() => {
  try {
    const v = parseInt(localStorage.getItem(LS_RANK) || '', 10);
    return Number.isInteger(v) && v >= 0 && v < PUBLIC_PROXIES.length ? v : -1;
  } catch {
    return -1;
  }
})();

function rememberProxy(i) {
  if (rank === i) return;
  rank = i;
  try { localStorage.setItem(LS_RANK, String(i)); } catch { /* ignora */ }
}

async function getOnce(url, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await readBody(res);
    const head = text.trimStart();
    if (!head.startsWith('<') && !head.startsWith('{') && !head.startsWith('[')) throw new Error('resposta inválida');
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('tempo esgotado');
    if (e.name === 'TypeError') throw new Error('bloqueado (CORS/rede)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function fetchError(errors) {
  const msgs = [...new Set(errors.map((e) => String((e && e.message) || e)))];
  const detail = msgs.slice(0, 2).join('; ') || 'falha ao buscar';
  return new Error(`${detail} — o site pode estar bloqueando acesso externo ou os proxies estão indisponíveis`);
}

// Decodifica respeitando o charset declarado (header ou <?xml encoding="...">)
async function readBody(res) {
  const buf = await res.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  const decl = text.slice(0, 300).match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i);
  const hdr = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i);
  const enc = (decl && decl[1]) || (hdr && hdr[1]);
  if (enc && !/^utf-?8$/i.test(enc)) {
    try { text = new TextDecoder(enc).decode(buf); } catch { /* mantém utf-8 */ }
  }
  return text;
}

// Erros definitivos da API do GitHub: não adianta repetir por proxy.
function githubError(e) {
  const m = /^HTTP (\d{3})/.exec(String((e && e.message) || ''));
  if (!m) return null;
  const status = Number(m[1]);
  if (status === 403 || status === 429) {
    return new Error('limite de requisições do GitHub atingido (60/h) — tente mais tarde');
  }
  if (status === 404) return new Error('repositório do GitHub não encontrado ou privado');
  if (status === 409) return new Error('repositório do GitHub sem commits');
  if (status === 451) return new Error('repositório do GitHub indisponível por questões legais');
  return new Error(`GitHub respondeu HTTP ${status}`);
}

// Devolve { text, cached, stale, at }. Com cache fresco não há requisição;
// se a rede falhar, o cache antigo é usado como último recurso (stale).
async function fetchText(url, { force = false } = {}) {
  const hit = cacheGet(url);
  if (hit && !force && Date.now() - hit.t < CACHE_TTL) {
    return { text: hit.body, cached: true, stale: false, at: hit.t };
  }

  const errors = [];
  const target = githubApiUrl(url);
  const request = target || url;

  // Feeds de commits do GitHub: a API manda CORS, então vai direto antes de
  // gastar proxy. Erros HTTP dela (limite, repo privado) são definitivos.
  if (target) {
    try {
      const text = await getOnce(request, DIRECT_TIMEOUT * 2);
      cacheSet(url, text);
      return { text, cached: false, stale: false, at: Date.now() };
    } catch (e) {
      const gh = githubError(e);
      if (gh) throw gh;
      errors.push(e);
    }
  }

  // 1) proxy vencedor da última vez, sozinho (economiza cota dos demais)
  if (rank >= 0) {
    try {
      const text = await getOnce(PUBLIC_PROXIES[rank](request), PROXY_TIMEOUT);
      cacheSet(url, text);
      return { text, cached: false, stale: false, at: Date.now() };
    } catch (e) {
      errors.push(e);
    }
  }

  // 2) corrida: demais proxies + acesso direto (grátis quando o site manda CORS)
  const tasks = PUBLIC_PROXIES
    .map((build, i) => ({ build, i }))
    .filter(({ i }) => i !== rank)
    .map(async ({ build, i }) => {
      try {
        const text = await getOnce(build(request), PROXY_TIMEOUT);
        rememberProxy(i);
        cacheSet(url, text);
        return text;
      } catch (e) {
        errors.push(e);
        throw e;
      }
    });

  tasks.push((async () => {
    try {
      const text = await getOnce(request, DIRECT_TIMEOUT);
      cacheSet(url, text);
      return text;
    } catch (e) {
      errors.push(e);
      throw e;
    }
  })());

  try {
    const text = await Promise.any(tasks);
    return { text, cached: false, stale: false, at: Date.now() };
  } catch {
    if (hit) return { text: hit.body, cached: true, stale: true, at: hit.t };
    throw fetchError(errors);
  }
}

// ---------- utilidades ----------
const isHttp = (u) => /^https?:\/\//i.test(u || '');

// Resolve links relativos do feed e descarta esquemas que não sejam http(s).
function siteHref(raw, feedUrl) {
  if (!raw) return '';
  try {
    const u = new URL(raw, feedUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

// Chave estável para deduplicar posts: mesmo link em feeds diferentes vira um item
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|igshid$|ref$|source$|ref_src$)/i;

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.protocol = u.protocol.toLowerCase();
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    const s = u.href;
    return u.pathname === '/' ? s.replace(/^(\w+:\/\/[^/]+)\//, '$1') : s;
  } catch {
    return String(raw || '').trim();
  }
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

// Filhos diretos + filhos de <media:group> (usado pelo YouTube)
function kidsOf(parent) {
  const out = [...parent.children];
  for (const c of parent.children) if (c.localName === 'group') out.push(...c.children);
  return out;
}

const matches = (el, name) => el.nodeName === name || el.localName === name;

const child = (parent, name) =>
  parent ? kidsOf(parent).find((c) => matches(c, name)) : undefined;

// Primeiro texto não vazio entre os nomes dados (aceita qualquer prefixo de namespace)
function childText(parent, ...names) {
  if (!parent) return '';
  const kids = kidsOf(parent);
  for (const n of names) {
    const c = kids.find((k) => matches(k, n) && k.textContent.trim());
    if (c) return c.textContent.trim();
  }
  return '';
}

function firstImage(node, html) {
  for (const c of kidsOf(node)) {
    const n = c.localName;
    const type = c.getAttribute('type') || '';
    if (n === 'enclosure' && type.startsWith('image/')) return c.getAttribute('url');
    if (n === 'thumbnail' && c.getAttribute('url')) return c.getAttribute('url');
    if (n === 'content' && c.getAttribute('url') &&
        (c.getAttribute('medium') === 'image' || type.startsWith('image/'))) {
      return c.getAttribute('url');
    }
    if (n === 'image' && c.getAttribute('href')) return c.getAttribute('href');      // itunes:image
    if (n === 'link' && c.getAttribute('rel') === 'enclosure' && type.startsWith('image/')) {
      return c.getAttribute('href');
    }
  }
  if (html) {
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
    if (img) return img.getAttribute('src');
  }
  return '';
}

// Texto/HTML de um elemento (se for XHTML embutido, mantém as tags)
function childHtml(parent, ...names) {
  if (!parent) return '';
  const kids = kidsOf(parent);
  for (const n of names) {
    const c = kids.find((k) => matches(k, n) && k.textContent.trim());
    if (c) return c.children.length && c.getAttribute('type') === 'xhtml' ? c.innerHTML : c.textContent.trim();
  }
  return '';
}

// ---------- vídeo / áudio ----------
const YT_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/;
const ytEmbed = (id) => ({ kind: 'embed', url: `https://www.youtube-nocookie.com/embed/${id}` });

// files: [{ url, type, medium }]  →  { kind: 'embed' | 'file' | 'audio', url, type } | null
function detectVideo(link, files = [], ytId = '') {
  const y = YT_RE.exec(link || '');
  if (y) return ytEmbed(y[1]);
  if (/^[\w-]{11}$/.test(ytId)) return ytEmbed(ytId);
  const v = VIMEO_RE.exec(link || '');
  if (v) return { kind: 'embed', url: `https://player.vimeo.com/video/${v[1]}` };

  const ok = files.filter((f) => isHttp(f.url));
  const vid = ok.find((f) => f.type.startsWith('video/') || f.medium === 'video');
  if (vid) return { kind: 'file', url: vid.url, type: vid.type };
  const aud = ok.find((f) => f.type.startsWith('audio/') || f.medium === 'audio');
  if (aud) return { kind: 'audio', url: aud.url, type: aud.type };
  return null;
}

function xmlFiles(node) {
  return kidsOf(node)
    .filter((c) => ['enclosure', 'content', 'link'].includes(c.localName) &&
      (c.getAttribute('url') || c.getAttribute('rel') === 'enclosure'))
    .map((c) => ({
      url: c.getAttribute('url') || c.getAttribute('href') || '',
      type: (c.getAttribute('type') || '').toLowerCase(),
      medium: (c.getAttribute('medium') || '').toLowerCase(),
    }));
}

function buildItem({ id, title, link, rawDate, html, image, video }) {
  const t = rawDate ? new Date(rawDate).getTime() : NaN;
  let summary = html ? htmlToText(html) : '';
  if (summary.length > 240) summary = summary.slice(0, 240).trimEnd() + '…';
  const name = htmlToText(title || '') || '(sem título)';
  return {
    id: link || id || name + (rawDate || ''),
    title: name,
    link: isHttp(link) ? link : '',
    date: Number.isNaN(t) ? 0 : t,
    summary,
    content: html || '',
    video: video || null,
    image: isHttp(image) ? image : '',
  };
}

// ---------- XML (RSS / RDF / Atom) ----------
function parseXml(text) {
  let doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) {
    // tenta consertar problemas comuns: caracteres de controle, & solto, &nbsp;
    const cleaned = text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&nbsp;/g, '&#160;')
      .replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)/g, '&amp;');
    doc = new DOMParser().parseFromString(cleaned, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML inválido');
  }
  return doc;
}

// Ícone declarado pelo próprio feed (RSS <image>, Atom <icon>/<logo>, itunes:image)
function feedIcon(container) {
  if (!container) return '';
  const image = child(container, 'image');
  const imageUrl = image ? childText(image, 'url') : '';
  if (isHttp(imageUrl)) return imageUrl;

  const icon = childText(container, 'icon', 'logo');
  if (isHttp(icon)) return icon;

  for (const c of kidsOf(container)) {
    if (c.localName === 'image' && isHttp(c.getAttribute('href'))) return c.getAttribute('href');
  }
  return '';
}

function parseXmlFeed(text, feedUrl) {
  const doc = parseXml(text);
  const root = doc.documentElement;
  const kind = root.localName;                       // rss | feed | RDF
  if (!['rss', 'feed', 'RDF'].includes(kind)) throw new Error('não parece um feed');

  const isAtom = kind === 'feed';
  const container = isAtom ? root : (child(root, 'channel') || root);
  const title = childText(container, 'title') || feedUrl;

  // Link do site original: <link> do canal (RSS) ou rel="alternate" (Atom).
  let site = '';
  if (isAtom) {
    const links = [...container.children].filter((c) => c.localName === 'link' && c.getAttribute('href'));
    const pick = links.find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate') || links[0];
    if (pick) site = pick.getAttribute('href');
  } else {
    site = childText(container, 'link');
  }

  const nodes = [...doc.getElementsByTagNameNS('*', isAtom ? 'entry' : 'item')];

  const items = nodes.slice(0, 50).map((n) => {
    let link = '';
    if (isAtom) {
      const links = [...n.children].filter((c) => c.localName === 'link');
      const pick = links.find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate') || links[0];
      link = pick ? pick.getAttribute('href') || '' : '';
    } else {
      link = childText(n, 'link');
      if (!isHttp(link)) {
        const g = child(n, 'guid');
        if (g && isHttp(g.textContent.trim())) link = g.textContent.trim();
        else link = n.getAttribute('rdf:about') || link;       // RSS 1.0
      }
    }
    if (link) { try { link = new URL(link, feedUrl).href; } catch { /* mantém */ } }

    const html = childHtml(n, 'encoded', 'description', 'summary', 'content');

    return buildItem({
      id: childText(n, 'guid', 'id'),
      title: childText(n, 'title'),
      link,
      rawDate: childText(n, 'pubDate', 'published', 'updated', 'date', 'issued', 'created', 'modified'),
      html,
      image: firstImage(n, html),
      video: detectVideo(link, xmlFiles(n), childText(n, 'videoId')),
    });
  });

  return { title: htmlToText(title), icon: feedIcon(container), site: siteHref(site, feedUrl), items };
}

// ---------- JSON Feed ----------
function parseJsonFeed(text, feedUrl) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON inválido'); }
  if (!data || !Array.isArray(data.items)) throw new Error('não parece um feed');

  const items = data.items.slice(0, 50).map((it) => {
    const att = Array.isArray(it.attachments)
      ? it.attachments.find((a) => (a.mime_type || '').startsWith('image/'))
      : null;
    return buildItem({
      id: it.id != null ? String(it.id) : '',
      title: it.title || '',
      link: it.url || it.external_url || '',
      rawDate: it.date_published || it.date_modified || '',
      html: it.summary || it.content_text || it.content_html || '',
      image: it.image || it.banner_image || (att && att.url) || '',
      video: detectVideo(
        it.url || it.external_url || '',
        (it.attachments || []).map((a) => ({ url: a.url, type: (a.mime_type || '').toLowerCase(), medium: '' }))
      ),
    });
  });

  return {
    title: htmlToText(data.title || feedUrl),
    icon: isHttp(data.icon || data.favicon) ? (data.icon || data.favicon) : '',
    site: siteHref(data.home_page_url, feedUrl),
    items,
  };
}

// ---------- GitHub (commits via API) ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ESC[c]);

function parseGithubCommits(text, feedUrl) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON inválido'); }
  if (!Array.isArray(data)) throw new Error('não parece um feed');

  const m = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(String(feedUrl));
  const owner = m ? m[1] : '';
  const repo = m ? m[2] : '';

  const items = data.slice(0, 50).map((c) => {
    const commit = c.commit || {};
    const lines = String(commit.message || '').trim().split('\n');
    const first = lines[0] || '';
    const title = first.length > 160 ? first.slice(0, 160).trimEnd() + '…' : first;
    const body = lines.slice(1).join('\n').trim();
    const author = (c.author && c.author.login) || (commit.author && commit.author.name) || '';
    const sha = String(c.sha || '').slice(0, 7);
    const link = isHttp(c.html_url) ? c.html_url : '';

    const parts = [];
    if (body) parts.push(`<pre>${escHtml(body)}</pre>`);
    if (link) parts.push(`<p><a href="${escHtml(link)}">${escHtml(sha || 'commit')}</a>${author ? ' — ' + escHtml(author) : ''}</p>`);
    else if (author) parts.push(`<p>${escHtml(author)}</p>`);

    return buildItem({
      id: c.sha || '',
      title: title || sha || '(sem mensagem)',
      link,
      rawDate: (commit.author && commit.author.date) || (commit.committer && commit.committer.date) || '',
      html: parts.join('\n'),
      image: (c.author && c.author.avatar_url) || '',
      video: null,
    });
  });

  return {
    title: owner && repo ? `${owner}/${repo}` : 'Commits',
    icon: owner ? `https://github.com/${owner}.png` : '',
    site: owner && repo ? `https://github.com/${owner}/${repo}` : '',
    items,
  };
}

// ---------- entrada única ----------
function parseFeed(text, feedUrl) {
  const t = text.trim();
  if (t.startsWith('[')) return parseGithubCommits(t, feedUrl);
  return t.startsWith('{') ? parseJsonFeed(t, feedUrl) : parseXmlFeed(t, feedUrl);
}

// ---------- descoberta de feed a partir de URL de site ----------
const COMMON_PATHS = ['/feed', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed.json'];

// "channelId":"UC…", "externalId":"UC…" ou <meta itemprop="channelId" content="UC…">
const YT_CHANNEL_ID = /"channelId":"(UC[\w-]{22})"|"externalId":"(UC[\w-]{22})"|itemprop=["']channelId["'][^>]*content=["'](UC[\w-]{22})["']/i;

async function youtubeChannelId(pageUrl) {
  try {
    const { text } = await fetchText(pageUrl);
    const m = YT_CHANNEL_ID.exec(text);
    return m ? (m[1] || m[2] || m[3]) : '';
  } catch {
    return '';
  }
}

// Traduz URLs conhecidas (YouTube, Reddit) para o endereço do feed
async function resolveKnownUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const byId = u.pathname.match(/^\/channel\/(UC[\w-]+)/);
    if (byId) return `https://www.youtube.com/feeds/videos.xml?channel_id=${byId[1]}`;

    const list = u.searchParams.get('list');
    if (u.pathname === '/playlist' && /^[\w-]+$/.test(list || '')) {
      return `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`;
    }

    if (/^\/(?:@[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(u.pathname)) {
      const id = await youtubeChannelId(raw);
      if (id) return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    }
    return raw;
  }

  if (host === 'reddit.com' || host === 'old.reddit.com') {
    const path = u.pathname.replace(/\/+$/, '');
    if (/^\/(?:r|user|u)\/[^/]+(?:\/(?:hot|new|top|rising|controversial))?$/.test(path)) {
      return `https://www.reddit.com${path}/.rss`;
    }
  }

  return raw;
}

function discoverFromHtml(text, baseUrl) {
  const html = new DOMParser().parseFromString(text, 'text/html');
  return [...html.querySelectorAll('link[rel~="alternate"]')]
    .filter((l) => /rss|atom|feed\+json|rdf/i.test(l.getAttribute('type') || ''))
    .map((l) => { try { return new URL(l.getAttribute('href'), baseUrl).href; } catch { return null; } })
    .filter(Boolean);
}

// Aceita URL de feed (qualquer formato) ou de site
async function resolveFeed(input) {
  const url = await resolveKnownUrl(input);
  const { text } = await fetchText(url);

  try {
    return { url, ...parseFeed(text, url) };
  } catch (firstErr) {
    // parece um feed, mas está quebrado: mostra o erro real
    if (/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000))) throw firstErr;

    // 1) <link rel="alternate"> no HTML
    for (const cand of discoverFromHtml(text, url)) {
      try {
        const body = (await fetchText(cand)).text;
        return { url: cand, ...parseFeed(body, cand) };
      } catch { /* próximo */ }
    }

    // 2) caminhos comuns na raiz do site, em lotes de 2 (limita requisições)
    const origin = new URL(url).origin;
    for (let i = 0; i < COMMON_PATHS.length; i += 2) {
      try {
        return await Promise.any(COMMON_PATHS.slice(i, i + 2).map(async (p) => {
          const u = origin + p;
          const body = (await fetchText(u)).text;
          return { url: u, ...parseFeed(body, u) };
        }));
      } catch { /* próximo lote */ }
    }
    throw new Error('nenhum feed encontrado nessa URL');
  }
}

// ---------- árvore de feeds e pastas ----------
// Modelo salvo em localStorage na chave "tree":
//   feed:   { id, type: 'feed', title, url, icon?, site? }
//   folder: { id, type: 'folder', name, open, children: [] }
const TREE_KEY = 'tree';
const LEGACY_FEEDS = 'rss.feeds';
const LEGACY_FOLDERS = 'rss.folders';
const LEGACY_CLOSED = 'rss.foldersClosed';

const newNodeId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* contexto sem crypto */ }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

const feedNode = ({ title, url, icon, site } = {}) => {
  const node = { id: newNodeId(), type: 'feed', title: title || url || 'Feed', url: String(url || '') };
  if (icon) node.icon = icon;
  if (site) node.site = String(site);
  return node;
};

const folderNode = (name, open = true, children = []) =>
  ({ id: newNodeId(), type: 'folder', name: String(name || 'Pasta'), open: open !== false, children });

function saveTree(tree) {
  try { localStorage.setItem(TREE_KEY, JSON.stringify(tree)); } catch { /* cota cheia */ }
}

// Divide "A / B" (ou "A/B") em partes; mantém compatibilidade com o formato antigo
function pathParts(path) {
  return String(path || '').split('/').map((s) => s.trim()).filter(Boolean);
}

// Converte rss.feeds/rss.folders/rss.foldersClosed (formato antigo com category "A / B")
function migrateLegacyTree() {
  const legacyFeeds = loadJson(LEGACY_FEEDS, []);
  const legacyFolders = loadJson(LEGACY_FOLDERS, []);
  const legacyClosed = loadJson(LEGACY_CLOSED, []);
  const closed = new Set(
    (Array.isArray(legacyClosed) ? legacyClosed : [])
      .map((p) => pathParts(p).join(' / '))
  );

  const root = [];
  const known = new Map();   // caminho -> nó de pasta

  const ensure = (path) => {
    const parts = pathParts(path);
    let list = root;
    let key = '';
    let node = null;
    for (const part of parts) {
      key = key ? `${key} / ${part}` : part;
      node = known.get(key);
      if (!node) {
        node = folderNode(part, !closed.has(key));
        known.set(key, node);
        list.push(node);
      }
      list = node.children;
    }
    return node;
  };

  if (Array.isArray(legacyFeeds)) {
    for (const f of legacyFeeds) {
      if (!f || !f.url) continue;
      const category = Array.isArray(f.category) ? f.category.join(' / ') : f.category;
      const parts = pathParts(category);
      const parent = parts.length ? ensure(category) : null;
      (parent ? parent.children : root).push(feedNode(f));
    }
  }
  if (Array.isArray(legacyFolders)) legacyFolders.forEach((p) => { if (pathParts(p).length) ensure(p); });

  saveTree(root);
  return root;
}

function loadTree() {
  const raw = loadJson(TREE_KEY, null);
  if (Array.isArray(raw)) return raw;
  return migrateLegacyTree();
}

function findNode(tree, id) {
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (!n) continue;
      if (n.id === id) return n;
      if (n.type === 'folder') {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(tree);
}

// Lista que contém o nó, seu índice e a pasta-mãe (null na raiz)
function findParent(tree, id) {
  const walk = (nodes, parent) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.id === id) return { list: nodes, index: i, parent };
      if (n.type === 'folder') {
        const hit = walk(n.children || [], n);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(tree || [], null);
}

function allFeeds(tree) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.type === 'feed') out.push(n);
      else if (n.type === 'folder') walk(n.children);
    }
  };
  walk(tree);
  return out;
}

function allFolders(tree) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.type === 'folder') { out.push(n); walk(n.children); }
    }
  };
  walk(tree);
  return out;
}

// Caminho de nomes até a pasta; null se não existir
function folderPath(tree, id) {
  const walk = (nodes, trail) => {
    for (const n of nodes || []) {
      if (n.type !== 'folder') continue;
      const path = [...trail, n.name];
      if (n.id === id) return path;
      const hit = walk(n.children, path);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, []);
}

function feedByUrl(tree, url) {
  return allFeeds(tree).find((f) => f.url === url) || null;
}

function isDescendant(tree, ancestorId, id) {
  if (!id) return false;
  const ancestor = findNode(tree, ancestorId);
  if (!ancestor || ancestor.type !== 'folder') return false;
  const walk = (nodes) => (nodes || []).some((n) =>
    n.id === id || (n.type === 'folder' && walk(n.children)));
  return walk(ancestor.children);
}

function createFolder(tree, name, parentId = '') {
  const clean = String(name || '').trim();
  if (!clean) return { error: 'informe um nome' };

  const parent = parentId ? findNode(tree, parentId) : null;
  if (parentId && (!parent || parent.type !== 'folder')) return { error: 'destino inválido' };

  const list = parent ? parent.children : tree;
  const exists = list.some((n) => n.type === 'folder' &&
    n.name.localeCompare(clean, 'pt-BR', { sensitivity: 'base' }) === 0);
  if (exists) return { error: 'já existe uma pasta com esse nome aqui' };

  const node = folderNode(clean, true);
  list.push(node);
  if (parent) parent.open = true;
  return { node };
}

function renameFolder(tree, id, name) {
  const clean = String(name || '').trim();
  if (!clean) return { error: 'informe um nome' };

  const node = findNode(tree, id);
  if (!node || node.type !== 'folder') return { error: 'pasta não encontrada' };

  const loc = findParent(tree, id);
  const siblings = loc ? loc.list : tree;
  const exists = siblings.some((n) => n !== node && n.type === 'folder' &&
    n.name.localeCompare(clean, 'pt-BR', { sensitivity: 'base' }) === 0);
  if (exists) return { error: 'já existe uma pasta com esse nome aqui' };

  node.name = clean;
  return { node };
}

// mode: 'root' move os filhos para a raiz; 'delete' apaga a subárvore inteira
function deleteFolder(tree, id, mode = 'root') {
  const node = findNode(tree, id);
  if (!node || node.type !== 'folder') return false;
  const loc = findParent(tree, id);
  if (!loc) return false;

  loc.list.splice(loc.index, 1);
  if (mode === 'root') tree.push(...node.children);
  return true;
}

function removeTreeNode(tree, id) {
  const loc = findParent(tree, id);
  if (!loc) return false;
  loc.list.splice(loc.index, 1);
  return true;
}

function moveNode(tree, id, parentId = '', index = null) {
  const loc = findParent(tree, id);
  if (!loc) return false;

  const node = loc.list[loc.index];
  if (node.type === 'folder' && (parentId === id || isDescendant(tree, id, parentId))) return false;

  const target = parentId ? findNode(tree, parentId) : null;
  if (parentId && (!target || target.type !== 'folder')) return false;

  const dest = target ? target.children : tree;
  const sameList = loc.list === dest;
  loc.list.splice(loc.index, 1);

  let at = dest.length;
  if (index !== null && Number.isFinite(index)) {
    at = Math.max(0, Math.min(index, dest.length + 1));
    if (sameList && loc.index < at) at--;   // o próprio nó já saiu da lista
    at = Math.min(at, dest.length);
  }
  dest.splice(at, 0, node);
  if (target) target.open = true;
  return true;
}

