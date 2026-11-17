// ==UserScript==

// @name         联想词数据管道 v3.4

// @namespace    https://github.com/

// @version      3.4

// @description  多平台搜索联想词采集，纯数据管道，通过 postMessage 与页面通信

// @author       You

// @match        *://localhost:4321/tools/chuangzuo/index.html

// @match        *://*.github.io/tools/chuangzuo/index.html

// @run-at       document-start

// @grant        GM_xmlhttpRequest

// @connect      suggestion.baidu.com

// @connect      www.baidu.com

// @connect      api.bing.com

// @connect      sug.so.360.cn

// @connect      sor.html5.qq.com

// @connect      suggest.taobao.com

// @connect      api.bilibili.com

// @connect      www-hj.douyin.com

// ==/UserScript==

(function () {

  'use strict';

  const MSG = 'SUG_FETCH';

  const TAG = '[联想词管道]';

  const log = (...a) => console.log(TAG, ...a);

  log('v3.4 已注入, 当前页面:', location.href);

  /* ==================== 握手 ==================== */

  window.addEventListener('message', (e) => {

    if (e.data && e.data.type === 'SUG_PING') {

      log('PONG');

    }

  });

  /* ==================== 清洗 ==================== */

  const clean = arr => [...new Set((arr || [])

    .map(s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, '').trim())

    .filter(s => s && s.length >= 2 && s.length <= 40 && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(s)))];

  /* ==================== JSONP 剥壳 ==================== */

  function stripJsonp(raw) {

    const i = raw.search(/[{[]/);

    if (i < 0) throw new Error('未找到 JSON 起点');

    const close = raw[i] === '{' ? '}' : ']';

    const j = raw.lastIndexOf(close);

    if (j <= i) throw new Error('JSON 未闭合');

    return raw.slice(i, j + 1);

  }

  /* ==================== 解析器 ==================== */

  const P = {

    baidu(raw) {

      const m = raw.match(/s\s*:\s*(\[[\s\S]*?\])/);

      if (!m) throw new Error('su 未匹配 s 数组');

      return clean(JSON.parse(m[1]));

    },

    baidu_sugrec(raw) {

      const j = JSON.parse(raw);

      if (!Array.isArray(j.g)) throw new Error('sugrec 结构异常');

      return clean(j.g.map(x => x && x.q));

    },

    bing(raw) {

      const j = JSON.parse(stripJsonp(raw));

      if (!j.AS) throw new Error('bing 结构异常');

      const w = [];

      for (const r of (j.AS.Results || []))

        for (const s of (r.Suggests || []))

          if (s && s.Txt) w.push(s.Txt);

      return clean(w);

    },

    so360(raw) {

      const j = JSON.parse(stripJsonp(raw));

      const res = j.result || j.data;

      if (!Array.isArray(res)) throw new Error('360 结构异常');

      return clean(res.map(x => typeof x === 'string' ? x : x && x.word));

    },

    qq(raw) {

      const m = raw.match(/sug\((\[[\s\S]*\])\s*,\s*-?\d+\s*\)\s*;?\s*$/);

      if (!m) throw new Error('QQ 外壳未匹配');

      const arr = JSON.parse(m[1]);

      if (!Array.isArray(arr) || arr.length < 2) throw new Error('QQ 结构异常');

      return clean(Array.isArray(arr[1]) ? arr[1] : []);

    },

    taobao(raw) {

      const j = JSON.parse(stripJsonp(raw));

      const res = j.result;

      if (!Array.isArray(res)) throw new Error('淘宝结构异常');

      return clean(res.map(x => Array.isArray(x) ? x[0] : x));

    },

    bilibili(raw) {

      const j = JSON.parse(raw);

      if (j.code !== 0) throw new Error('bilibili code=' + j.code);

      const tag = (((j.data || {}).result) || {}).tag;

      if (!Array.isArray(tag)) throw new Error('bilibili 结构异常');

      return clean(tag.map(x => x && (x.value || x.term) || ''));

    },

    douyin(raw) {

      const j = JSON.parse(raw);

      if (!Array.isArray(j.sug_list)) throw new Error('douyin 结构异常');

      return clean(j.sug_list.map(x => x && x.content));

    },

  };

  /* ==================== 站点定义 ==================== */

  const ENGINES = {

    baidu:        { url: q => `https://suggestion.baidu.com/su?wd=${q}`, referer: 'https://www.baidu.com/', gbk: true },

    baidu_sugrec: { url: q => `https://www.baidu.com/sugrec?pre=1&p=1&ie=utf-8&json=1&prod=pc&from=pc_web&imod=20&wd=${q}`, referer: 'https://www.baidu.com/' },

    bing:         { url: q => `https://api.bing.com/qsonhs.aspx?q=${q}&type=cb&cb=mySugCallback`, referer: 'https://cn.bing.com/' },

    so360:        { url: q => `https://sug.so.360.cn/suggest?encodein=utf-8&encodeout=utf-8&format=json&word=${q}&callback=mySugCallback`, referer: 'https://www.so.com/' },

    qq:           { url: q => `https://sor.html5.qq.com/api/getsug?key=${q}`, referer: 'https://www.sogou.com/', gbk: true },

    taobao:       { url: q => `https://suggest.taobao.com/sug?code=utf-8&q=${q}&callback=mySugCallback`, referer: 'https://s.taobao.com/' },

    bilibili:     { url: q => `https://api.bilibili.com/x/web-interface/suggest?highlight=0&term=${q}`, referer: 'https://search.bilibili.com/' },

    douyin:       { url: q => `https://www-hj.douyin.com/aweme/v1/web/search/sug/?aid=6383&keyword=${q}`, referer: 'https://www.douyin.com/' },

  };

  /* ==================== GM 请求 Promise 化 ==================== */

  function gmFetch(key, cfg, q) {

    return new Promise((resolve) => {

      GM_xmlhttpRequest({

        method: 'GET',

        url: cfg.url(q),

        headers: { Referer: cfg.referer || '' },

        responseType: cfg.gbk ? 'arraybuffer' : 'text',

        timeout: 8000,

        onload(res) {

          try {

            const raw = cfg.gbk

              ? new TextDecoder('gbk').decode(res.response)

              : res.responseText;

            resolve([key, P[key] ? P[key](raw) : []]);

          } catch (err) {

            log(key, '解析失败:', err.message);

            resolve([key, []]);

          }

        },

        onerror() { log(key, '请求失败'); resolve([key, []]); },

        ontimeout() { log(key, '超时'); resolve([key, []]); },

      });

    });

  }

  /* ==================== 笛卡尔积 ==================== */

  function cartesian(cores, mods) {

    if (!mods || mods.length === 0) return cores.map(c => [c]);

    const out = [];

    for (const c of cores) for (const m of mods) out.push([c, m]);

    return out;

  }

  /* ==================== 监听页面请求 ==================== */

  window.addEventListener('message', (e) => {

    const { type, id, cores, modifiers, engines } = e.data || {};

    if (type !== MSG) return;

    log('收到采集请求, id:', id, 'cores:', cores, 'engines:', engines);

    const jobs = Object.entries(ENGINES)

      .filter(([k]) => engines.includes(k))

      .map(([key, cfg]) => ({ key, cfg }));

    const combos = cartesian(

      (cores || []).filter(Boolean),

      (modifiers || []).filter(Boolean),

    );

    if (combos.length === 0) {

      window.postMessage({ type: MSG + '_OK', id, results: {}, combos: 0 }, '*');

      return;

    }

    const total = combos.length * jobs.length;

    let done = 0;

    const results = {};

    Promise.all(

      combos.flatMap(([c, m]) =>

        jobs.map(({ key, cfg }) =>

          gmFetch(key, cfg, m ? c + m : c).then(([k, words]) => {

            done++;

            window.postMessage({

              type: MSG + '_PROGRESS',

              id,

              progress: Math.round(done / total * 100),

            }, '*');

            if (!results[k]) results[k] = [];

            results[k].push(...words);

          })

        )

      )

    ).then(() => {

      for (const k of Object.keys(results)) results[k] = [...new Set(results[k])];

      log('采集完成, 共', Object.values(results).flat().length, '条结果');

      window.postMessage({ type: MSG + '_OK', id, results, combos: combos.length }, '*');

    });

  });

})();

