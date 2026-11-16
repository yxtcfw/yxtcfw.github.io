// suggest-collector.mjs —— 多引擎搜索联想词采集器（Node18+ ESM）
// 运行： node suggest-collector.mjs
// 两个输入文件：seeds.txt（种子词）、mods.txt（修饰词）
// 只看某个引擎： ONLY=bilibili node suggest-collector.mjs
// 带原始响应预览： VERBOSE=true node suggest-collector.mjs
//
// ============================================================
// 引擎清单（2026-11-16 实测）
// ------------------------------------------------------------
// 启用（8）
//   baidu          suggestion.baidu.com/su       GBK ★坑
//   baidu_sugrec   www.baidu.com/sugrec          标准 JSON
//   bing           api.bing.com/qsonhs.aspx      JSONP 外壳特殊 ★坑
//   so360          sug.so.360.cn/suggest         标准 JSONP
//   qq             sor.html5.qq.com/api/getsug   GBK ★坑
//   taobao         suggest.taobao.com/sug        部分词返回空，正常
//   bilibili       api.bilibili.com/.../suggest  标准 JSON
//   douyin         www-hj.douyin.com/.../sug     标准 JSON
//
// 保留但停用（4）—— 接口代码留着，哪天通了改 enabled 即可
//   bing_as        cn.bing.com/AS/Suggestions    返回 204 空响应
//   bing_os        api.bing.com/osjson.aspx      返回 204 空响应
//   sm             sugs.m.sm.cn/web              被阿里反爬拦截（403）
//   zhihu          zhihu.com/api/v4/.../suggest  必须登录（403）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'collected');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const VERBOSE = process.env.VERBOSE === 'true';
const ONLY = (process.env.ONLY || '').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ---------- GBK 解码器 ---------- */
let gbkDecoder = null;
try {
  gbkDecoder = new TextDecoder('gbk');
} catch (e) {
  console.warn('⚠ 当前 Node 不支持 GBK，baidu / qq 会乱码。');
  console.warn('  解决：npm i iconv-lite 后替换 gbkDecoder。\n');
}

/* ---------- 清洗 ---------- */
const clean = arr => [...new Set((arr || [])
  .map(s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, '').trim())
  .filter(s => s && s.length >= 2 && s.length <= 40 && /[\u4e00-\u9fa5a-zA-Z]/.test(s)))];

