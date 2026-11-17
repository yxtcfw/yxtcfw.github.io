// ==UserScript==
// @name         内容采集管道 Content Toolkit
// @namespace    https://github.com/
// @version      2.2
// @description  联想词采集 + 文章搜索远程抓取；搜索引擎专用解析 + 风控识别 + Cookie 预热 + 随机降频重试；支持粘贴 HTML 离线解析与 JSON 导出
// @author       You
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_download
// @connect      suggestion.baidu.com
// @connect      www.baidu.com
// @connect      api.bing.com
// @connect      sug.so.360.cn
// @connect      sor.html5.qq.com
// @connect      suggest.taobao.com
// @connect      api.bilibili.com
// @connect      www-hj.douyin.com
// @connect      www.sogou.com
// @connect      www.baidu.com
// @connect      cn.bing.com
// @connect      www.bing.com
// @connect      www.so.com
// @connect      www.google.com
// @connect      *
// ==/UserScript==

/*
 * v2.0 精简说明
 *  1. 通信只保留「同窗口 window.postMessage」一条通道：脚本注入在工具页文档内，自发自收；
 *     不再向 window.parent / window.top 转发，也不再使用 BroadcastChannel 与 GM 存储中继，
 *     因此本脚本不再需要 GM_setValue / GM_getValue / GM_addValueChangeListener / GM_deleteValue。
 *  2. 删除「当前页采集」：不再向任何目标站注入悬浮按钮，只响应工具页发来的远程抓取请求。
 *  3. 文章解析改为「按 class 定位遍历」：先用一组 class / 结构选择器命中文章列表项容器，
 *     再在容器内定位标题节点与链接；一条都没命中时才退回全站 a[href] 扫描，并在回传里标注 via。
 *  v2.1 变更（文章列表采集参考「本页内容采集器」脚本重写解析核心）
 *  4. 解析先按 CONTENT_SELECTORS（article / main / #content / .content / .post-body /
 *     .article-content / body …）挑「正文根区域」，减少导航、页脚噪声；
 *  5. 在正文根区域内遍历 a[href] 得到 { text, href } 链接清单（参考脚本的 links 结构），
 *     与 class 定位的列表项双来源合并、按 normUrl 去重；
 *  6. 回传参考脚本同款的页面结构 page = { url, title, time, root, textLen, text } 与 links 清单；
 *  7. 新增 AC_EXPORT：页面把汇总数据发回来，脚本用 GM_setClipboard + GM_download 输出 JSON；
 *     为此 @grant 增加 GM_setClipboard / GM_download。
 *  8. 参考脚本里的「悬浮按钮 + 当前页采集」依旧不启用：本脚本只在工具页工作，不向目标站注入 UI。
 *
 * 消息一览（页面 -> 脚本 / 脚本 -> 页面）
 *  CT_PING  -> CT_PONG                      握手（同时兼容旧版 SUG_PING / AC_PING / SUG_PONG）
 *  SUG_FETCH {id,cores,modifiers,engines}
 *          -> SUG_FETCH_PROGRESS {id,progress}
 *          -> SUG_FETCH_OK {id,results,combos,partial?}
 *          -> SUG_FETCH_ERR  {id,message}
 *  AC_SEARCH {id,word,url,filter}
 *          -> AC_RESULT {id,word,source,items,total,via,page,links,note?}
 *          -> AC_ERR    {id,error}
 *  AC_EXPORT {id,data}  -> AC_EXPORT_OK {id,name,bytes,via} | AC_EXPORT_ERR {id,error}
 */

