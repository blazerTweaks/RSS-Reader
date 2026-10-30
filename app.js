// ---------- storage ----------
const LS_READ = 'rss.read';
const LS_ARCHIVED = 'rss.archived';
const LS_SIDE = 'rss.sidebar';
const LS_SETTINGS = 'rss.settings';
const LS_LAYOUT = 'rss.layout';

const load = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// Arquivo: [{ key, item }]. Aceita apenas registros completos de versões novas.
function loadArchived(raw) {
  const map = new Map();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (!entry || typeof entry.key !== 'string' || !entry.item || typeof entry.item !== 'object') continue;
    if (typeof entry.item.id !== 'string' || typeof entry.item.title !== 'string') continue;
    map.set(entry.key, entry.item);
  }
  return map;
}

// ---------- preferências (aba Configurações) ----------
const SETTINGS_DEFAULTS = {
  theme: 'dark',            // 'dark' | 'light' | 'system'
  accent: '#d97757',
  density: 'comfortable',   // 'comfortable' | 'compact'
  listFont: 'normal',       // 'small' | 'normal' | 'large'
  showThumbs: true,
  readerFont: 16,           // 14 | 16 | 18 | 20
  readerWidth: 'full',      // 'full' | 'comfortable'
  reduceMotion: false,
};

const ACCENT_PRESETS = ['#d97757', '#e0b45c', '#7fb77e', '#6fa8dc', '#b48ee0', '#e08a8a'];
const ACCENT_NAMES = ['Terracota', 'Âmbar', 'Verde', 'Azul', 'Lilás', 'Rosa'];
const LIST_FONTS = ['small', 'normal', 'large'];
const READER_FONTS = [14, 16, 18, 20];

// Divisórias arrastáveis: largura da barra lateral e da lista de posts.
const LAYOUT_DEFAULTS = { side: 280, list: 420 };
const LAYOUT_MIN = { side: 190, list: 280 };
const LAYOUT_MAX = { side: 460, list: 760 };
const READER_MIN_W = 320;   // espaço que o leitor sempre mantém

// Aceita #rgb e #rrggbb; devolve sempre #rrggbb (ou null se inválido).
function normalizeHex(value) {
  const s = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return null;
}