/* ---------- 剥 JSONP 外壳 ----------
   不能用"第一个( 到最后一个)"：Bing 的响应是
   if(typeof cb=='function') cb({...})
   前面那个括号是 typeof 语句的。改成定位第一个 { 或 [
--------------------------------------------------------- */
function stripJsonp(raw) {
  const i = raw.search(/[{[]/);
  if (i < 0) throw new Error('未找到 JSON 起点: ' + raw.slice(0, 80));
  const close = raw[i] === '{' ? '}' : ']';
  const j = raw.lastIndexOf(close);
  if (j <= i) throw new Error('JSON 未闭合: ' + raw.slice(0, 80));
  return raw.slice(i, j + 1);
}

/* ============================================================
   解析器
   ============================================================ */

// 百度 suggestion：window.baidu.sug({q:"耳机",p:false,s:[...]});
// 伪 JSON（q 无引号），只能正则抠 s 数组
function P_baidu(raw) {
  const m = raw.match(/s\s*:\s*(\[[\s\S]*?\])/);
  if (!m) throw new Error('百度(建议接口)未匹配 s 数组');
  return clean(JSON.parse(m[1]));
}

// 百度 sugrec：{"q":"耳机","p":false,"g":[{"type":"sug","q":"耳机哪个牌子好"}]}
function P_baidu_sugrec(raw) {
  const j = JSON.parse(raw);
  if (!Array.isArray(j.g)) throw new Error('sugrec 结构异常，keys=' + Object.keys(j).join(','));
  return clean(j.g.map(x => x && x.q));
}

// Bing qsonhs：if(typeof cb=='function') cb({"AS":{"Results":[{"Suggests":[{"Txt":"..."}]}]}})
function P_bing(raw) {
  const j = JSON.parse(stripJsonp(raw));
  if (!j.AS) throw new Error('bing 结构异常，keys=' + Object.keys(j).join(','));
  const words = [];
  for (const r of (j.AS.Results || [])) for (const s of (r.Suggests || [])) if (s && s.Txt) words.push(s.Txt);
  return clean(words);
}

// Bing AS/Suggestions（停用）：<div class="b_...">词</div>
function P_bing_as(raw) {
  const m = raw.match(/<div[^>]*b_[^>]*>([^<]+)<\/div>/g) || [];
  return clean(m.map(x => x.replace(/<[^>]+>/g, '')));
}

// Bing osjson（停用）：["query",["词1","词2"]]
function P_bing_os(raw) {
  const j = JSON.parse(raw);
  return clean(Array.isArray(j) ? (j[1] || []) : []);
}

// 360：cb({"result":[{"face":"","word":"..."}]})
function P_so360(raw) {
  const j = JSON.parse(stripJsonp(raw));
  const res = j.result || j.data;
  if (!Array.isArray(res)) throw new Error('360 结构异常，keys=' + Object.keys(j).join(','));
  return clean(res.map(x => (typeof x === 'string' ? x : (x && x.word))));
}

// QQ/Sogou：window.sogou.sug(["",["词1","词2"],[...]],-1)
function P_qq(raw) {
  const m = raw.match(/sug\((\[[\s\S]*\])\s*,\s*-?\d+\s*\)\s*;?\s*$/);
  if (!m) throw new Error('QQ 外壳未匹配');
  const arr = JSON.parse(m[1]);
  if (!Array.isArray(arr) || arr.length < 2) throw new Error('QQ 结构异常');
  return clean(Array.isArray(arr[1]) ? arr[1] : []);
}

// sm/UC（停用）：(function(){...})({...}) 或 cb({...})
function P_sm(raw) {
  const m = raw.match(/\((\{[\s\S]*\})\)/);
  if (!m) throw new Error('sm 外壳未匹配');
  const j = JSON.parse(m[1]);
  const r = j.r || j.data || [];
  if (!Array.isArray(r)) throw new Error('sm 结构异常，keys=' + Object.keys(j).join(','));
  return clean(r.map(x => (typeof x === 'string' ? x : (x && (x.w || x.word || x.value)))));
}

// B站：{"data":{"result":{"tag":[{"value":"耳机推荐2026","term":"..."}]}}}
function P_bilibili(raw) {
  const j = JSON.parse(raw);
  if (j.code !== 0) throw new Error('bilibili code=' + j.code + ' ' + (j.message || ''));
  const tag = (((j.data || {}).result) || {}).tag;
  if (!Array.isArray(tag)) throw new Error('bilibili 结构异常');
  return clean(tag.map(x => (x && (x.value || x.term)) || ''));
}

// 抖音：{"sug_list":[{"content":"耳机无线蓝牙苹果专用"},...]}
function P_douyin(raw) {
  const j = JSON.parse(raw);
  if (!Array.isArray(j.sug_list)) throw new Error('douyin 结构异常，keys=' + Object.keys(j).join(','));
  return clean(j.sug_list.map(x => x && x.content));
}

// 知乎（停用）：{"data":[{"value":"...","name":"..."}]}
function P_zhihu(raw) {
  const j = JSON.parse(raw);
  if (j.error) throw new Error('zhihu: ' + (j.error.message || 'error'));
  if (!Array.isArray(j.data)) throw new Error('zhihu 结构异常');
  return clean(j.data.map(x => (x && (x.value || x.name)) || ''));
}

// 淘宝：cb({"result":[["耳机壳","100"]]})  某些词返回空数组，属正常
function P_taobao(raw) {
  const j = JSON.parse(stripJsonp(raw));
  const res = j.result;
  if (!Array.isArray(res)) throw new Error('淘宝结构异常，keys=' + Object.keys(j).join(','));
  return clean(res.map(x => (Array.isArray(x) ? x[0] : x)));
}

/* ============================================================
   站点定义
   enabled: false 的不会发请求，但代码完整保留
   ============================================================ */
const ENGINES = {
  baidu: {
    url: q => `https://suggestion.baidu.com/su?wd=${q}`,
    referer: 'https://www.baidu.com/',
    gbk: true,
    enabled: true,
  },
  baidu_sugrec: {
    url: q => `https://www.baidu.com/sugrec?pre=10&p=1&ie=utf-8&json=1&prod=pc&from=pc_web&imod=20&wd=${q}`,
    referer: 'https://www.baidu.com/',
    enabled: true,
  },
  bing: {
    url: q => `https://api.bing.com/qsonhs.aspx?q=${q}&type=cb&cb=mySugCallback`,
    referer: 'https://cn.bing.com/',
    enabled: true,
  },
  so360: {
    url: q => `https://sug.so.360.cn/suggest?encodein=utf-8&encodeout=utf-8&format=json&word=${q}&callback=mySugCallback`,
    referer: 'https://www.so.com/',
    enabled: true,
  },
  qq: {
    url: q => `https://sor.html5.qq.com/api/getsug?key=${q}`,
    referer: 'https://www.sogou.com/',
    gbk: true,
    enabled: true,
  },
  taobao: {
    url: q => `https://suggest.taobao.com/sug?code=utf-8&q=${q}&callback=mySugCallback`,
    referer: 'https://s.taobao.com/',
    enabled: true,
  },
  bilibili: {
    url: q => `https://api.bilibili.com/x/web-interface/suggest?highlight=0&term=${q}`,
    referer: 'https://search.bilibili.com/',
    enabled: true,
  },
  douyin: {
    url: q => `https://www-hj.douyin.com/aweme/v1/web/search/sug/?aid=638&keyword=${q}`,
    referer: 'https://www.douyin.com/',
    enabled: true,
  },

  /* ---- 以下 4 个保留但停用，原因见文件头 ---- */
  bing_as: {
    url: q => `https://cn.bing.com/AS/Suggestions?pt=page.home&qry=${q}&cvid=999999999`,
    referer: 'https://cn.bing.com/',
    enabled: false,
    note: '返回 204 空响应',
  },
  bing_os: {
    url: q => `https://api.bing.com/osjson.aspx?query=${q}`,
    referer: 'https://cn.bing.com/',
    enabled: false,
    note: '返回 204 空响应',
  },
  sm: {
    url: q => `https://sugs.m.sm.cn/web?t=w&scheme=https&fr=android&q=${q}&callback=jsonp_cb`,
    referer: 'https://m.sm.cn/',
    enabled: false,
    note: '被阿里反爬拦截（403 punishPage）',
  },
  zhihu: {
    url: q => `https://www.zhihu.com/api/v4/search/suggest?q=${q}`,
    referer: 'https://www.zhihu.com/',
    enabled: false,
    note: '必须登录（403 need_login）',
  },
};

const PARSERS = {
  baidu: P_baidu,
  baidu_sugrec: P_baidu_sugrec,
  bing: P_bing,
  so360: P_so360,
  qq: P_qq,
  taobao: P_taobao,
  bilibili: P_bilibili,
  douyin: P_douyin,
  bing_as: P_bing_as,
  bing_os: P_bing_os,
  sm: P_sm,
  zhihu: P_zhihu,
};

/* ---------- 种子词 ---------- */
function loadSeeds() {
  const p = path.join(__dirname, 'seeds.txt');
  if (!fs.existsSync(p)) throw new Error('找不到 seeds.txt：' + p);
  return fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .map(s => s.split('#')[0].trim()).filter(Boolean);
}
const SEEDS = loadSeeds();

/* ---------- 读取修饰词（外部 txt，~ 表示不加修饰） ---------- */
function loadMods() {
  const p = path.join(__dirname, 'mods.txt');
  const FALLBACK = ['', '怎么', '推荐', '如何', '避坑', '排行'];
  if (!fs.existsSync(p)) {
    console.warn('⚠ 没找到 mods.txt，用内置默认修饰词：' + FALLBACK.map(x => x || '（原词）').join(' / '));
    console.warn('  想自定义就在同目录建一个 mods.txt，一行一个词。\n');
    return FALLBACK;
  }
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .map(l => l.split('#')[0].trim())
    .filter(Boolean);
  // ~ 代表"不加修饰"，即直接用种子词本身
  const mods = lines.map(l => (l === '~' ? '' : l));
  if (!mods.length) {
    console.warn('⚠ mods.txt 是空的，回退到内置默认值\n');
    return FALLBACK;
  }
  // 去重但保留顺序（空字符串算有效项）
  return [...new Set(mods)];
}
const MODS = loadMods();

/* ---------- 解码 ---------- */
async function decodeBody(res, name) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (ENGINES[name]?.gbk && gbkDecoder) return gbkDecoder.decode(buf);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('gbk') || ct.includes('gb2312')) {
    if (!gbkDecoder) throw new Error('响应是 GBK，但当前 Node 无法解码');
    return gbkDecoder.decode(buf);
  }
  return buf.toString('utf8');
}