(function () {
  'use strict';

  var SUG = 'SUG_FETCH';
  var TAG = '[内容采集管道]';
  var log  = function () { console.log.apply(console, [TAG].concat([].slice.call(arguments))); };
  var warn = function () { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); };

  /* 工具页锚点：#ac-knowledge（知识库）或 #cores（核心词）任一存在即认定本页是工作台。
     只有工作台才注册监听、执行采集，避免同一脚本在几十个标签页里重复并发同一批请求。 */
  function isToolPage() {
    return !!(document.getElementById('ac-knowledge') || document.getElementById('cores'));
  }
  if (!isToolPage()) {
    log('非工作台页面，不注册监听：', location.href);
    return;
  }
  log('v2.2 已注入工作台 | 页面:', location.href);

  /* ==================== 通信层（单通道） ==================== */
  function emit(msg) {
    try { window.postMessage(msg, '*'); } catch (e) {}
  }

  var seen = {};
  function once(key) {
    if (seen[key]) return false;
    seen[key] = 1;
    if (Object.keys(seen).length > 200) seen = {};
    return true;
  }

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;
    var t = data.type;
    if (typeof t !== 'string') return;

    if (t === 'CT_PING' || t === 'SUG_PING' || t === 'AC_PING') {
      emit({ type: 'CT_PONG', href: location.href, ver: '2.2' });
      emit({ type: 'SUG_PONG', href: location.href, ver: '2.2' });   /* 兼容外层壳的旧监听 */
      return;
    }
    if (t === SUG) {
      if (!once(SUG + ':' + data.id)) return;
      log('收到联想词采集请求 id=' + data.id, '| cores:', data.cores, '| engines:', data.engines);
      runSug(data);
      return;
    }
    if (t === 'AC_SEARCH') {
      if (!once('AC:' + data.id)) return;
      log('收到文章搜索请求 id=' + data.id, '| word:', data.word, '| url:', data.url);
      /* 结构化上下文：出问题时控制台一眼能看出是「没 GM」「地址不合法」还是「被风控」，
         不再只有一行请求日志后面跟着一个来源不明的 null */
      log('请求上下文', {
        id: data.id, word: data.word || '', url: data.url || '',
        filter: data.filter || 'normal', gm: HAS_GM, engine: engineHint(data.url), ver: '2.2'
      });
      collect(data);
      return;
    }
    if (t === 'AC_PARSE_HTML') {
      if (!once('AH:' + data.id)) return;
      log('收到粘贴 HTML 解析请求 id=' + data.id, '| 源码长度:', String(data.html || '').length);
      parsePasted(data);
      return;
    }
    if (t === 'AC_EXPORT') {
      if (!once('AEX:' + data.id)) return;
      log('收到导出请求 id=' + data.id);
      exportJson(data);
    }
  });

  /* 主动报到，页面不必等到用户点按钮才知道脚本在不在 */
  emit({ type: 'CT_PONG', href: location.href, from: 'script-inject', ver: '2.2' });
  emit({ type: 'SUG_PONG', href: location.href, from: 'script-inject', ver: '2.2' });

  var HAS_GM = (typeof GM_xmlhttpRequest === 'function');
  if (!HAS_GM) warn('GM_xmlhttpRequest 不可用：检查脚本是否启用、@grant 是否生效');

  /* ============================================================
     一、联想词采集
     ============================================================ */

  function clean(arr) {
    return Array.from(new Set((arr || [])
      .map(function (s) {
        return String(s == null ? '' : s)
          .replace(/<[^>]+>/g, '')
          .replace(/&[a-z]+;/gi, '')
          .trim();
      })
      .filter(function (s) {
        return s && s.length >= 2 && s.length <= 40 && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(s);
      })));
  }

  function stripJsonp(raw) {
    var i = raw.search(/[{[]/);
    if (i < 0) throw new Error('未找到 JSON 起点');
    var close = raw[i] === '{' ? '}' : ']';
    var j = raw.lastIndexOf(close);
    if (j <= i) throw new Error('JSON 未闭合');
    return raw.slice(i, j + 1);
  }

  var P = {
    baidu: function (raw) {
      var m = raw.match(/s\s*:\s*(\[[\s\S]*?\])/);
      if (!m) throw new Error('su 未匹配 s 数组');
      return clean(JSON.parse(m[1]));
    },
    baidu_sugrec: function (raw) {
      var j = JSON.parse(raw);
      if (!Array.isArray(j.g)) throw new Error('sugrec 结构异常');
      return clean(j.g.map(function (x) { return x && x.q; }));
    },
    bing: function (raw) {
      var j = JSON.parse(stripJsonp(raw));
      if (!j.AS) throw new Error('bing 结构异常');
      var w = [];
      (j.AS.Results || []).forEach(function (r) {
        (r.Suggests || []).forEach(function (s) { if (s && s.Txt) w.push(s.Txt); });
      });
      return clean(w);
    },
    so360: function (raw) {
      var j = JSON.parse(stripJsonp(raw));
      var res = j.result || j.data;
      if (!Array.isArray(res)) throw new Error('360 结构异常');
      return clean(res.map(function (x) { return typeof x === 'string' ? x : x && x.word; }));
    },
    qq: function (raw) {
      var m = raw.match(/sug\((\[[\s\S]*\])\s*,\s*-?\d+\s*\)\s*;?\s*$/);
      if (!m) throw new Error('QQ 外壳未匹配');
      var arr = JSON.parse(m[1]);
      if (!Array.isArray(arr) || arr.length < 2) throw new Error('QQ 结构异常');
      return clean(Array.isArray(arr[1]) ? arr[1] : []);
    },
    taobao: function (raw) {
      var j = JSON.parse(stripJsonp(raw));
      var res = j.result;
      if (!Array.isArray(res)) throw new Error('淘宝结构异常');
      return clean(res.map(function (x) { return Array.isArray(x) ? x[0] : x; }));
    },
    bilibili: function (raw) {
      var j = JSON.parse(raw);
      if (j.code !== 0) throw new Error('bilibili code=' + j.code);
      var tag = (((j.data || {}).result) || {}).tag;
      if (!Array.isArray(tag)) throw new Error('bilibili 结构异常');
      return clean(tag.map(function (x) { return (x && (x.value || x.term)) || ''; }));
    },
    douyin: function (raw) {
      var j = JSON.parse(raw);
      if (!Array.isArray(j.sug_list)) throw new Error('douyin 结构异常');
      return clean(j.sug_list.map(function (x) { return x && x.content; }));
    }
  };

  var ENGINES = {
    baidu:        { url: function (q) { return 'https://suggestion.baidu.com/su?wd=' + q; }, referer: 'https://www.baidu.com/', gbk: true },
    baidu_sugrec: { url: function (q) { return 'https://www.baidu.com/sugrec?pre=1&p=1&ie=utf-8&json=1&prod=pc&from=pc_web&imod=20&wd=' + q; }, referer: 'https://www.baidu.com/' },
    bing:         { url: function (q) { return 'https://api.bing.com/qsonhs.aspx?q=' + q + '&type=cb&cb=mySugCallback'; }, referer: 'https://cn.bing.com/' },
    so360:        { url: function (q) { return 'https://sug.so.360.cn/suggest?encodein=utf-8&encodeout=utf-8&format=json&word=' + q + '&callback=mySugCallback'; }, referer: 'https://www.so.com/' },
    qq:           { url: function (q) { return 'https://sor.html5.qq.com/api/getsug?key=' + q; }, referer: 'https://www.sogou.com/', gbk: true },
    taobao:       { url: function (q) { return 'https://suggest.taobao.com/sug?code=utf-8&q=' + q + '&callback=mySugCallback'; }, referer: 'https://s.taobao.com/' },
    bilibili:     { url: function (q) { return 'https://api.bilibili.com/x/web-interface/suggest?highlight=0&term=' + q; }, referer: 'https://search.bilibili.com/' },
    douyin:       { url: function (q) { return 'https://www-hj.douyin.com/aweme/v1/web/search/sug/?aid=6383&keyword=' + q; }, referer: 'https://www.douyin.com/' }
  };

  function gmFetch(key, cfg, q) {
    return new Promise(function (resolve) {
      if (!HAS_GM) return resolve([key, []]);           // 必须 resolve，否则 Promise.all 永久挂起
      var word = encodeURIComponent(q);
      var settled = false;
      var once_ = function (v) { if (!settled) { settled = true; resolve(v); } };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: cfg.url(word),
          headers: { Referer: cfg.referer || '' },
          responseType: cfg.gbk ? 'arraybuffer' : 'text',
          timeout: 8000,
          onload: function (res) {
            try {
              var raw = cfg.gbk ? new TextDecoder('gbk').decode(res.response) : res.responseText;
              once_([key, P[key] ? P[key](raw) : []]);
            } catch (err) { log(key, '解析失败:', err.message); once_([key, []]); }
          },
          onerror:   function () { log(key, '请求失败'); once_([key, []]); },
          ontimeout: function () { log(key, '超时');   once_([key, []]); },
          onabort:   function () { log(key, '已中止'); once_([key, []]); }
        });
      } catch (err) { warn(key, '发起异常:', err && err.message); once_([key, []]); }
    });
  }

  function cartesian(cores, mods) {
    if (!mods || !mods.length) return cores.map(function (c) { return [c]; });
    var out = [];
    cores.forEach(function (c) { mods.forEach(function (m) { out.push([c, m]); }); });
    return out;
  }
  function uniq(obj) {
    Object.keys(obj).forEach(function (k) { obj[k] = Array.from(new Set(obj[k])); });
    return obj;
  }

  function runSug(req) {
    var id = req.id;
    var engines = Array.isArray(req.engines) ? req.engines : [];
    var cores = (req.cores || []).filter(Boolean);
    var modifiers = (req.modifiers || []).filter(Boolean);

    var jobs = Object.keys(ENGINES).filter(function (k) { return engines.indexOf(k) >= 0; })
      .map(function (k) { return { key: k, cfg: ENGINES[k] }; });

    if (!jobs.length) {
      warn('没有可用平台，请求 engines:', engines);
      emit({ type: SUG + '_ERR', id: id, message: '没有匹配到可用平台' });
      return;
    }

    var combos = cartesian(cores, modifiers);
    if (!combos.length) { emit({ type: SUG + '_OK', id: id, results: {}, combos: 0 }); return; }

    var total = combos.length * jobs.length;
    var done = 0;
    var results = {};
    var finished = false;

    var watchdog = setTimeout(function () {
      if (finished) return;
      finished = true;
      warn('整体超时，返回已采集到的部分结果');
      emit({ type: SUG + '_OK', id: id, results: uniq(results), combos: combos.length, partial: true });
    }, 55000);

    Promise.all(
      combos.reduce(function (acc, cm) {
        var c = cm[0], m = cm[1];
        jobs.forEach(function (j) {
          acc.push(gmFetch(j.key, j.cfg, m ? c + m : c).then(function (r) {
            done++;
            if (!finished) emit({ type: SUG + '_PROGRESS', id: id, progress: Math.round(done / total * 100) });
            var k = r[0];
            if (!results[k]) results[k] = [];
            results[k].push.apply(results[k], r[1]);
          }));
        });
        return acc;
      }, [])
    ).then(function () {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      uniq(results);
      var n = Object.keys(results).reduce(function (s, k) { return s + results[k].length; }, 0);
      log('联想词采集完成，共', n, '条');
      emit({ type: SUG + '_OK', id: id, results: results, combos: combos.length });
      if (!n) warn('结果为 0：可能是平台接口变更，或该 frame 无 GM 权限');
    }).catch(function (err) {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      warn('采集异常:', err && err.message);
      emit({ type: SUG + '_ERR', id: id, message: String((err && err.message) || err) });
    });
  }

  /* ============================================================
     二、文章列表采集（远程抓取 + 正文根区域定位 + 链接遍历）
     解析思路参考「本页内容采集器」脚本：
       1) CONTENT_SELECTORS 优先级挑正文根区域，减少导航 / 页脚噪声；
       2) 在根区域内遍历 a[href] 得到 { text, href } 链接清单；
       3) 再用 class 定位的文章列表容器给链接补全标题，两条来源合并去重；
       4) 输出参考脚本同款的 { url, title, time, text, links } 结构，便于直接分析。
     注意：参考脚本的悬浮按钮 / 当前页采集没有搬过来——本脚本只做远程抓取，
           不向任何目标站注入 UI。
     ============================================================ */

  function normUrl(u) {
    return u.replace(/#.*$/, '')
            .replace(/[?&](utm_[^=]+|spm|from|share_token|scene|ref)=[^&]*/gi, '')
            .replace(/[?&]$/, '').replace(/\?$/, '');
  }

  var SKIP_HREF = /^(javascript:|mailto:|tel:|data:|blob:|#)/i;
  var SKIP_ASSET = /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|woff2?|ttf|pdf|zip|mp4|mp3|avi)$/i;

  function cleanText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function validTitle(t, min, max) {
    return t && t.length >= min && t.length <= max && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(t);
  }

  function absUrl(href, baseUrl) {
    if (!href || SKIP_HREF.test(href)) return '';
    try {
      var a = new URL(href, baseUrl).href;
      if (!/^https?:/i.test(a)) return '';
      if (SKIP_ASSET.test(a.split('?')[0])) return '';
      return a;
    } catch (e) { return ''; }
  }

  /* ---- 1. 正文根区域：优先级完全沿用参考脚本的 CONTENT_SELECTORS，末尾补几个常见 CMS 容器 ---- */
  var CONTENT_SELECTORS = [
    'article', 'main', '#content', '.content',
    '.post-body', '.article-content', 'body',
    '.entry-content', '#main', '.main-content', '.article-body', '#article', '.wrapper'
  ];

  /* DOMParser 解析出的文档不参与布局，没有 innerText，用 textContent 等价替代 */
  function textLen(el) { return el && el.textContent ? cleanText(el.textContent).length : 0; }
  function linkCount(el) { try { return el.querySelectorAll('a[href]').length; } catch (e) { return 0; } }

  /* 参考脚本：取第一个 innerText 长度 > 200 的容器，全不满足则 document.body。
     搜索结果页常常没有 article / main，或 article 只包住单条结果，
     所以在字数阈值之外再加一条「链接数 >= 5」判定，避免挑到只含一条结果的碎片容器。 */
  function pickRoot(doc) {
    var best = null;
    for (var i = 0; i < CONTENT_SELECTORS.length; i++) {
      var sel = CONTENT_SELECTORS[i], el = null;
      try { el = doc.querySelector(sel); } catch (e) { el = null; }
      if (!el) continue;
      var tl = textLen(el), lc = linkCount(el);
      /* body 永远只当兜底：只要有更精确的容器命中，就用容器，避免把导航 / 页脚又拉进来 */
      if (sel !== 'body' && (tl > 200 || lc >= 5)) return { root: el, via: sel };
      if (sel !== 'body' && (!best || lc > best.lc || (lc === best.lc && tl > best.tl))) {
        best = { root: el, via: sel, lc: lc, tl: tl };
      }
    }
    if (best) return { root: best.root, via: best.via };
    return { root: doc.body || doc, via: 'body' };
  }

  /* ---- 2. 链接清单：参考脚本的 links 结构 { text, href }，只留 http(s) ---- */
  function collectLinks(root, baseUrl) {
    var as = root.querySelectorAll('a[href]'), out = [];
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      var href = absUrl(a.getAttribute('href'), baseUrl);
      if (!href) continue;
      var text = cleanText(a.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || '');
      out.push({ text: text, href: href, el: a });
    }
    return out;
  }

  /* ---- 3. class 定位列表项容器（沿用 v2.0） ---- */
  var ITEM_SELECTORS = [
    'article',
    '[class*="article-item"]', '[class*="article_item"]', '[class*="articleItem"]',
    '[class*="article-list"] > li', '[class*="article-list"] > a', '[class*="article-list"] > div',
    '[class*="post-item"]', '[class*="post_item"]', '[class*="postItem"]',
    '[class*="post-list"] > li', '[class*="post-list"] > a', '[class*="posts"] > article',
    '[class*="news-item"]', '[class*="news_item"]', '[class*="newsItem"]',
    '[class*="news-list"] > li', '[class*="news-list"] > a',
    '[class*="story-item"]', '[class*="feed-item"]', '[class*="feed_item"]',
    '[class*="list-item"]', '[class*="list_item"]', '[class*="listItem"]',
    '[class*="card-item"]', '[class*="card"] > h2 a', '[class*="card"] > h3 a',
    '[class*="entry-item"]', '[class*="entry"] > h2', '[class*="entry"] > h3',
    '[class*="media-item"]', '[class*="result-item"]', '[class*="search-result"]',
    '[class*="item-title"]', 'li[class*="item"]'
  ];

  var TITLE_SELECTORS = ['h1', 'h2', 'h3', 'h4', '[class*="title"]', '[class*="Title"]', '[class*="tit"]'];

  function inChrome(el) {
    try { return !!el.closest('nav, header, footer'); } catch (e) { return false; }
  }

  function pickTitleNode(box, min, max, sels) {
    var list = (sels && sels.length) ? sels : TITLE_SELECTORS;
    for (var i = 0; i < list.length; i++) {
      var nodes;
      try { nodes = box.querySelectorAll(list[i]); } catch (e) { continue; }
      for (var j = 0; j < nodes.length; j++) {
        var t = cleanText(nodes[j].textContent);
        if (validTitle(t, min, max)) return { node: nodes[j], text: t };
      }
    }
    return null;
  }

  function pickLink(box, titleNode, baseUrl) {
    if (titleNode) {
      var a0 = titleNode.tagName === 'A' ? titleNode : (titleNode.querySelector && titleNode.querySelector('a[href]'));
      if (a0) {
        var u0 = absUrl(a0.getAttribute('href'), baseUrl);
        if (u0) return u0;
      }
      var p0 = titleNode.closest ? titleNode.closest('a[href]') : null;
      if (p0) {
        var up = absUrl(p0.getAttribute('href'), baseUrl);
        if (up) return up;
      }
    }
    var as = box.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      if (inChrome(as[i])) continue;
      var u = absUrl(as[i].getAttribute('href'), baseUrl);
      if (u) return u;
    }
    return '';
  }

  /* ---- 4. 主解析：正文根区域 → class 列表项 + a[href] 遍历，双来源合并去重 ---- */
  /* 搜索引擎结果页的标题链接多半是跳转包装地址（/link?url=、/redir、/url?q=、/ck/a…）：
     能还原出真实目标就还原，还原不了的保留包装地址并打上 redirect 标记，页面上显示「跳转链接」。 */
  var REDIRECT_PATH = /(\/link\/?|\/redir\/?|\/url\/?|\/ck\/a\/?|\/jump\/?|\/redirect\/?|\/outlink\/?|\/cn\/?$)/i;
  function unwrapUrl(u) {
    try {
      var x = new URL(u);
      if (!REDIRECT_PATH.test(x.pathname)) return { url: u, redirect: false };
      var cand = '';
      ['url', 'q', 'target', 'to', 'u', 'link', 'dest'].some(function (k) {
        var v = x.searchParams.get(k);
        if (v && /^https?:\/\//i.test(v)) { cand = v; return true; }
        return false;
      });
      return cand ? { url: cand, redirect: true } : { url: u, redirect: true };
    } catch (e) { return { url: u, redirect: false }; }
  }

  function pushItem(out, mark, via, sel, title, url, from, limit) {
    if (out.length >= limit) return false;
    var real = unwrapUrl(url);
    var key = normUrl(real.url);
    if (mark[key]) return false;
    mark[key] = 1;
    via[sel] = (via[sel] || 0) + 1;
    out.push({ title: title, url: real.url, from: from, redirect: !!real.redirect });
    return true;
  }

  function extractPage(doc, baseUrl, opt) {
    opt = opt || {};
    var min = opt.minLen || 8, max = opt.maxLen || 120, limit = opt.limit || 300;
    var picked = pickRoot(doc), root = picked.root;
    var rule = engineRule(baseUrl);
    /* 引擎专用选择器排在通用规则前面：搜狗 / 百度 / 必应的结果块 class 完全不同，
       只靠通用 ITEM_SELECTORS 经常一条都命不中，最后落到 a[href] 兜底取回一堆导航垃圾 */
    var itemSels = rule ? rule.items.concat(ITEM_SELECTORS) : ITEM_SELECTORS;
    var titleSels = rule ? rule.title.concat(TITLE_SELECTORS) : TITLE_SELECTORS;
    var links = collectLinks(root, baseUrl);
    var out = [], mark = {}, via = {}, scanned = 0;

    function scanItems(container, tag) {
      for (var s = 0; s < itemSels.length && out.length < limit; s++) {
        var sel = itemSels[s], nodes;
        try { nodes = container.querySelectorAll(sel); } catch (e) { continue; }
        if (!nodes || !nodes.length) continue;
        var label = tag + ((rule && rule.items.indexOf(sel) >= 0) ? 'engine:' + sel : sel);
        for (var i = 0; i < nodes.length && out.length < limit; i++) {
          var box = nodes[i];
          if (inChrome(box)) continue;
          scanned++;
          var tn = pickTitleNode(box, min, max, titleSels);
          var title = tn ? tn.text : '';
          var url = pickLink(box, tn ? tn.node : null, baseUrl);
          if (!url) continue;
          if (!title) {
            var a = box.querySelector('a[href]');
            title = cleanText(a ? a.textContent : box.textContent);
          }
          if (!validTitle(title, min, max)) continue;
          pushItem(out, mark, via, label, title, url, 'class', limit);
        }
      }
    }

    /* 4a. 正文根区域内：引擎专用规则 + 通用 class 定位 */
    scanItems(root, '');

    /* 4a-2. 根区域内一条都没命中 → 同一批选择器在整份文档上再扫一遍。
       搜狗 / 百度的结果区往往不在 pickRoot 挑中的容器里（它们把结果塞在 form / #page 下），
       少了这一步就会「扫到几百个链接却 0 条结果」。 */
    var bodyEl = doc.body || doc;
    if (!out.length && root !== bodyEl) scanItems(bodyEl, 'doc:');

    /* 4b. 正文根区域内的 a[href] 遍历（参考脚本的 links 清单），补齐 class 定位漏掉的条目 */
    for (var k = 0; k < links.length && out.length < limit; k++) {
      var L = links[k];
      if (inChrome(L.el)) continue;
      scanned++;
      if (!validTitle(L.text, min, max)) continue;
      pushItem(out, mark, via, 'root:a[href]', L.text, L.href, 'root', limit);
    }

    /* 4c. 根区域内一条都没命中：退回整份文档扫描（等价参考脚本落到 document.body） */
    if (!out.length) {
      var all = collectLinks(bodyEl, baseUrl);
      for (var q = 0; q < all.length && out.length < limit; q++) {
        var A = all[q];
        if (inChrome(A.el)) continue;
        scanned++;
        if (!validTitle(A.text, min, max)) continue;
        pushItem(out, mark, via, 'fallback:a[href]', A.text, A.href, 'fallback', limit);
      }
    }

    var top = '', n = 0;
    Object.keys(via).forEach(function (kk) { if (via[kk] > n) { n = via[kk]; top = kk; } });

    var linkOut = [], lmark = {};
    for (var z = 0; z < links.length && linkOut.length < 200; z++) {
      var lk = normUrl(links[z].href);
      if (lmark[lk]) continue;
      lmark[lk] = 1;
      linkOut.push({ text: (links[z].text || '').slice(0, 120), href: links[z].href });
    }

    var full = cleanText(root.textContent || '');
    return {
      items: out, scanned: scanned, via: top || 'none',
      page: {
        url: baseUrl,
        title: cleanText((doc.title || '').slice(0, 200)),
        time: new Date().toISOString(),
        root: picked.via,
        textLen: full.length,
        text: full.slice(0, 8000)
      },
      links: linkOut
    };
  }

  function filterPreset(name) {
    if (name === 'strict') return { minLen: 14, maxLen: 90 };
    if (name === 'loose')  return { minLen: 4,  maxLen: 200 };
    return { minLen: 8, maxLen: 120 };
  }

  /* ============================================================
     二-B、反风控三件套：引擎专用规则 / 风控页识别 / Cookie 预热 + 随机降频重试
     说明：只做「像正常浏览器一样访问」的轻量拟人（预热会话 Cookie、随机间隔、
     失败退避重试、识别验证页后主动停止），不绕过验证码、登录墙或会员限制——
     一旦命中验证页就明确报错并给出可操作建议，而不是反复硬试把 IP 采封。
     ============================================================ */

  /* 各搜索引擎结果页的真实结构 */
  var ENGINE_RULES = [
    { host: /(^|\.)sogou\.com$/i, home: 'https://www.sogou.com/', name: '搜狗',
      items: ['.vrwrap', '.rb', '.lr_17', '[class*="vr-title"]', '#results > div', '[class*="results"] > div'],
      title: ['h3 a', 'h3', '[class*="vr-title"]', '[class*="title"]'] },
    { host: /(^|\.)baidu\.com$/i, home: 'https://www.baidu.com/', name: '百度',
      items: ['.result.c-container', 'div[tpl]', '.c-container', '.result', '#content_left > div'],
      title: ['h3 a', 'h3', '.t', '[class*="title"]'] },
    { host: /(^|\.)bing\.com$/i, home: 'https://cn.bing.com/', name: '必应',
      items: ['li.b_algo', '.b_algo', '#b_results > li'],
      title: ['h2 a', 'h2', '[class*="title"]'] },
    { host: /(^|\.)so\.com$/i, home: 'https://www.so.com/', name: '360',
      items: ['.res-list > li', '.result', 'li[class*="item"]', '[class*="result-item"]'],
      title: ['h3 a', 'h3', '.res-title', '[class*="title"]'] },
    { host: /(^|\.)google\./i, home: 'https://www.google.com/', name: 'Google',
      items: ['div.g', '.tF2Cxc', 'div[data-hveid]'],
      title: ['h3', 'h3 a', '[class*="title"]'] },
    { host: /(^|\.)soso\.com$/i, home: 'https://www.soso.com/', name: '搜狗（soso）',
      items: ['.vrwrap', '.rb', '.result'], title: ['h3 a', 'h3'] }
  ];

  function engineRule(baseUrl) {
    var h = '';
    try { h = new URL(baseUrl).hostname; } catch (e) { return null; }
    for (var i = 0; i < ENGINE_RULES.length; i++) {
      if (ENGINE_RULES[i].host.test(h)) return ENGINE_RULES[i];
    }
    return null;
  }

  function engineHint(baseUrl) {
    var r = engineRule(baseUrl);
    if (r) return r.name;
    try { return new URL(baseUrl).hostname; } catch (e) { return '未知站点'; }
  }

  /* 风控 / 验证页特征：宁可漏判也不要误判成「抓取失败」，所以只认明确文案 */
  var BLOCK_RE = /(验证码|安全验证|人机验证|访问验证|滑动验证|拖动滑块|请完成.{0,6}验证|身份核实|antispider|captcha|recaptcha|access\s*denied|unusual\s*traffic|too\s*many\s*requests|访问过于频繁|请求过于频繁|操作过于频繁|IP.{0,8}(异常|限制|被封|封禁))/i;

  function looksBlocked(doc, status) {
    var text = '';
    try { text = cleanText((doc.body && doc.body.textContent) || ''); } catch (e) { text = ''; }
    var hit = BLOCK_RE.exec(text.slice(0, 8000));
    if (hit) return '命中风控文案「' + hit[1] + '」';
    if (status === 403 || status === 405 || status === 429 || status === 451) return 'HTTP ' + status + '（服务端限流 / 拒绝）';
    var anchors = 0;
    try { anchors = doc.querySelectorAll('a[href]').length; } catch (e) { anchors = 0; }
    if (text.length < 200 && anchors < 3) return '返回内容近乎为空（' + text.length + ' 字 / ' + anchors + ' 个链接）';
    return '';
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function browserHeaders(referer) {
    var h = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    };
    if (referer) h.Referer = referer;
    return h;
  }

  /* 先 GET 一次搜索引擎首页，让站点下发会话 Cookie（搜狗在没有 Cookie 时几乎必出验证页）。
     同一 origin 10 分钟内只预热一次。 */
  var WARM_TTL = 10 * 60 * 1000;
  var warmed = {};
  function warmHost(rule) {
    return new Promise(function (resolve) {
      if (!HAS_GM || !rule) return resolve(false);
      var origin = '';
      try { origin = new URL(rule.home).origin; } catch (e) { return resolve(false); }
      if (warmed[origin] && Date.now() - warmed[origin] < WARM_TTL) return resolve(true);
      warmed[origin] = Date.now();
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      try {
        GM_xmlhttpRequest({
          method: 'GET', url: rule.home, timeout: 8000, headers: browserHeaders(''),
          onload: function (r) { log('站点预热', origin, 'HTTP', r.status); fin(r.status < 400); },
          onerror: function () { fin(false); }, ontimeout: function () { fin(false); },
          onabort: function () { fin(false); }
        });
      } catch (e) { fin(false); }
    });
  }

  /* responseType 为 arraybuffer 时按 meta charset 解码：老站（gb2312 / gbk）不乱码 */
  function decodeBody(res) {
    var buf = res && res.response;
    if (!buf || typeof Uint8Array !== 'function') return (res && res.responseText) || '';
    var bytes = (buf instanceof ArrayBuffer) ? new Uint8Array(buf) : buf;
    try {
      var head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096));
      var m = /charset\s*=\s*["']?([a-zA-Z0-9\-_]+)/i.exec(head);
      var cs = m ? m[1].toLowerCase() : '';
      if (/^(gb2312|gbk|gb18030)$/.test(cs)) {
        try { return new TextDecoder('gbk').decode(bytes); } catch (e) { /* 不支持 gbk 就退回 utf-8 */ }
      }
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return (res && res.responseText) || ''; }
  }

  function blockHint(baseUrl) {
    return engineHint(baseUrl) + '已触发风控：先把搜索接口换成「必应」或「360」重试；' +
           '或自己在浏览器里打开该搜索结果页 → Ctrl+U 查看源码 → 全选复制，粘贴到第 2 页「粘贴搜索结果页源码解析」框，' +
           '离线解析不经过网络，完全不受风控影响。';
  }

  /* 粘贴源码离线解析：脚本在线时走这里；页面不装脚本时页面自己解析（同一套选择器） */
  function parsePasted(req) {
    var html = String(req.html || '');
    var base = (req.url && /^https?:\/\//i.test(req.url)) ? req.url : location.href;
    function err(msg, code) {
      emit({ type: 'AC_ERR', id: req.id, word: req.word || '', source: base,
             error: msg, blocked: false, code: code || 'PARSE', hint: '', status: '', htmlLen: html.length, ms: 0 });
    }
    if (html.replace(/\s/g, '').length < 80) return err('粘贴的内容太短：请复制整个网页源码（在结果页按 Ctrl+U 后 Ctrl+A 全选复制）', 'EMPTY');
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); }
    catch (e) { return err('HTML 解析失败：' + e.message); }
    var r;
    try { r = extractPage(doc, base, filterPreset(req.filter)); }
    catch (e) { return err('解析失败：' + e.message); }
    var m = {
      type: 'AC_RESULT', id: req.id, word: req.word || '', source: base,
      items: r.items, total: r.scanned, via: 'paste:' + r.via, page: r.page, links: r.links,
      status: 200, htmlLen: html.length, ms: 0
    };
    if (!r.items.length) {
      m.note = '粘贴的源码里正文根区域（' + r.page.root + '）共扫到 ' + r.scanned +
               ' 个链接，无一符合当前过滤条件：请切「宽松」过滤后重新解析';
    }
    log('粘贴源码解析完成 | 正文根', r.page.root, '| 命中', r.items.length, '/', r.scanned, '| via', r.via);
    emit(m);
  }

  function collect(req) {
    var started = Date.now();
    var rule = engineRule(req.url);
    var htmlLen = 0, lastStatus = '';

    function fail(msg, extra) {
      extra = extra || {};
      var m = {
        type: 'AC_ERR', id: req.id, word: req.word || '', source: req.url || '',
        error: String(msg == null ? '未知错误' : msg),
        blocked: !!extra.blocked, code: extra.code || 'FETCH',
        hint: extra.hint || '', status: (typeof extra.status === 'number' ? extra.status : ''),
        htmlLen: (typeof extra.htmlLen === 'number' ? extra.htmlLen : htmlLen),
        engine: engineHint(req.url), ms: Date.now() - started
      };
      warn('抓取失败', m.code, '|', m.error, '| 耗时', m.ms + 'ms');
      emit(m);
    }

    if (!req.url || !/^https?:\/\//i.test(req.url)) return fail('地址无效，请以 http:// 或 https:// 开头', { code: 'BADURL' });
    if (!HAS_GM) return fail('当前浏览器未授予 GM_xmlhttpRequest 权限，请检查脚本 @grant 是否生效（改过 @grant 必须重新安装脚本）', { code: 'NOGM' });

    function attempt(left) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: req.url,
        timeout: 20000,
        headers: browserHeaders(rule ? rule.home : new URL(req.url).origin + '/'),
        responseType: 'arraybuffer',
        onload: function (res) {
          lastStatus = res.status;
          var html = '';
          try { html = decodeBody(res); } catch (e) { html = (res && res.responseText) || ''; }
          htmlLen = html.length;

          if (res.status >= 400) {
            if (left > 0) {
              var back = rand(1500, 3500);
              log('HTTP ' + res.status + '，' + back + 'ms 后随机退避重试（剩 ' + left + ' 次）');
              return sleep(back).then(function () { attempt(left - 1); });
            }
            return fail('目标站返回 HTTP ' + res.status + '，可能被反爬拦截', { status: res.status, code: 'HTTP' });
          }

          var doc;
          try { doc = new DOMParser().parseFromString(html || '', 'text/html'); }
          catch (err) { return fail('页面解析失败：' + err.message, { code: 'PARSE', status: res.status }); }

          var why = looksBlocked(doc, res.status);
          if (why) {
            /* 命中验证页不再重试：越硬试越容易被封 IP，直接把可操作建议回传给页面 */
            return fail(engineHint(req.url) + '触发风控：' + why, {
              blocked: true, code: 'BLOCKED', status: res.status, hint: blockHint(req.url)
            });
          }

          try {
            var r = extractPage(doc, req.url, filterPreset(req.filter));
            var m = {
              type: 'AC_RESULT', id: req.id, word: req.word || '', source: req.url,
              items: r.items, total: r.scanned, via: r.via, page: r.page, links: r.links,
              status: res.status, htmlLen: htmlLen, engine: engineHint(req.url),
              ms: Date.now() - started
            };
            if (!r.items.length) {
              m.note = '正文根区域（' + r.page.root + '）共扫到 ' + r.scanned +
                       ' 个链接，class 定位与 a[href] 遍历都无一符合当前过滤条件：请切「宽松」过滤，或换一个搜索接口';
            }
            log('抓取完成', req.word || req.url, '| HTTP', res.status, '| 源码', htmlLen, '字',
                '| 正文根', r.page.root, '| 命中', r.items.length, '/', r.scanned,
                '| via', r.via, '| 正文', r.page.textLen, '字 | 耗时', m.ms + 'ms');
            emit(m);
          } catch (err) { fail('页面解析失败：' + err.message, { code: 'PARSE', status: res.status }); }
        },
        onerror: function () {
          if (left > 0) {
            var back = rand(1500, 3500);
            log('网络错误 / 跨域被拒，' + back + 'ms 后重试（剩 ' + left + ' 次）');
            return sleep(back).then(function () { attempt(left - 1); });
          }
          fail('抓取失败（跨域被拒 / 需登录 / 反爬断连）', { code: 'NET', status: lastStatus });
        },
        ontimeout: function () {
          if (left > 0) return sleep(rand(1200, 2600)).then(function () { attempt(left - 1); });
          fail('抓取超时（20s），目标站响应过慢', { code: 'TIMEOUT', status: lastStatus });
        },
        onabort: function () { fail('请求已中止', { code: 'ABORT' }); }
      });
    }

    /* 预热 → 随机小间隔 → 首次请求（失败自动退避重试 1 次） */
    warmHost(rule).then(function (ok) {
      return ok ? sleep(rand(300, 900)) : null;
    }).then(function () { attempt(1); });
  }

  /* ============================================================
     三、导出（参考脚本的 GM_setClipboard + GM_download 能力）
     页面把汇总好的结构化数据发过来，这里落 JSON 文件并复制剪贴板。
     ============================================================ */
  function exportJson(req) {
    var id = req && req.id;
    var data = req && req.data;
    if (!data) return emit({ type: 'AC_EXPORT_ERR', id: id, error: '没有收到要导出的数据' });
    var json;
    try { json = JSON.stringify(data, null, 2); }
    catch (e) { return emit({ type: 'AC_EXPORT_ERR', id: id, error: '序列化失败：' + e.message }); }

    var slug = String((data && data.slug) || ('collect_' + Date.now())).replace(/[^\w\-]+/g, '_').slice(0, 60);
    var name = slug + '.json';
    var how = [];
    try {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(json, 'text'); how.push('剪贴板'); }
    } catch (e) { warn('GM_setClipboard 失败：', e && e.message); }
    try {
      if (typeof GM_download === 'function' && typeof Blob === 'function') {
        var blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        GM_download({ url: blobUrl, name: name, saveAs: true, onerror: function (e) { warn('GM_download 失败：', e); } });
        how.push('JSON 文件');
      }
    } catch (e) { warn('GM_download 异常：', e && e.message); }

    log('导出完成', name, '|', json.length, '字 |', how.join(' + ') || '无可用导出通道');
    emit({ type: 'AC_EXPORT_OK', id: id, name: name, bytes: json.length, via: how.join(' + ') || 'none' });
  }
})();
