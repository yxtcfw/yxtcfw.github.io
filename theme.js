/* theme.js — 主站四页共用的暗色主题开关
 * 契约：data-theme 挂在 <html>，偏好存 localStorage.yx.theme；
 *      未设置时跟随系统；同域的标签页之间实时同步。
 * 本文件必须在 <head> 里同步加载，避免首屏闪白。
 */
(function () {
  'use strict';
  var KEY = 'yx.theme', doc = document, root = doc.documentElement;

  function systemTheme() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  }
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) { return null; }
  }
  function apply(t) {
    root.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    syncButtons();
  }
  function buttons() {
    return doc.querySelectorAll('#theme, #btn-theme, [data-theme-toggle]');
  }
  function syncButtons() {
    var dark = root.getAttribute('data-theme') === 'dark';
    Array.prototype.forEach.call(buttons(), function (b) {
      b.textContent = dark ? '☀' : '◐';
      b.title = dark ? '切到浅色' : '切到深色';
      if (b.setAttribute) b.setAttribute('aria-label', b.title);
    });
  }

  // 首屏立即定主题，不等 DOMContentLoaded
  apply(stored() || systemTheme());

  doc.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(buttons(), function (b) {
      if (b.__themeBound) return;
      b.__themeBound = true;
      b.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch (e) {}
        apply(next);
      });
    });
    syncButtons();

    // 跨标签页同步；同一 localStorage 也供同源子站点使用
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) apply(stored() || systemTheme());
    });
    // 用户没手动选过时，跟随系统切换
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (!stored()) apply(systemTheme()); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  });
})();