/* ---------- 单请求 ---------- */
async function fetchOne(name, query) {
  const cfg = ENGINES[name];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  if (cfg.referer) headers.Referer = cfg.referer;

  try {
    const res = await fetch(cfg.url(query), { headers, signal: ctrl.signal });
    const raw = await decodeBody(res, name);
    const meta = {
      status: res.status,
      ctype: res.headers.get('content-type'),
      len: raw.length,
      preview: raw.slice(0, 200).replace(/\s+/g, ' '),
    };
    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.retryable = res.status >= 500;
      e.meta = meta;
      throw e;
    }
    const parser = PARSERS[name];
    if (!parser) throw new Error('无解析器: ' + name);
    let words;
    try {
      words = parser(raw);
    } catch (pe) {
      const e = new Error('解析失败: ' + pe.message);
      e.meta = meta;
      throw e;
    }
    return { ok: true, words, meta, error: null };
  } catch (e) {
    return { ok: false, words: [], meta: e.meta || null, error: e.message, retryable: !!e.retryable };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 主流程 ---------- */
const queries = [];
for (const s of SEEDS) for (const m of MODS) queries.push((s + m).trim());

let active = Object.entries(ENGINES).filter(([, c]) => c.enabled !== false).map(([n]) => n);
if (ONLY) active = active.filter(n => n === ONLY);

if (!active.length) {
  console.error('没有可用的引擎。检查 ONLY 参数或 ENGINES 里的 enabled。');
  process.exit(1);
}

console.log(`种子词（${SEEDS.length}）：${SEEDS.join(' / ')}`);
console.log(`修饰词（${MODS.length}）：${MODS.map(m => m || '（原词）').join(' / ')}`);
console.log(`组合：${SEEDS.length} × ${MODS.length} = ${queries.length} 个`);
console.log(`启用引擎（${active.length}）：${active.join(', ')}`);
const skipped = Object.entries(ENGINES).filter(([, c]) => c.enabled === false);
if (skipped.length) {
  console.log(`停用引擎（${skipped.length}）：`);
  for (const [n, c] of skipped) console.log(`  - ${n}：${c.note || '已停用'}`);
}
console.log('');

const all = [];
for (const query of queries) {
  const q = encodeURIComponent(query);
  const rec = { query, ts: new Date().toISOString(), results: {} };
  for (const name of active) {
    let r = await fetchOne(name, q);
    if (!r.ok && r.retryable) { await sleep(1500); r = await fetchOne(name, q); }
    rec.results[name] = { ok: r.ok, words: r.words, error: r.error };

    const tag = !r.ok ? `✗ ${r.error}` : (r.words.length ? `${r.words.length}词` : '0词');
    process.stdout.write(`  [${query}] ${name}:${tag}  `);
    if (VERBOSE && r.meta) {
      console.log(`\n      ↳ ${r.meta.ctype} | ${r.meta.len}B | ${r.meta.preview.slice(0, 100)}`);
    }
    await sleep(200 + Math.random() * 300);
  }
  console.log('');
  all.push(rec);
}

/* ---------- 汇总 ---------- */
const freq = new Map();
let total = 0;
const failStat = {};
const perEngine = {};

for (const rec of all) {
  for (const name in rec.results) {
    const r = rec.results[name];
    perEngine[name] = perEngine[name] || { ok: 0, fail: 0, zero: 0, words: 0 };
    if (!r.ok) { failStat[name] = (failStat[name] || 0) + 1; perEngine[name].fail++; }
    else {
      perEngine[name].ok++;
      if (!r.words.length) perEngine[name].zero++;
    }
    for (const w of r.words) {
      freq.set(w, (freq.get(w) || 0) + 1);
      perEngine[name].words++;
      total++;
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const jsonPath = path.join(OUT_DIR, `suggest_${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(
  { total, freq: Object.fromEntries(freq), failStat, perEngine, records: all }, null, 2));

const csvPath = path.join(OUT_DIR, `suggest_words_${stamp}.csv`);
const rows = [['word', 'count', 'engines']];
// 统计每个词被几个引擎收回来（去重后仍按 >1 计）
const wordEngines = new Map();
for (const rec of all) for (const name in rec.results) {
  for (const w of rec.results[name].words) {
    if (!wordEngines.has(w)) wordEngines.set(w, new Set());
    wordEngines.get(w).add(name);
  }
}
[...freq.entries()].sort((a, b) => b[1] - a[1]).forEach(([w, c]) =>
  rows.push([`"${w.replace(/"/g, '""')}"`, c, wordEngines.get(w).size]));
fs.writeFileSync(csvPath, '\ufeff' + rows.map(r => r.join(',')).join('\n'));

console.log('===== 各引擎状态 =====');
for (const [n, s] of Object.entries(perEngine)) {
  const tries = s.ok + s.fail;
  const rate = ((s.ok / tries) * 100).toFixed(0);
  console.log(`  ${n.padEnd(14)} 成功 ${String(s.ok).padStart(3)}/${String(tries).padEnd(3)} (${rate.padStart(3)}%)  空响应 ${String(s.zero).padStart(2)}  收词 ${s.words}`);
}
if (Object.keys(failStat).length) console.log('\n失败明细：', failStat);

console.log('\n===== 高频词 TOP 20 =====');
[...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([w, c]) => console.log(`  ${String(c).padStart(3)}× [${wordEngines.get(w).size}引擎] ${w}`));

console.log(`\n合计 ${total} 条，去重 ${freq.size} 个`);
console.log('JSON →', jsonPath);
console.log('CSV  →', csvPath);