function loadSettings() {
  const raw = load(LS_SETTINGS, {});
  const s = { ...SETTINGS_DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;

  if (raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system') s.theme = raw.theme;
  const accent = normalizeHex(raw.accent);
  if (accent) s.accent = accent;
  if (raw.density === 'comfortable' || raw.density === 'compact') s.density = raw.density;
  if (LIST_FONTS.includes(raw.listFont)) s.listFont = raw.listFont;
  if (typeof raw.showThumbs === 'boolean') s.showThumbs = raw.showThumbs;
  if (READER_FONTS.includes(Number(raw.readerFont))) s.readerFont = Number(raw.readerFont);
  if (raw.readerWidth === 'full' || raw.readerWidth === 'comfortable') s.readerWidth = raw.readerWidth;
  if (typeof raw.reduceMotion === 'boolean') s.reduceMotion = raw.reduceMotion;
  return s;
}

// ---------- state ----------
// A árvore vem de feed.js (chave "tree"), com migração do formato antigo se preciso.
const initialTree = loadTree();
const initialArchived = loadArchived(load(LS_ARCHIVED, []));

const state = {
  tree: initialTree,                    // nós de pasta/feed (ver feed.js)
  feeds: allFeeds(initialTree),         // lista plana derivada da árvore
  read: new Set(load(LS_READ, [])),
  archived: initialArchived,            // chave estável -> cópia leve do post
  items: [],
  errors: {},                           // url -> mensagem
  stale: {},                            // url -> timestamp do cache usado
  active: 'all',                        // 'all' | 'unread' | url do feed
  query: '',
  loading: false,
  updatedAt: null,
  current: null,                        // item aberto no leitor
  readerToken: 0,                       // invalida carregamentos antigos
  readerList: [],                       // snapshot da lista usada por j/k
  full: new Map(),                      // id -> html do artigo completo
  settingsMsg: null,                    // { text, err } exibida na aba Configurações
  settings: loadSettings(),             // preferências de aparência/funcionamento
  layout: loadLayout(),                 // larguras das divisórias (px)
};

const $ = (s) => document.querySelector(s);

// Aplica tema, cor e variáveis antes do primeiro render.
applySettings();
applyLayout();

// ---------- ícones ----------
// Caminhos oficiais do Lucide (lucide.dev, licença ISC), embutidos para funcionar offline.
const ICONS = {
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'folder-symlink': '<path d="M2 9.35V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h7"/><path d="m8 16 3-3-3-3"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  'archive-restore': '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

const iconSvg = (name, size = 18) =>
  `<svg class="lucide lucide-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

function paintIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((n) => { n.innerHTML = iconSvg(n.dataset.icon); });
}

// ---------- ações ----------
function sourcesOf(item) {
  return item.feeds && item.feeds.length
    ? item.feeds
    : [{ url: item.feed, title: item.feedTitle }];
}

// Chave estável do arquivo: o link canônico sobrevive a refresh e à mesclagem de feeds.
const archiveKey = (item) => canonicalUrl(item.link) || item.id;
const isArchived = (item) => state.archived.has(archiveKey(item));

// Cópia leve: mantém o post no arquivo mesmo depois de ele sair do feed.
function archiveSnapshot(item) {
  const snap = { ...item };
  snap.feeds = sourcesOf(item).map((f) => ({ ...f }));
  return snap;
}

// Mescla o mesmo post vindo de feeds diferentes (link canônico igual)
function dedupeItems(items) {
  const groups = new Map();
  for (const it of items) {
    const key = canonicalUrl(it.link) || it.id;
    const cur = groups.get(key);
    if (!cur) {
      groups.set(key, { ...it, feeds: [{ url: it.feed, title: it.feedTitle }] });
      continue;
    }
    if (!cur.feeds.some((f) => f.url === it.feed)) cur.feeds.push({ url: it.feed, title: it.feedTitle });
    if (it.date && (!cur.date || it.date < cur.date)) cur.date = it.date;   // mantém a data original
    if (htmlToText(it.content || '').length > htmlToText(cur.content || '').length) {
      cur.content = it.content;
      if (it.summary) cur.summary = it.summary;
    }
    if (!cur.image && it.image) cur.image = it.image;
    if (!cur.video && it.video) cur.video = it.video;
  }
  return [...groups.values()];
}

async function refreshAll({ force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.errors = {};
  state.stale = {};
  renderTop();
  $('#btn-refresh').classList.add('loading');

  const results = await Promise.allSettled(
    state.feeds.map(async (f) => {
      const res = await fetchText(f.url, { force });
      return { feed: f, parsed: parseFeed(res.text, f.url), stale: res.stale, at: res.at };
    })
  );

  const all = [];
  let feedsChanged = false;
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      const { feed, parsed, stale, at } = r.value;
      all.push(...parsed.items.map((i) => ({ ...i, feed: feed.url, feedTitle: feed.title })));
      if (parsed.icon && parsed.icon !== feed.icon) { feed.icon = parsed.icon; feedsChanged = true; }
      if (parsed.site && parsed.site !== feed.site) { feed.site = parsed.site; feedsChanged = true; }
      if (stale) state.stale[feed.url] = at;
    } else {
      state.errors[state.feeds[idx].url] = r.reason?.message || 'erro';
    }
  });
  if (feedsChanged) saveTree(state.tree);

  state.items = dedupeItems(all).sort((a, b) => b.date - a.date);
  state.loading = false;
  if (results.some((r) => r.status === 'fulfilled')) state.updatedAt = new Date();
  $('#btn-refresh').classList.remove('loading');

  if (state.current) {
    const fresh = itemById(state.current.id);
    if (fresh) state.current = fresh;
    else closeReader();
    state.readerList = state.readerList.filter((id) => !!itemById(id));
  }

  render();
}

function syncFeeds() {
  state.feeds = allFeeds(state.tree);
}

// Remove dos posts as fontes que deixaram de existir
function dropFeedUrls(urls) {
  const gone = new Set(urls);
  if (!gone.size) return;
  if (state.current && sourcesOf(state.current).some((f) => gone.has(f.url))) closeReader();
  state.items = state.items
    .map((i) => {
      const feeds = sourcesOf(i).filter((f) => !gone.has(f.url));
      if (!feeds.length) return null;
      return { ...i, feeds, feed: feeds[0].url, feedTitle: feeds[0].title };
    })
    .filter(Boolean);
  for (const url of gone) {
    delete state.errors[url];
    delete state.stale[url];
  }
  if (gone.has(state.active)) state.active = 'all';
  state.readerList = state.readerList.filter((id) => state.items.some((i) => i.id === id));
}

async function addFeed(raw, parentId = '') {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  setMsg('buscando…');
  try {
    const feed = await resolveFeed(url);
    if (state.feeds.some((f) => f.url === feed.url)) {
      setMsg('esse feed já foi adicionado', true);
      return false;
    }
    const entry = feedNode({ url: feed.url, title: feed.title, icon: feed.icon, site: feed.site });
    const parent = parentId ? findNode(state.tree, parentId) : null;
    if (parent && parent.type === 'folder') {
      parent.children.push(entry);
      parent.open = true;   // mostra o feed na pasta escolhida
    } else {
      state.tree.push(entry);
    }
    saveTree(state.tree);
    syncFeeds();
    setMsg(`adicionado: ${feed.title}`);
    await refreshAll();
    return true;
  } catch (e) {
    setMsg(e.message || 'não foi possível adicionar', true);
    return false;
  }
}

function removeFeed(url) {
  const node = feedByUrl(state.tree, url);
  if (!node) return;
  removeTreeNode(state.tree, node.id);
  saveTree(state.tree);
  syncFeeds();
  dropFeedUrls([url]);
  render();
  toast('feed removido');
}

function persistRead() {
  save(LS_READ, [...state.read].slice(-3000));
}

function persistArchive() {
  const entries = [...state.archived].map(([key, item]) => {
    const copy = { ...item };
    delete copy.content;   // conteúdo completo fica só em memória; evita estourar o localStorage
    return { key, item: copy };
  });
  save(LS_ARCHIVED, entries.slice(-500));
}

function markRead(id) {
  state.read.add(id);
  persistRead();
  renderSide();
}

function markAllRead() {
  visibleItems().forEach((i) => state.read.add(i.id));
  persistRead();
  render();
}

// Marca/desmarca um post; render() atualiza lista e contadores.
function setReadState(id, read) {
  if (read) state.read.add(id); else state.read.delete(id);
  persistRead();
  if (!read && state.current && state.current.id === id) closeReader();
  render();
}

function toggleArchive(item) {
  if (!item) return;
  const key = archiveKey(item);
  const archived = !state.archived.has(key);
  if (archived) state.archived.set(key, archiveSnapshot(item)); else state.archived.delete(key);
  persistArchive();
  toast(archived ? 'post arquivado' : 'post desarquivado');
  if (state.current && state.current.id === item.id) closeReader();
  render();
}

function markFeedRead(url) {
  state.items.forEach((i) => {
    if (sourcesOf(i).some((f) => f.url === url)) state.read.add(i.id);
  });
  persistRead();
  render();
}

function markFolderRead(id) {
  const node = findNode(state.tree, id);
  if (!node || node.type !== 'folder') return;
  const urls = new Set(allFeeds(node.children).map((f) => f.url));
  state.items.forEach((i) => {
    if (sourcesOf(i).some((f) => urls.has(f.url))) state.read.add(i.id);
  });
  persistRead();
  render();
}

// Título próprio do feed; a atualização do feed não sobrescreve node.title.
function renameFeed(id, title) {
  const node = findNode(state.tree, id);
  if (!node || node.type !== 'feed') return;
  node.title = title;
  saveTree(state.tree);
  syncFeeds();
  state.items.forEach((i) => {
    if (i.feed === node.url) i.feedTitle = title;
    (i.feeds || []).forEach((f) => { if (f.url === node.url) f.title = title; });
  });
  if (state.current && sourcesOf(state.current).some((f) => f.url === node.url)) {
    state.current.feedTitle = title;
  }
  render();
}

// ---------- OPML ----------
const xmlEsc = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const outlineLine = (f, indent) =>
  `${indent}<outline type="rss" text="${xmlEsc(f.title)}" title="${xmlEsc(f.title)}" xmlUrl="${xmlEsc(f.url)}"/>`;

// Exporta a árvore inteira, inclusive pastas vazias
function treeToOutlines(nodes, indent) {
  return (nodes || []).map((n) => {
    if (n.type === 'feed') return outlineLine(n, indent);
    const inner = treeToOutlines(n.children, indent + '  ');
    const open = inner ? `\n${inner}\n${indent}` : '';
    return `${indent}<outline text="${xmlEsc(n.name)}" title="${xmlEsc(n.name)}">${open}</outline>`;
  }).join('\n');
}

function exportOpml() {
  const opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Meus feeds</title></head>\n  <body>\n${treeToOutlines(state.tree, '    ')}\n  </body>\n</opml>\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([opml], { type: 'text/xml' }));
  a.download = 'feeds.opml';
  a.click();
  URL.revokeObjectURL(a.href);
}

const outlineKids = (node) => [...node.children].filter((c) => c.localName === 'outline');

// Converte os outlines em nós, reaproveitando pastas de mesmo nome no mesmo nível.
// `parent` é null na raiz; os nós novos são devolvidos e anexados ao destino.
function outlinesToNodes(outlines, parent) {
  const nodes = [];
  for (const o of outlines) {
    const url = o.getAttribute('xmlUrl');
    if (url) {
      const title = o.getAttribute('title') || o.getAttribute('text') || url;
      nodes.push(feedNode({ url, title }));
      continue;
    }

    const name = (o.getAttribute('title') || o.getAttribute('text') || '').trim();
    const kids = outlineKids(o);
    if (!name) {   // outline sem nome: só desce um nível
      nodes.push(...outlinesToNodes(kids, parent));
      continue;
    }

    const list = parent ? parent.children : state.tree;
    let folder = [...list, ...nodes].find((n) =>
      n.type === 'folder' && n.name.localeCompare(name, 'pt-BR', { sensitivity: 'base' }) === 0);
    if (!folder) {
      folder = folderNode(name, true);
      nodes.push(folder);
    }
    folder.children.push(...outlinesToNodes(kids, folder));
  }
  return nodes;
}

async function importOpml(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'text/xml');
  const body = doc.querySelector('body');
  const outlines = body ? outlineKids(body) : [...doc.querySelectorAll('outline')];

  const beforeFeeds = new Set(allFeeds(state.tree).map((f) => f.id));
  state.tree.push(...outlinesToNodes(outlines, null));

  // deduplica por URL canônica, preservando os feeds que já existiam
  const seen = new Set(allFeeds(state.tree).filter((f) => beforeFeeds.has(f.id)).map((f) => canonicalUrl(f.url)));
  const prune = (nodes) => nodes.flatMap((n) => {
    if (n.type === 'feed') {
      if (beforeFeeds.has(n.id)) return [n];
      const key = canonicalUrl(n.url);
      if (!isHttp(n.url) || seen.has(key)) return [];
      seen.add(key);
      return [n];
    }
    n.children = prune(n.children);
    return [n];
  });

  state.tree = prune(state.tree);
  const added = allFeeds(state.tree).filter((f) => !beforeFeeds.has(f.id)).length;

  saveTree(state.tree);
  syncFeeds();
  setSettingsMsg(added ? `${added} feeds importados` : 'nenhum feed novo encontrado');
  await refreshAll();
}

// ---------- UI helpers ----------
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  node.append(...kids.filter((k) => k !== null && k !== undefined));
  return node;
}

function iconEl(name, size) {
  const i = el('i');
  i.innerHTML = iconSvg(name, size);
  return i;
}

function feedFor(url) {
  return state.feeds.find((f) => f.url === url);
}

// ---------- pastas (árvore) ----------
function unreadInFolder(node) {
  const urls = new Set(allFeeds(node.children || []).map((f) => f.url));
  return state.items.filter((i) => !state.read.has(i.id) && !isArchived(i) && sourcesOf(i).some((s) => urls.has(s.url))).length;
}

// Pastas em ordem de exibição, com o caminho legível ("A / B")
function folderOptions() {
  const out = [];
  const walk = (nodes, trail) => {
    for (const n of nodes || []) {
      if (n.type !== 'folder') continue;
      const path = [...trail, n.name];
      out.push({ id: n.id, label: path.join(' / ') });
      walk(n.children, path);
    }
  };
  walk(state.tree, []);
  return out;
}

const folderLabel = (id) => (folderPath(state.tree, id) || []).join(' / ');

// Pasta que contém o feed ('' se estiver na raiz)
function parentFolderId(feedId) {
  return findParent(state.tree, feedId)?.parent?.id || '';
}

// Favicon local: ícone do feed -> /favicon.ico do site -> ícone genérico (sem serviços externos)
function favicon(feedUrl, icon) {
  let origin = '';
  try { origin = new URL(feedUrl).origin; } catch { /* ignora */ }
  const siteIcon = origin ? origin + '/favicon.ico' : '';
  const src = isHttp(icon) ? icon : siteIcon;
  if (!src) return iconEl('rss', 16);

  const img = el('img', {
    class: 'fav', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src,
  });
  img.addEventListener('error', () => {
    if (siteIcon && img.src !== siteIcon) { img.src = siteIcon; return; }
    const i = iconEl('rss', 16);
    i.className = 'fav fallback';
    img.replaceWith(i);
  });
  return img;
}

function setMsg(t, err = false) {
  const m = $('#add-msg');
  m.textContent = t;
  m.classList.toggle('err', err);
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
function timeAgo(ts) {
  if (!ts) return 'sem data';
  const diff = (ts - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, s] of units) {
    if (Math.abs(diff) >= s) return rtf.format(Math.round(diff / s), u);
  }
  return 'agora';
}

const isMobile = () => matchMedia('(max-width: 820px)').matches;

function setSidebar(open) {
  document.body.classList.toggle('sidebar-closed', !open);
  if (!isMobile()) save(LS_SIDE, open);
}

function selectView(view) {
  if (view === 'settings' && state.current) closeReader();
  state.active = view;
  if (isMobile()) setSidebar(false);
  syncReaderList();
  render();
  $('.scroll').scrollTop = 0;
}

// ---------- menu de contexto ----------
let ctxReturnFocus = null;
let toastTimer = null;

function toast(text) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 1800);
}

async function copyText(text, message = 'copiado') {
  if (!text) return;
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('sem clipboard');
    await navigator.clipboard.writeText(text);
    toast(message);
    return;
  } catch {
    const area = el('textarea', { class: 'copy-area', readonly: '', 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    toast(ok ? message : 'não foi possível copiar');
  }
}

function closeContextMenu({ restoreFocus = false } = {}) {
  const menu = $('#ctx-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  menu.replaceChildren();
  const target = ctxReturnFocus;
  ctxReturnFocus = null;
  if (restoreFocus && target && document.contains(target) && target.focus) {
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }
}

function openContextMenu({ x, y, label, items, anchor }) {
  const menu = $('#ctx-menu');
  if (!menu) return;
  closeContextMenu();

  ctxReturnFocus = anchor || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  menu.replaceChildren();
  if (label) menu.append(el('div', { class: 'ctx-head', title: label }, label));

  let lastWasSep = true;
  for (const item of items) {
    if (item.sep) {
      if (!lastWasSep) menu.append(el('div', { class: 'ctx-sep' }));
      lastWasSep = true;
      continue;
    }
    lastWasSep = false;
    menu.append(el('button', {
      type: 'button',
      role: 'menuitem',
      class: 'ctx-item' + (item.danger ? ' danger' : ''),
      disabled: item.disabled ? 'disabled' : null,
      onclick: () => {
        closeContextMenu();
        if (item.run) item.run();
      },
    },
      item.icon ? iconEl(item.icon, 15) : null,
      el('span', {}, item.label),
      item.hint ? el('kbd', {}, item.hint) : null
    ));
  }
  while (menu.lastElementChild && menu.lastElementChild.classList.contains('ctx-sep')) {
    menu.lastElementChild.remove();
  }

  // mede e ajusta para caber na janela
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';
  const pad = 8;
  const left = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - menu.offsetWidth - pad));
  const top = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - menu.offsetHeight - pad));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.querySelector('.ctx-item:not(:disabled)')?.focus({ preventScroll: true });
}

function openFeedMenu(url, anchor, x, y) {
  const f = feedFor(url);
  if (!f) return;
  const unread = unreadCount(url);
  openContextMenu({
    x, y, anchor, label: f.title,
    items: [
      { icon: 'inbox', label: 'Abrir feed', run: () => selectView(url) },
      { icon: 'folder-symlink', label: 'Mover para pasta…', run: () => openMoveDialog(f.id) },
      { icon: 'check', label: 'Marcar todos como lidos', disabled: !unread, run: () => markFeedRead(url) },
      { sep: true },
      { icon: 'pencil', label: 'Renomear feed…', run: () => openRenameDialog(f.id) },
      { icon: 'link', label: 'Copiar endereço', run: () => copyText(url, 'endereço copiado') },
      { sep: true },
      { icon: 'x', label: 'Remover feed', danger: true, run: () => removeFeed(url) },
    ],
  });
}

function openFolderMenu(id, anchor, x, y) {
  const node = findNode(state.tree, id);
  if (!node || node.type !== 'folder') return;
  const open = node.open !== false;
  const unread = unreadInFolder(node);
  openContextMenu({
    x, y, anchor, label: node.name,
    items: [
      { icon: 'plus', label: 'Nova subpasta…', run: () => openFolderDialog(null, node.id) },
      { icon: 'pencil', label: 'Renomear…', run: () => openFolderDialog(node.id) },
      { icon: open ? 'chevron-right' : 'chevron-down', label: open ? 'Recolher' : 'Expandir', run: () => toggleFolder(node.id) },
      { sep: true },
      { icon: 'check', label: 'Marcar tudo como lido', disabled: !unread, run: () => markFolderRead(node.id) },
      { sep: true },
      { icon: 'x', label: 'Excluir pasta…', danger: true, run: () => openDeleteDialog(node.id) },
    ],
  });
}

function openCardMenu(item, anchor, x, y) {
  const read = state.read.has(item.id);
  openContextMenu({
    x, y, anchor, label: item.title,
    items: [
      { icon: 'inbox', label: 'Abrir no leitor', run: () => openReader(item) },
      {
        icon: 'external', label: 'Abrir no navegador', disabled: !item.link,
        run: () => window.open(item.link, '_blank', 'noopener'),
      },
      { sep: true },
      {
        icon: read ? 'circle' : 'check',
        label: read ? 'Marcar como não lido' : 'Marcar como lido',
        run: () => setReadState(item.id, !read),
      },
      { icon: 'rss', label: 'Ir para o feed', run: () => selectView(item.feed) },
      { sep: true },
      { icon: 'link', label: 'Copiar link', disabled: !item.link, run: () => copyText(item.link, 'link copiado') },
      { icon: 'copy', label: 'Copiar título', run: () => copyText(item.title, 'título copiado') },
    ],
  });
}

function openReaderMenu(item, x, y) {
  openContextMenu({
    x, y, anchor: $('#rd-article'), label: item.title,
    items: [
      {
        icon: 'external', label: 'Abrir original', disabled: !item.link,
        run: () => window.open(item.link, '_blank', 'noopener'),
      },
      { sep: true },
      { icon: 'link', label: 'Copiar link', disabled: !item.link, run: () => copyText(item.link, 'link copiado') },
      { icon: 'copy', label: 'Copiar título', run: () => copyText(item.title, 'título copiado') },
      { sep: true },
      { icon: 'circle', label: 'Marcar como não lido', run: () => setReadState(item.id, false) },
    ],
  });
}

document.addEventListener('pointerdown', (e) => {
  const menu = $('#ctx-menu');
  if (menu && !menu.hidden && !menu.contains(e.target)) closeContextMenu();
}, true);

document.addEventListener('contextmenu', (e) => {
  const menu = $('#ctx-menu');
  if (menu && !menu.hidden && !menu.contains(e.target)) closeContextMenu();
}, true);

document.addEventListener('keydown', (e) => {
  const menu = $('#ctx-menu');
  if (!menu || menu.hidden) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu({ restoreFocus: true });
    return;
  }
  if (e.key === 'Tab') { closeContextMenu(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;

  const items = [...menu.querySelectorAll('.ctx-item:not(:disabled)')];
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  const idx = items.indexOf(document.activeElement);
  let next = 0;
  if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
  else if (e.key === 'ArrowUp') next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
  else if (e.key === 'End') next = items.length - 1;
  items[next].focus();
}, true);

document.addEventListener('scroll', () => {
  cancelLongPress();
  closeContextMenu();
}, true);
window.addEventListener('resize', () => closeContextMenu());
window.addEventListener('blur', () => closeContextMenu());

// ---------- toque: long-press ----------
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE = 10;
let pressTimer = null;
let pressStart = null;
let suppressClickUntil = 0;
let suppressContextUntil = 0;

function cancelLongPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
  pressStart = null;
}

function beginLongPress(e, open) {
  if (e.pointerType === 'mouse' || e.isPrimary === false) return;
  if (e.button !== undefined && e.button !== 0) return;
  cancelLongPress();
  pressStart = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    const start = pressStart;
    pressStart = null;
    if (!start) return;
    // evita o clique e o menu nativo que viriam depois do toque longo
    suppressClickUntil = Date.now() + 700;
    suppressContextUntil = Date.now() + 800;
    open(start.x, start.y);
  }, LONG_PRESS_MS);
}

// Abre o menu a partir de um evento contextmenu (mouse ou toque).
function fromContextMenu(e, open) {
  cancelLongPress();
  if (e.pointerType === 'touch') suppressClickUntil = Date.now() + 700;
  e.preventDefault();
  if (Date.now() < suppressContextUntil) return;
  open(e.clientX, e.clientY);
}

document.addEventListener('pointermove', (e) => {
  if (!pressStart) return;
  const dx = e.clientX - pressStart.x;
  const dy = e.clientY - pressStart.y;
  if (dx * dx + dy * dy > LONG_PRESS_MOVE * LONG_PRESS_MOVE) cancelLongPress();
}, { passive: true });
document.addEventListener('pointerup', cancelLongPress, true);
document.addEventListener('pointercancel', cancelLongPress, true);

document.addEventListener('click', (e) => {
  if (Date.now() >= suppressClickUntil) return;
  // o toque que abriu o menu não deve clicar no alvo original, mas os itens do menu seguem clicáveis
  if (e.target.closest && e.target.closest('#ctx-menu')) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// ---------- render ----------
const unreadCount = (feed) =>
  state.items.filter((i) => !state.read.has(i.id) && !isArchived(i) &&
    (!feed || sourcesOf(i).some((f) => f.url === feed))).length;

function visibleItems() {
  if (state.active === 'settings') return [];
  const q = state.query.toLowerCase();
  const matches = (i) =>
    !q || i.title.toLowerCase().includes(q) || (i.summary || '').toLowerCase().includes(q);

  if (state.active === 'archived') {
    const seen = new Set();
    const out = [];
    for (const i of state.items) {
      const key = archiveKey(i);
      if (!state.archived.has(key)) continue;
      out.push(i);
      seen.add(key);
    }
    for (const [key, item] of state.archived) {
      if (!seen.has(key)) out.push(item);
    }
    return out.filter(matches).sort((a, b) => (b.date || 0) - (a.date || 0));
  }

  return state.items.filter((i) => {
    if (isArchived(i)) return false;
    // o post aberto continua na lista mesmo depois de marcado como lido
    if (state.active === 'unread' && state.read.has(i.id) && i.id !== state.current?.id) return false;
    if (state.active !== 'all' && state.active !== 'unread' &&
        !sourcesOf(i).some((f) => f.url === state.active)) return false;
    return matches(i);
  });
}

// ---------- sidebar (árvore + SortableJS) ----------
let sortables = [];
let expandTimer = null;
let expandId = '';

function feedItem(f) {
  const n = unreadCount(f.url);
  const err = state.errors[f.url];
  const staleAt = state.stale[f.url];
  const title = err
    ? `${f.title} — ${err}`
    : (staleAt ? `${f.title} — em cache, de ${timeAgo(staleAt)}` : f.title);

  return el('li', {
    class: 'feed',
    'data-id': f.id,
    'data-type': 'feed',
    'data-url': f.url,
  },
    el('button', {
      class: 'nav-item' + (state.active === f.url ? ' active' : ''),
      title,
      type: 'button',
      onclick: () => selectView(f.url),
    },
      favicon(f.url, f.icon),
      el('span', {}, f.title),
      err
        ? el('em', { class: 'count err' }, 'erro')
        : (n ? el('em', { class: 'count' }, String(n)) : null)
    )
  );
}

function folderItem(node) {
  const open = node.open !== false;
  const n = unreadInFolder(node);

  const head = el('button', {
    class: 'folder-head',
    type: 'button',
    title: open ? 'Recolher' : 'Expandir',
    'aria-expanded': open ? 'true' : 'false',
    onclick: () => toggleFolder(node.id),
  },
    iconEl(open ? 'chevron-down' : 'chevron-right', 14),
    iconEl(open ? 'folder-open' : 'folder', 16),
    el('span', { class: 'folder-name' }, node.name),
    n ? el('em', { class: 'count' }, String(n)) : null
  );

  // durante um arraste, abrir a pasta para ela aceitar o drop
  head.addEventListener('dragover', () => {
    if (document.body.classList.contains('tree-dragging')) scheduleExpand(node.id);
  });
  head.addEventListener('dragleave', () => cancelExpand(node.id));

  const children = el('ul', {
    class: 'folder-children' + (open ? '' : ' closed'),
    'data-folder-id': node.id,
  }, ...node.children.map(sideNode));

  return el('li', {
    class: 'folder-item',
    'data-id': node.id,
    'data-type': 'folder',
    'data-open': open ? '1' : '0',
  },
    el('div', { class: 'folder-row' }, head),
    children
  );
}

function sideNode(node) {
  return node.type === 'folder' ? folderItem(node) : feedItem(node);
}

function folderEl(id) {
  return [...document.querySelectorAll('#feeds li.folder-item')]
    .find((li) => li.dataset.id === id) || null;
}

function toggleFolder(id) {
  const node = findNode(state.tree, id);
  if (!node || node.type !== 'folder') return;
  node.open = !node.open;
  saveTree(state.tree);

  // atualiza só o necessário, para não recriar os Sortable no meio de um arraste
  const li = folderEl(id);
  if (!li) { renderSide(); return; }
  li.dataset.open = node.open ? '1' : '0';
  const head = li.querySelector(':scope > .folder-row > .folder-head');
  const icons = head ? head.querySelectorAll('i') : [];
  if (head) {
    head.setAttribute('aria-expanded', node.open ? 'true' : 'false');
    head.title = node.open ? 'Recolher' : 'Expandir';
  }
  if (icons[0]) icons[0].innerHTML = iconSvg(node.open ? 'chevron-down' : 'chevron-right');
  if (icons[1]) icons[1].innerHTML = iconSvg(node.open ? 'folder-open' : 'folder', 16);
  li.querySelector(':scope > .folder-children')?.classList.toggle('closed', !node.open);
}

function scheduleExpand(id) {
  if (expandId === id) return;
  clearTimeout(expandTimer);
  expandId = id;
  expandTimer = setTimeout(() => {
    const node = findNode(state.tree, id);
    expandId = '';
    if (node && node.type === 'folder' && node.open === false) toggleFolder(id);
  }, 400);
}

function cancelExpand(id) {
  if (expandId !== id) return;
  expandId = '';
  clearTimeout(expandTimer);
}

function renderSide() {
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === state.active));

  const u = unreadCount();
  $('#count-unread').textContent = u ? String(u) : '';

  destroySortables();
  const ul = $('#feeds');
  const top = ul.scrollTop;
  ul.replaceChildren(...state.tree.map(sideNode));
  ul.scrollTop = top;
  initSortables();
}

// Reconstrói a árvore a partir do DOM depois de um drop
function syncTreeFromDom() {
  const known = new Map();
  const collect = (nodes) => (nodes || []).forEach((n) => {
    known.set(n.id, n);
    if (n.type === 'folder') collect(n.children);
  });
  collect(state.tree);

  const readList = (ul) => {
    if (!ul) return [];
    return [...ul.children]
      .filter((li) => li.matches('li.feed, li.folder-item'))
      .map((li) => {
        const base = known.get(li.dataset.id);
        if (!base) return null;
        if (base.type === 'folder') {
          const childUl = li.querySelector(':scope > ul.folder-children');
          return {
            id: base.id,
            type: 'folder',
            name: base.name,
            open: li.dataset.open === '1',
            children: readList(childUl),
          };
        }
        const feed = { id: base.id, type: 'feed', title: base.title, url: base.url };
        if (base.icon) feed.icon = base.icon;
        if (base.site) feed.site = base.site;
        return feed;
      })
      .filter(Boolean);
  };

  state.tree = readList($('#feeds'));
  saveTree(state.tree);
  syncFeeds();
  return true;
}

function destroySortables() {
  for (const s of sortables) {
    try { s.destroy(); } catch { /* ignora */ }
  }
  sortables = [];
}

function initSortables() {
  if (!window.Sortable) return;   // CDN bloqueado: tudo funciona, menos arrastar
  const root = document.querySelector('#feeds');
  const lists = [root, ...document.querySelectorAll('#feeds ul.folder-children')].filter(Boolean);

  for (const list of lists) {
    sortables.push(window.Sortable.create(list, {
      group: 'feeds',
      animation: 150,
      fallbackOnBody: true,
      draggable: 'li.feed, li.folder-item',
      onStart: () => document.body.classList.add('tree-dragging'),
      onEnd: (evt) => {
        document.body.classList.remove('tree-dragging');
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        setTimeout(() => {
          syncTreeFromDom();
          render();
        }, 0);
      },
      onMove: (evt) => {
        const dragged = evt.dragged;
        if (!dragged || dragged.dataset.type !== 'folder') return true;
        const targetId = evt.to?.dataset.folderId || '';
        if (!targetId) return true;   // raiz sempre pode
        if (targetId === dragged.dataset.id) return false;
        return !isDescendant(state.tree, dragged.dataset.id, targetId);
      },
    }));
  }
}

// ---------- diálogos de pasta ----------
function setFolderMsg(t, err = false) {
  const m = $('#folder-msg');
  m.textContent = t;
  m.classList.toggle('err', err);
}

function folderOption(selected, value, label) {
  const o = el('option', { value }, label);
  if (value === selected) o.selected = true;
  return o;
}

function fillFolderSelect(select, selectedId, rootLabel = '') {
  const opts = [];
  if (rootLabel) opts.push(folderOption(selectedId, '', rootLabel));
  for (const { id, label } of folderOptions()) opts.push(folderOption(selectedId, id, label));
  select.replaceChildren(...opts);
}

function openFolderDialog(id = null, parentId = '') {
  editingFolder = id || null;
  const node = id ? findNode(state.tree, id) : null;
  $('#folder-title').textContent = node ? 'Editar pasta' : 'Nova pasta';
  $('#folder-name').value = node ? node.name : '';
  const parentField = $('#folder-parent-field');
  if (parentField) parentField.hidden = !!node;   // editar = só renomear; mover é por arrastar
  if (!node) fillFolderSelect($('#folder-parent'), parentId, '— raiz —');
  setFolderMsg('');
  folderDialog.showModal();
  const input = $('#folder-name');
  input.focus();
  input.select();
}

function openDeleteDialog(id) {
  const node = findNode(state.tree, id);
  if (!node || node.type !== 'folder') return;
  deletingFolder = id;

  const feeds = allFeeds(node.children).length;
  const folders = allFolders(node.children).length;
  const parts = [];
  if (feeds) parts.push(`${feeds} feed${feeds > 1 ? 's' : ''}`);
  if (folders) parts.push(`${folders} subpasta${folders > 1 ? 's' : ''}`);
  $('#delete-folder-text').textContent = parts.length
    ? `A pasta "${node.name}" contém ${parts.join(' e ')}. O que fazer com o conteúdo?`
    : `Excluir a pasta vazia "${node.name}"?`;
  $('#del-keep').hidden = !node.children.length;

  deleteDialog.showModal();
}

function openMoveDialog(feedId) {
  const node = findNode(state.tree, feedId);
  if (!node || node.type !== 'feed') return;
  movingFeed = feedId;
  $('#move-feed').textContent = node.title;
  fillFolderSelect($('#move-folder'), parentFolderId(feedId), '— sem pasta —');
  moveDialog.showModal();
  $('#move-folder').focus();
}

// ---------- cabeçalho ----------
function activeFeed() {
  if (['all', 'unread', 'archived', 'settings'].includes(state.active)) return null;
  return state.feeds.find((f) => f.url === state.active) || null;
}

// Link real do site: o informado pelo próprio feed; na falta dele, a origem da URL.
function feedSite(feed) {
  if (!feed) return '';
  if (isHttp(feed.site)) return feed.site;
  try {
    const u = new URL(feed.url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin + '/' : '';
  } catch { return ''; }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${(kb < 10 ? kb.toFixed(1) : String(Math.round(kb))).replace('.', ',')} KB`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Tamanho real do valor de "rss.cache" (corpo dos feeds + datas das entradas).
function cacheBytes() {
  try { return new Blob([JSON.stringify(cache)]).size; }
  catch { return cacheStats().chars * 2; }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const clockTime = (date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

function renderTop() {
  const feed = activeFeed();
  const title = feed ? feed.title
    : state.active === 'unread' ? 'Não lidos'
    : state.active === 'archived' ? 'Arquivados'
    : state.active === 'settings' ? 'Configurações'
    : 'Todos os posts';
  $('#view-title').textContent = title;

  const link = $('#top-feed');
  const site = feedSite(feed);
  if (site) {
    link.setAttribute('href', site);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.title = `Abrir ${site}`;
  } else {
    link.removeAttribute('href');
    link.removeAttribute('target');
    link.removeAttribute('rel');
    link.removeAttribute('title');
  }

  $('#top-buttons').hidden = !feed;
  const raw = $('#top-raw');
  if (feed) raw.href = feed.url; else raw.removeAttribute('href');

  const errs = Object.keys(state.errors).length;
  const stale = Object.keys(state.stale).length;

  $('#top-posts').textContent = plural(state.items.length, 'post', 'posts');
  $('#top-feeds').textContent = plural(state.feeds.length, 'feed', 'feeds');
  $('#top-updated').textContent = state.updatedAt
    ? `Atualizado às ${clockTime(state.updatedAt)}`
    : 'Sem sincronização';
  $('#top-cache').textContent = `Cache: ${formatBytes(cacheBytes())}`;
  $('#top-unread').textContent = plural(unreadCount(), 'não lido', 'não lidos');

  const badge = $('#top-badge');
  badge.classList.remove('ok', 'loading', 'error');
  if (state.loading) {
    badge.textContent = 'Atualizando';
    badge.classList.add('loading');
  } else if (errs) {
    badge.textContent = plural(errs, 'erro', 'erros');
    badge.classList.add('error');
  } else if (state.updatedAt) {
    badge.textContent = 'Atualizado';
    badge.classList.add('ok');
  } else {
    badge.textContent = 'Aguardando';
  }

  badge.title = [
    errs ? plural(errs, 'feed com erro', 'feeds com erro') : '',
    stale ? plural(stale, 'feed veio do cache', 'feeds vieram do cache') : '',
  ].filter(Boolean).join(' · ');
}

// Nome de arquivo seguro a partir do título do feed.
function fileSlug(text) {
  const base = String(text || 'feed')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return base || 'feed';
}

// Baixa o XML real do feed: usa o cache local e, se faltar, busca pelo mesmo caminho do app.
async function downloadFeed(feed) {
  if (!feed) return;
  try {
    let body = cacheGet(feed.url)?.body || '';
    if (!body) body = (await fetchText(feed.url)).text;
    if (!body) throw new Error('feed vazio');
    const json = /^\s*[[{]/.test(body);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], {
      type: json ? 'application/json;charset=utf-8' : 'application/rss+xml;charset=utf-8',
    }));
    a.download = `${fileSlug(feed.title)}.${json ? 'json' : 'xml'}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('download iniciado');
  } catch {
    toast('não foi possível baixar o feed');
  }
}

// ---------- configurações ----------
function cacheLabel() {
  const { count, chars } = cacheStats();
  if (!count) return 'vazio';
  const kb = Math.max(1, Math.round(chars / 1024));
  return `${count} ${count === 1 ? 'entrada' : 'entradas'} · ~${kb} KB`;
}

function setSettingsMsg(text, err = false) {
  state.settingsMsg = { text, err };
  const m = $('#set-msg');
  if (m) {
    m.textContent = text;
    m.classList.toggle('err', err);
  }
}

function clearCacheAndRender() {
  clearCache();
  setSettingsMsg('cache limpo');
  renderTop();
  renderItems();
}

// ---------- aparência ----------
function resolvedTheme(pref) {
  if (pref === 'system') {
    try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
    catch { return 'dark'; }
  }
  return pref === 'light' ? 'light' : 'dark';
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return '#' + rgb
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('');
}

function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mixHex(a, b, amount) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * amount));
}

// Escurece/clareia a cor até ela ficar legível sobre o fundo.
function ensureContrast(color, bg, min = 4.5) {
  const target = relLuminance(bg) > 0.45 ? '#000000' : '#ffffff';
  let out = color;
  for (let i = 0; i < 12 && contrastRatio(out, bg) < min; i++) {
    out = mixHex(out, target, 0.12);
  }
  return out;
}

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  const theme = resolvedTheme(s.theme);
  const light = theme === 'light';

  root.dataset.theme = theme;
  root.dataset.density = s.density;
  root.dataset.listfont = s.listFont;
  root.dataset.thumbs = s.showThumbs ? 'on' : 'off';
  root.dataset.readerwidth = s.readerWidth;
  root.dataset.motion = s.reduceMotion ? 'reduced' : 'auto';

  const bg = light ? '#fbfaf8' : '#1a1a19';
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-text', ensureContrast(s.accent, bg));
  root.style.setProperty('--accent-ink', contrastRatio(s.accent, '#ffffff') >= 3 ? '#ffffff' : '#111111');
  root.style.setProperty('--reader-font', `${s.readerFont}px`);
}

function settingsSaved() {
  try { save(LS_SETTINGS, state.settings); } catch { /* modo privado */ }
}

// ---------- layout (divisórias arrastáveis) ----------
function clampLayout(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function loadLayout() {
  const raw = load(LS_LAYOUT, {});
  const out = { ...LAYOUT_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ['side', 'list']) {
    const n = Number(raw[key]);
    if (Number.isFinite(n) && n > 0) out[key] = clampLayout(n, LAYOUT_MIN[key], LAYOUT_MAX[key]);
  }
  return out;
}

// Limite dinâmico: a barra lateral não passa de 40% da janela e o leitor
// mantém uma largura mínima confortável.
function layoutMax(key) {
  if (key === 'side') {
    return Math.max(LAYOUT_MIN.side, Math.min(LAYOUT_MAX.side, Math.round(window.innerWidth * 0.4)));
  }
  const content = document.getElementById('content');
  const width = content ? content.clientWidth : window.innerWidth;
  return Math.max(LAYOUT_MIN.list, Math.min(LAYOUT_MAX.list, width - READER_MIN_W));
}

function applyLayout() {
  const root = document.documentElement;
  root.style.setProperty('--side-w', `${effectiveLayout('side')}px`);
  root.style.setProperty('--list-w', `${effectiveLayout('list')}px`);
}

// Valor exibido: a preferência salva, mas sempre cabendo na janela atual.
// Não altera a preferência — ao alargar a janela, a largura escolhida volta.
function effectiveLayout(key) {
  const max = layoutMax(key);
  return Math.min(Math.max(state.layout[key], Math.min(LAYOUT_MIN[key], max)), max);
}

function persistLayout() {
  try { save(LS_LAYOUT, { ...state.layout }); } catch { /* modo privado */ }
}

function syncSplitter(el, key) {
  if (!el) return;
  el.setAttribute('aria-valuemin', String(LAYOUT_MIN[key]));
  el.setAttribute('aria-valuemax', String(layoutMax(key)));
  el.setAttribute('aria-valuenow', String(effectiveLayout(key)));
}

function resetLayout(key) {
  for (const k of key ? [key] : ['side', 'list']) state.layout[k] = LAYOUT_DEFAULTS[k];
  applyLayout();
  persistLayout();
  syncSplitters();
}

function syncSplitters() {
  syncSplitter(document.getElementById('split-side'), 'side');
  syncSplitter(document.getElementById('split-reader'), 'list');
}

function setupSplitter(el, key) {
  if (!el) return;
  syncSplitter(el, key);

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    el.focus({ preventScroll: true });

    const startX = e.clientX;
    const startValue = effectiveLayout(key);
    el.classList.add('dragging');
    document.body.classList.add('resizing');
    try { el.setPointerCapture(e.pointerId); } catch { /* navegador antigo */ }

    const onMove = (ev) => {
      state.layout[key] = clampLayout(startValue + (ev.clientX - startX), LAYOUT_MIN[key], layoutMax(key));
      applyLayout();
      syncSplitter(el, key);
    };
    const onEnd = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      el.classList.remove('dragging');
      document.body.classList.remove('resizing');
      persistLayout();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  });

  // duplo clique/toque volta ao padrão
  el.addEventListener('dblclick', () => resetLayout(key));

  // setas ajustam de 16 em 16 px (Shift = 48 px)
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.shiftKey ? 48 : 16) * (e.key === 'ArrowRight' ? 1 : -1);
    state.layout[key] = clampLayout(effectiveLayout(key) + step, LAYOUT_MIN[key], layoutMax(key));
    applyLayout();
    syncSplitter(el, key);
    persistLayout();
  });
}

function refreshSettingsPane(focusId) {
  if (state.active !== 'settings') return;
  const scroll = document.querySelector('.scroll');
  const top = scroll ? scroll.scrollTop : 0;
  renderItems();
  if (scroll) scroll.scrollTop = top;
  if (focusId) document.getElementById(focusId)?.focus();
}

function updateSettings(patch, focusId) {
  Object.assign(state.settings, patch);
  settingsSaved();
  applySettings();
  refreshSettingsPane(focusId);
}

function resetAppearance() {
  resetLayout();
  state.settingsMsg = { text: 'aparência restaurada', err: false };
  updateSettings({ ...SETTINGS_DEFAULTS }, 'set-reset-appearance');
}

function settingRow(title, desc, control) {
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-label' },
      el('span', { class: 'setting-title' }, title),
      desc ? el('span', { class: 'setting-desc' }, desc) : null
    ),
    control
  );
}

function segmented(label, options, value, onPick, prefix) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  options.forEach((opt, i) => {
    const id = `${prefix}-${i}`;
    const active = opt.value === value;
    group.append(el('button', {
      type: 'button',
      class: 'seg' + (active ? ' on' : ''),
      id,
      role: 'radio',
      'aria-checked': String(active),
      onclick: () => onPick(opt.value, id),
      onkeydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        onPick(options[next].value, `${prefix}-${next}`);
      },
    }, opt.label));
  });
  return group;
}

function toggleSwitch(id, checked, label, onChange) {
  return el('button', {
    type: 'button',
    class: 'switch' + (checked ? ' on' : ''),
    id,
    role: 'switch',
    'aria-checked': String(checked),
    'aria-label': label,
    onclick: () => onChange(!checked, id),
  }, el('span', { class: 'knob' }));
}

function accentControl(s) {
  const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Cor de destaque' });
  ACCENT_PRESETS.forEach((color, i) => {
    const active = color === s.accent;
    swatches.append(el('button', {
      type: 'button',
      class: 'swatch' + (active ? ' on' : ''),
      id: `set-accent-${i}`,
      role: 'radio',
      'aria-checked': String(active),
      'aria-label': `${ACCENT_NAMES[i] || 'Cor'} (${color})`,
      title: `${ACCENT_NAMES[i] || 'Cor'} (${color})`,
      'data-color': color,
      style: `--sw:${color}`,
      onclick: () => updateSettings({ accent: color }, `set-accent-${i}`),
      onkeydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + ACCENT_PRESETS.length) % ACCENT_PRESETS.length;
        updateSettings({ accent: ACCENT_PRESETS[next] }, `set-accent-${next}`);
      },
    }));
  });

  const input = el('input', {
    type: 'color',
    id: 'set-accent-custom',
    value: s.accent,
    'aria-label': 'Cor personalizada',
    oninput: (e) => {
      const hex = normalizeHex(e.target.value);
      if (!hex) return;
      state.settings.accent = hex;
      settingsSaved();
      applySettings();
      const label = document.getElementById('set-accent-hex');
      if (label) label.textContent = hex;
      document.querySelectorAll('.swatch').forEach((n) => {
        const on = n.dataset.color === hex;
        n.classList.toggle('on', on);
        n.setAttribute('aria-checked', String(on));
      });
    },
    onchange: () => refreshSettingsPane('set-accent-custom'),
  });

  return el('div', { class: 'accent-control' },
    swatches,
    el('label', { class: 'color-field' },
      input,
      el('span', { class: 'color-hex', id: 'set-accent-hex' }, s.accent)
    )
  );
}

function renderSettings() {
  const msg = state.settingsMsg;
  const s = state.settings;

  return el('div', { class: 'settings' },
    el('section', { class: 'settings-section' },
      el('h3', {}, 'Aparência'),
      el('p', { class: 'settings-note' },
        'Tudo é aplicado na hora e salvo automaticamente neste navegador.'),

      settingRow('Tema', 'Escuro, claro ou seguindo o sistema.',
        segmented('Tema', [
          { value: 'dark', label: 'Escuro' },
          { value: 'light', label: 'Claro' },
          { value: 'system', label: 'Sistema' },
        ], s.theme, (v, id) => updateSettings({ theme: v }, id), 'set-theme')),

      settingRow('Cor de destaque', 'Links, marcadores e botões.', accentControl(s)),

      settingRow('Densidade', 'Compacta reduz o espaçamento dos posts e da barra lateral.',
        segmented('Densidade', [
          { value: 'comfortable', label: 'Confortável' },
          { value: 'compact', label: 'Compacta' },
        ], s.density, (v, id) => updateSettings({ density: v }, id), 'set-density')),

      settingRow('Fonte da lista', 'Tamanho do título e do resumo dos posts.',
        segmented('Fonte da lista', [
          { value: 'small', label: 'Pequena' },
          { value: 'normal', label: 'Padrão' },
          { value: 'large', label: 'Grande' },
        ], s.listFont, (v, id) => updateSettings({ listFont: v }, id), 'set-listfont')),

      settingRow('Miniaturas nos cards', 'Mostra a imagem de capa quando o feed traz uma.',
        toggleSwitch('set-thumbs', s.showThumbs, 'Miniaturas nos cards',
          (v, id) => updateSettings({ showThumbs: v }, id))),

      settingRow('Fonte do leitor', 'Tamanho do texto dentro do artigo.',
        segmented('Fonte do leitor', READER_FONTS.map((n) => ({ value: n, label: `${n}px` })),
          s.readerFont, (v, id) => updateSettings({ readerFont: v }, id), 'set-readerfont')),

      settingRow('Largura do leitor', 'Painel inteiro aproveita melhor telas largas.',
        segmented('Largura do leitor', [
          { value: 'full', label: 'Painel inteiro' },
          { value: 'comfortable', label: 'Confortável' },
        ], s.readerWidth, (v, id) => updateSettings({ readerWidth: v }, id), 'set-readerwidth')),

      settingRow('Reduzir animações', 'Desliga transições e animações da interface.',
        toggleSwitch('set-motion', s.reduceMotion, 'Reduzir animações',
          (v, id) => updateSettings({ reduceMotion: v }, id))),

      el('div', { class: 'settings-actions settings-footer' },
        el('span', { class: 'settings-value' }, 'Salvo automaticamente'),
        el('button', {
          class: 'btn', id: 'set-reset-appearance', type: 'button', onclick: resetAppearance,
        }, 'Restaurar padrão')
      )
    ),
    el('section', { class: 'settings-section' },
      el('h3', {}, 'Feeds'),
      el('p', { class: 'settings-note' },
        'Importe um OPML para adicionar feeds de uma vez. As pastas são preservadas ao exportar.'),
      el('div', { class: 'settings-actions' },
        el('button', { class: 'btn', id: 'set-import', type: 'button', onclick: () => $('#file-import').click() }, 'Importar OPML'),
        el('button', { class: 'btn', id: 'set-export', type: 'button', onclick: exportOpml }, 'Exportar OPML')
      )
    ),
    el('section', { class: 'settings-section' },
      el('h3', {}, 'Cache local'),
      el('p', { class: 'settings-note' },
        'Cada feed fica em cache por 20 minutos. Se os proxies falharem, o último conteúdo salvo é usado.'),
      el('div', { class: 'settings-actions' },
        el('span', { class: 'settings-value', id: 'set-cache-info' }, cacheLabel()),
        el('button', { class: 'btn', id: 'set-clear-cache', type: 'button', onclick: clearCacheAndRender }, 'Limpar cache')
      )
    ),
    el('p', { class: 'msg' + (msg && msg.err ? ' err' : ''), id: 'set-msg', role: 'status' }, msg ? msg.text : '')
  );
}

function renderItems() {
  const box = $('#items');
  const column = box.closest('.column');
  document.body.classList.toggle('settings-view', state.active === 'settings');

  if (state.active === 'settings') {
    column?.classList.remove('empty-mode');
    box.replaceChildren(renderSettings());
    return;
  }

  const list = visibleItems();
  column?.classList.toggle('empty-mode', !list.length);

  if (!list.length) {
    let msg = 'Nenhum post encontrado';
    if (state.active === 'archived' && !state.query) msg = 'Nenhum post arquivado';
    else if (!state.feeds.length) msg = 'Clique em "Novo feed" na barra lateral para adicionar o primeiro';
    else if (state.active === 'unread' && !state.query) msg = 'Tudo lido por aqui';
    box.replaceChildren(el('div', { class: 'empty' }, iconEl('rss', 28), el('span', {}, msg)));
    return;
  }

  box.replaceChildren(...list.map((i) => {
    const sources = sourcesOf(i);
    const thumb = i.image
      ? el('div', { class: 'thumb-wrap' },
          el('img', {
            class: 'thumb', src: i.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
            onerror: (e) => e.target.closest('.thumb-wrap')?.remove(),
          }),
          i.video ? el('span', { class: 'play' }) : null)
      : null;

    return el('article', {
      class: 'card' + (state.read.has(i.id) ? ' read' : '') + (state.current && state.current.id === i.id ? ' current' : ''),
      'data-id': i.id,
    },
      el('div', { class: 'card-body' },
        el('div', { class: 'meta' },
          el('span', { class: 'dot' }),
          favicon(i.feed, feedFor(i.feed)?.icon),
          el('span', { class: 'src', title: sources.map((s) => s.title).join('\n') }, i.feedTitle),
          sources.length > 1
            ? el('span', {
                class: 'more',
                title: `Também em: ${sources.slice(1).map((s) => s.title).join(', ')}`,
              }, `+${sources.length - 1}`)
            : null,
          el('span', {}, '·'),
          el('span', {}, timeAgo(i.date)),
          i.video ? el('span', { class: 'tag' }, i.video.kind === 'audio' ? 'áudio' : 'vídeo') : null
        ),
        el('h3', {},
          el('a', {
            href: i.link || '#', rel: 'noopener noreferrer',
            onclick: (e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;   // abre em nova aba normalmente
              e.preventDefault();
              openReader(i);
            },
          }, i.title)
        ),
        i.summary ? el('p', {}, i.summary) : null
      ),
      thumb
    );
  }));
}

// ---------- leitor ----------
const fullDate = (ts) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : 'sem data';

function paintCurrent() {
  document.querySelectorAll('.card').forEach((c) => {
    c.classList.toggle('current', !!state.current && c.dataset.id === state.current.id);
    c.classList.toggle('read', state.read.has(c.dataset.id));
  });
}

// Lista estável usada por j/k: o snapshot feito ao abrir o leitor
function itemById(id) {
  return state.items.find((i) => i.id === id) ||
    [...state.archived.values()].find((i) => i.id === id) || null;
}

function navList() {
  return state.readerList.map(itemById).filter(Boolean);
}

function openReader(item) {
  if (!state.readerList.includes(item.id)) state.readerList = visibleItems().map((i) => i.id);
  state.current = item;
  markRead(item.id);
  document.body.classList.add('reader-open');
  $('#reader').hidden = false;
  paintCurrent();
  renderReader(item);
}

function closeReader() {
  state.current = null;
  state.readerToken++;
  state.readerList = [];
  document.body.classList.remove('reader-open');
  $('#reader').hidden = true;
  $('#rd-article').replaceChildren();   // remove iframes/players (para o vídeo)
  paintCurrent();
  renderItems();
}

function stepReader(delta) {
  if (!state.current) return;
  const list = navList();
  const idx = list.findIndex((x) => x.id === state.current.id);
  if (idx < 0) return;
  const next = list[idx + delta];
  if (!next) return;
  openReader(next);
  document.querySelector('.card.current')?.scrollIntoView({ block: 'nearest' });
}

function updateReaderNav() {
  if (!state.current) return;
  const list = navList();
  const idx = list.findIndex((x) => x.id === state.current.id);
  $('#rd-prev').disabled = idx <= 0;
  $('#rd-next').disabled = idx < 0 || idx >= list.length - 1;

  const open = $('#rd-open');
  if (state.current.link) open.setAttribute('href', state.current.link); else open.removeAttribute('href');
  open.hidden = !state.current.link;

  const archived = isArchived(state.current);
  const archive = $('#rd-archive');
  archive.title = archived ? 'Desarquivar' : 'Arquivar';
  archive.setAttribute('aria-label', archived ? 'Desarquivar post' : 'Arquivar post');
  archive.innerHTML = iconSvg(archived ? 'archive-restore' : 'archive');
}

// Refaz o snapshot quando visão/busca/refresh mudam a lista
function syncReaderList() {
  if (!state.current) return;
  const list = visibleItems();
  if (!list.some((i) => i.id === state.current.id)) { closeReader(); return; }
  state.readerList = list.map((i) => i.id);
  updateReaderNav();
}

// Remove blocos vazios que sobram do HTML extraído (tabelas de layout, <br> extras etc.)
function pruneReaderHtml(root) {
  const MEDIA = 'img, video, audio, iframe, source, hr';
  const hasContent = (el) => el.textContent.trim().length > 0 || !!el.querySelector(MEDIA);

  for (const tr of [...root.querySelectorAll('tr')]) {
    if (!hasContent(tr)) tr.remove();
  }
  for (const table of [...root.querySelectorAll('table')]) {
    if (!table.querySelector('tr') && !hasContent(table)) table.remove();
  }

  const blocks = root.querySelectorAll(
    'div, section, p, h1, h2, h3, h4, h5, h6, ul, ol, li, figure, figcaption, blockquote, thead, tbody, tfoot'
  );
  for (const node of [...blocks].reverse()) {
    if (node.parentNode && !hasContent(node)) node.remove();
  }

  // sequências de <br> viram uma só
  for (const br of [...root.querySelectorAll('br')]) {
    let prev = br.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev = prev.previousSibling;
    if (prev && prev.nodeName === 'BR') br.remove();
  }

  // sem <br> nas pontas de cada bloco
  for (const box of [root, ...root.querySelectorAll('p, div, section, li, blockquote, td, th')]) {
    while (box.firstChild && box.firstChild.nodeName === 'BR') box.firstChild.remove();
    while (box.lastChild && box.lastChild.nodeName === 'BR') box.lastChild.remove();
  }
}

function renderReader(item) {
  const token = ++state.readerToken;
  const art = $('#rd-article');
  const prose = el('div', { class: 'prose' });

  updateReaderNav();

  const sources = sourcesOf(item);
  art.replaceChildren(
    el('div', { class: 'meta' },
      favicon(item.feed, feedFor(item.feed)?.icon),
      el('span', { class: 'src', title: sources.map((s) => s.title).join('\n') }, item.feedTitle),
      sources.length > 1
        ? el('span', {
            class: 'more',
            title: `Também em: ${sources.slice(1).map((s) => s.title).join(', ')}`,
          }, `+${sources.length - 1}`)
        : null,
      el('span', {}, '·'),
      el('span', {}, fullDate(item.date))
    ),
    el('h1', {}, item.title)
  );

  const player = videoElement(item.video, item.image);
  if (player) art.append(player);
  art.append(prose);

  const fill = (html) => {
    const frag = sanitizeHtml(html, item.link);
    pruneReaderHtml(frag);
    if (!frag.childNodes.length) {
      frag.append(el('p', { class: 'reader-note' }, 'Este post não traz conteúdo no feed.'));
    }
    prose.replaceChildren(frag);
  };

  const base = item.content || item.summary;
  const baseLen = htmlToText(base || '').length;
  fill(state.full.get(item.id) || base);
  $('#rd-scroll').scrollTop = 0;

  // feeds que trazem só um resumo: busca a página e extrai o artigo
  if (!state.full.has(item.id) && item.link && !item.video && baseLen < 600) {
    const note = el('p', { class: 'reader-note' }, 'Carregando artigo completo…');
    art.append(note);

    fetchText(item.link)
      .then(({ text: page }) => {
        if (token !== state.readerToken) return;
        const html = extractArticle(page);
        if (html && htmlToText(html).length > baseLen) {
          state.full.set(item.id, html);
          fill(html);
          note.remove();
        } else {
          note.textContent = 'Não consegui extrair o artigo completo. Use "Abrir original" (ícone no topo).';
        }
      })
      .catch((e) => {
        if (token !== state.readerToken) return;
        note.textContent = `Não consegui carregar o artigo completo (${String(e.message).split(' —')[0]}). Use "Abrir original".`;
      });
  }
}

function render() {
  closeContextMenu();
  renderSide();
  renderTop();
  renderItems();
  if (state.current) updateReaderNav();
}

// ---------- eventos ----------
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => selectView(b.dataset.view)));

$('#btn-toggle').addEventListener('click', () => setSidebar(false));
$('#btn-open').addEventListener('click', () => setSidebar(true));
$('#backdrop').addEventListener('click', () => setSidebar(false));

const dialog = $('#add-dialog');
const folderDialog = $('#folder-dialog');
const moveDialog = $('#move-dialog');
const deleteDialog = $('#delete-folder-dialog');
const renameDialog = $('#rename-dialog');
let editingFolder = null;
let movingFeed = null;
let deletingFolder = null;
let renamingFeed = null;

$('#nav-new').addEventListener('click', () => {
  if (isMobile()) setSidebar(false);
  $('#add-url').value = '';
  setMsg('');
  const navFeed = feedByUrl(state.tree, state.active);
  const current = navFeed ? parentFolderId(navFeed.id) : '';
  fillFolderSelect($('#add-folder'), current, '— sem pasta —');
  dialog.showModal();
  $('#add-url').focus();
});

$('#btn-cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-add');
  btn.disabled = true;
  const ok = await addFeed($('#add-url').value, $('#add-folder').value);
  btn.disabled = false;
  if (ok) dialog.close();
});

// ---------- pastas: eventos ----------
$('#btn-new-folder').addEventListener('click', () => {
  if (isMobile()) setSidebar(false);
  openFolderDialog();
});

$('#folder-cancel').addEventListener('click', () => folderDialog.close());
folderDialog.addEventListener('click', (e) => { if (e.target === folderDialog) folderDialog.close(); });

$('#folder-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#folder-name').value.trim();
  if (!name) { setFolderMsg('informe um nome', true); return; }
  if (name.includes('/')) { setFolderMsg('o nome não pode conter "/"', true); return; }

  const res = editingFolder
    ? renameFolder(state.tree, editingFolder, name)
    : createFolder(state.tree, name, $('#folder-parent').value);
  if (res.error) { setFolderMsg(res.error, true); return; }

  saveTree(state.tree);
  syncFeeds();
  folderDialog.close();
  render();
});

function finishDeleteFolder(mode) {
  const id = deletingFolder;
  deletingFolder = null;
  deleteDialog.close();
  if (!id) return;

  const node = findNode(state.tree, id);
  if (!node || node.type !== 'folder') return;
  const urls = allFeeds(node.children).map((f) => f.url);
  if (!deleteFolder(state.tree, id, mode)) return;

  saveTree(state.tree);
  syncFeeds();
  if (mode === 'delete') dropFeedUrls(urls);
  render();
}

$('#del-cancel').addEventListener('click', () => { deletingFolder = null; deleteDialog.close(); });
deleteDialog.addEventListener('click', (e) => { if (e.target === deleteDialog) deleteDialog.close(); });
$('#del-keep').addEventListener('click', () => finishDeleteFolder('root'));
$('#del-all').addEventListener('click', () => finishDeleteFolder('delete'));

$('#move-cancel').addEventListener('click', () => moveDialog.close());
moveDialog.addEventListener('click', (e) => { if (e.target === moveDialog) moveDialog.close(); });

$('#move-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = movingFeed;
  const target = $('#move-folder').value;
  moveDialog.close();
  movingFeed = null;
  if (!id || !moveNode(state.tree, id, target)) return;
  saveTree(state.tree);
  syncFeeds();
  render();
});

// ---------- renomear feed ----------
function setRenameMsg(text, err = false) {
  const m = $('#rename-msg');
  if (!m) return;
  m.textContent = text;
  m.classList.toggle('err', err);
}

function openRenameDialog(id) {
  const node = findNode(state.tree, id);
  if (!node || node.type !== 'feed') return;
  renamingFeed = id;
  $('#rename-hint').textContent = node.url;
  $('#rename-name').value = node.title;
  setRenameMsg('');
  renameDialog.showModal();
  const input = $('#rename-name');
  input.focus();
  input.select();
}

$('#rename-cancel').addEventListener('click', () => {
  renamingFeed = null;
  renameDialog.close();
});
renameDialog.addEventListener('click', (e) => {
  if (e.target === renameDialog) {
    renamingFeed = null;
    renameDialog.close();
  }
});

$('#rename-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#rename-name').value.trim();
  if (!name) { setRenameMsg('informe um nome', true); return; }
  const id = renamingFeed;
  renamingFeed = null;
  renameDialog.close();
  if (!id) return;
  renameFeed(id, name);
  toast('feed renomeado');
});

// ---------- menu de contexto: alvos ----------
const sideAnchor = (li) => li.querySelector('.nav-item, .folder-head') || li;
const cardAnchor = (card) => card.querySelector('h3 a') || card;

$('#feeds').addEventListener('contextmenu', (e) => {
  const li = e.target.closest('li[data-type]');
  if (!li) return;
  fromContextMenu(e, (x, y) => {
    if (li.dataset.type === 'feed') openFeedMenu(li.dataset.url, sideAnchor(li), x, y);
    else openFolderMenu(li.dataset.id, sideAnchor(li), x, y);
  });
});

$('#feeds').addEventListener('pointerdown', (e) => {
  const li = e.target.closest('li[data-type]');
  if (!li) return;
  beginLongPress(e, (x, y) => {
    if (li.dataset.type === 'feed') openFeedMenu(li.dataset.url, sideAnchor(li), x, y);
    else openFolderMenu(li.dataset.id, sideAnchor(li), x, y);
  });
});

$('#items').addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const item = state.items.find((i) => i.id === card.dataset.id);
  if (!item) return;
  fromContextMenu(e, (x, y) => openCardMenu(item, cardAnchor(card), x, y));
});

$('#items').addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const item = state.items.find((i) => i.id === card.dataset.id);
  if (!item) return;
  beginLongPress(e, (x, y) => openCardMenu(item, cardAnchor(card), x, y));
});

$('#reader').addEventListener('contextmenu', (e) => {
  if (!state.current) return;
  if (e.target.closest('.splitter')) return;
  if (e.target.closest('.prose, iframe, video, audio')) return;   // texto do artigo mantém o menu nativo
  fromContextMenu(e, (x, y) => openReaderMenu(state.current, x, y));
});

$('#reader').addEventListener('pointerdown', (e) => {
  if (!state.current) return;
  if (e.target.closest('.splitter')) return;
  if (e.target.closest('.prose, iframe, video, audio')) return;
  beginLongPress(e, (x, y) => openReaderMenu(state.current, x, y));
});

$('#btn-refresh').addEventListener('click', () => refreshAll({ force: true }));
$('#top-download').addEventListener('click', () => downloadFeed(activeFeed()));
$('#btn-readall').addEventListener('click', markAllRead);
$('#file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importOpml(file);
  e.target.value = '';
});
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  syncReaderList();
  renderItems();
});

// ---------- leitor ----------
$('#rd-close').addEventListener('click', closeReader);
$('#rd-prev').addEventListener('click', () => stepReader(-1));
$('#rd-next').addEventListener('click', () => stepReader(1));
$('#rd-archive').addEventListener('click', () => toggleArchive(state.current));

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || !state.current) return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  if (e.key === 'Escape') closeReader();
  else if (e.key === 'j') stepReader(1);
  else if (e.key === 'k') stepReader(-1);
});

// ---------- init ----------
// chave de versões anteriores (proxy manual), não é mais usada
try { localStorage.removeItem('rss.proxy'); } catch { /* ignora */ }

const REFRESH_INTERVAL = 30 * 60 * 1000;

// tema "sistema": acompanha a preferência do sistema operacional
if (window.matchMedia) {
  const themeQuery = matchMedia('(prefers-color-scheme: light)');
  const onThemeChange = () => { if (state.settings.theme === 'system') applySettings(); };
  if (themeQuery.addEventListener) themeQuery.addEventListener('change', onThemeChange);
  else if (themeQuery.addListener) themeQuery.addListener(onThemeChange);
}

paintIcons();
setupSplitter($('#split-side'), 'side');
setupSplitter($('#split-reader'), 'list');
window.addEventListener('resize', () => { applyLayout(); syncSplitters(); });
setSidebar(isMobile() ? false : load(LS_SIDE, true));
render();
if (state.feeds.length) refreshAll();

// atualização automática só com a aba visível, para poupar a cota dos proxies
setInterval(() => {
  if (state.feeds.length && document.visibilityState === 'visible') refreshAll();
}, REFRESH_INTERVAL);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.feeds.length) return;
  const age = state.updatedAt ? Date.now() - state.updatedAt.getTime() : Infinity;
  if (age >= CACHE_TTL) refreshAll();
});
