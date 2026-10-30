// reader.js — leitura dentro do app
// - sanitizeHtml: monta DOM seguro a partir do HTML do feed (lista de tags permitidas)
// - videoElement: player embutido (YouTube/Vimeo via iframe, arquivos <video>/<audio>)
// - extractArticle: tenta extrair o texto principal de uma página (para feeds que trazem só resumo)

const ALLOWED_TAGS = new Set([
  'p', 'br', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'span', 'div', 'blockquote', 'q', 'pre', 'code', 'kbd', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'video', 'audio', 'source', 'iframe',
]);

// removidas junto com todo o conteúdo
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'object', 'embed', 'form', 'input', 'button', 'select',
  'textarea', 'svg', 'math', 'link', 'meta', 'template', 'canvas', 'head', 'title', 'base',
  'frame', 'frameset',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'source', 'iframe']);

const IFRAME_HOSTS =
  /^(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|dailymotion\.com|streamable\.com|open\.spotify\.com)$/i;

function absUrl(u, base) {
  if (!u) return '';
  try {
    const x = new URL(String(u).trim(), base || 'https://x.invalid/');
    if (!base && x.hostname === 'x.invalid') return '';
    return /^https?:$/.test(x.protocol) ? x.href : '';
  } catch {
    return '';
  }
}

function makeEl(n, tag, base, parentTag) {
  const attr = (name) => n.getAttribute(name);

  switch (tag) {
    case 'a': {
      const href = absUrl(attr('href'), base);
      if (!href) return document.createElement('span');
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }
    case 'img': {
      const w = attr('width');
      const h = attr('height');
      if ((w !== null && +w <= 2) || (h !== null && +h <= 2)) return null;   // pixel de rastreio
      const srcset = (attr('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
      const src = absUrl(attr('src') || attr('data-src') || attr('data-lazy-src') || srcset, base);
      if (!src) return null;
      const img = document.createElement('img');
      img.src = src;
      img.alt = attr('alt') || '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      return img;
    }
    case 'video':
    case 'audio': {
      const m = document.createElement(tag);
      m.controls = true;
      m.preload = 'metadata';
      const src = absUrl(attr('src'), base);
      if (src) m.src = src;
      if (tag === 'video') {
        m.playsInline = true;
        const p = absUrl(attr('poster'), base);
        if (p) m.poster = p;
      }
      return m;
    }
    case 'source': {
      if (parentTag !== 'video' && parentTag !== 'audio') return null;
      const src = absUrl(attr('src'), base);
      if (!src) return null;
      const s = document.createElement('source');
      s.src = src;
      if (attr('type')) s.type = attr('type');
      return s;
    }
    case 'iframe': {
      const src = absUrl(attr('src') || attr('data-src'), base);
      if (!src || !IFRAME_HOSTS.test(new URL(src).hostname)) return null;
      return makeIframe(src);
    }
    case 'td':
    case 'th': {
      const c = document.createElement(tag);
      for (const k of ['colspan', 'rowspan']) {
        const v = parseInt(attr(k), 10);
        if (v > 1 && v < 50) c.setAttribute(k, String(v));
      }
      return c;
    }
    default:
      return document.createElement(tag);
  }
}

function makeIframe(src) {
  const f = document.createElement('iframe');
  f.src = src;
  f.title = 'Vídeo incorporado';
  f.allowFullscreen = true;
  f.loading = 'lazy';
  f.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen');
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
  return f;
}

function cleanNode(node, base, parentTag, out) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out.append(document.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1) continue;

    const tag = n.localName;
    if (DROP_TAGS.has(tag)) continue;
    if (!ALLOWED_TAGS.has(tag)) { cleanNode(n, base, parentTag, out); continue; }   // desembrulha

    const el = makeEl(n, tag, base, parentTag);
    if (!el) continue;
    if (!VOID_TAGS.has(tag)) cleanNode(n, base, tag, el);
    out.append(el);
  }
}

// Texto puro (sem tags): vira parágrafos, com links clicáveis
function plainToFragment(text) {
  const frag = document.createDocumentFragment();
  text.split(/\r?\n\s*\r?\n/).map((t) => t.trim()).filter(Boolean).forEach((t) => {
    const p = document.createElement('p');
    p.className = 'pre';
    t.split(/(https?:\/\/[^\s<>"')]+)/).forEach((part, idx) => {
      if (idx % 2 === 1) {
        const a = document.createElement('a');
        a.href = part;
        a.textContent = part;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.append(a);
      } else if (part) {
        p.append(document.createTextNode(part));
      }
    });
    frag.append(p);
  });
  return frag;
}

function sanitizeHtml(html, base) {
  const src = String(html || '');
  if (!/<[a-z][\s\S]*>/i.test(src)) return plainToFragment(src);

  const frag = document.createDocumentFragment();
  const doc = new DOMParser().parseFromString(src, 'text/html');
  cleanNode(doc.body, base, 'body', frag);
  return frag;
}

// ---------- player ----------
// video: { kind: 'embed' | 'file' | 'audio', url, type }
function videoElement(video, poster) {
  if (!video) return null;
  const wrap = document.createElement('div');

  if (video.kind === 'embed') {
    wrap.className = 'video';
    wrap.append(makeIframe(video.url));
  } else if (video.kind === 'file') {
    wrap.className = 'video';
    const v = document.createElement('video');
    v.controls = true;
    v.preload = 'metadata';
    v.playsInline = true;
    if (poster) v.poster = poster;
    v.src = video.url;
    wrap.append(v);
  } else {
    wrap.className = 'audio';
    const a = document.createElement('audio');
    a.controls = true;
    a.preload = 'metadata';
    a.src = video.url;
    wrap.append(a);
  }
  return wrap;
}

// ---------- extração do artigo completo ----------
function extractArticle(pageHtml) {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
  doc.querySelectorAll('script, style, nav, header, footer, aside, form, noscript').forEach((n) => n.remove());

  const selectors = [
    'article', '[itemprop="articleBody"]', '.entry-content', '.post-content', '.article-body',
    '.article-content', '.post-body', 'main', '[role="main"]',
  ];
  let best = null;
  let bestLen = 0;
  for (const s of selectors) {
    for (const n of doc.querySelectorAll(s)) {
      const len = n.textContent.trim().length;
      if (len > bestLen) { best = n; bestLen = len; }
    }
  }

  // plano B: o bloco com mais texto em parágrafos diretos
  if (!best || bestLen < 300) {
    let score = 0;
    doc.querySelectorAll('div, section').forEach((n) => {
      const len = [...n.children].filter((c) => c.tagName === 'P')
        .reduce((a, p) => a + p.textContent.length, 0);
      if (len > score) { score = len; best = n; }
    });
    bestLen = score;
  }

  if (!best || bestLen < 200) return null;
  return best.innerHTML;
}
