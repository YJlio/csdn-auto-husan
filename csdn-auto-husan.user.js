// ==UserScript==
// @name         CSDN自动互三工具
// @namespace    yjlio.csdn.tool
// @version      3.5.0
// @description  点击按钮或按空格一键点赞+评论+收藏+关注，跨标签页共享60秒限速（最多3次），评论自动识别文章标题
// @author       YJlio
// @match        *://blog.csdn.net/*/article/details/*
// @match        *://*.blog.csdn.net/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* =====================
     基础配置
  ===================== */

  if (!/^\/[^/]+\/article\/details\/\d+\/?$/.test(location.pathname)) return;
  if (document.getElementById('yjlio_mhsj_button')) return;

  const CONFIG = {
    autoSubmitComment: true,   // true = 自动提交评论；false = 只填入，不提交
    autoLike: true,
    autoCollect: true,
    autoFollow: true,
    enableSpaceHotkey: true,  // true = 按空格执行一键互三
    minDelay: 500,
    maxDelay: 1200,
    collectWaitTimeout: 6000,  // 收藏弹窗最长等待时间 ms
    rateLimit: 3,              // 滑动窗口内最大执行次数
    rateWindow: 60000,         // 滑动窗口时长 ms（60秒）
  };

  /* =====================
     工具函数
  ===================== */


  const COMMENT_KEY = 'yjlio_husan_comment_v1:' + location.pathname.replace(/\/$/, '');

  function findCommentInput() {
    return Array.from(document.querySelectorAll(
      '#comment_content, #comment-box textarea, .comment-con textarea, textarea[placeholder*="评论"], #comment-box [contenteditable="true"]'
    )).find(isVisible) || null;
  }

  function commentIsVisible(text) {
    // shortcut: 仅确认当前页面已加载的评论，未显示的提交保持待核实，避免重发。
    return Array.from(document.querySelectorAll(
      '.comment-list-box .comment-list-item, .comment-list-box .comment-item, .comment-list-box .comment-content, .comment-list .comment-content'
    )).some(el => isVisible(el) && getText(el).includes(text));
  }

  function selected(el, words) {
    if (!el) return false;
    const targets = [el, el.closest('.is-like, .is-collection')].filter(Boolean);
    return targets.some(node => /(^|\s)(active|is-active|liked|collected)(\s|$)/.test(String(node.className || ''))
      || node.getAttribute('aria-pressed') === 'true'
      || words.some(word => getText(node).includes(word)));
  }

  async function confirmAction(testFn, name) {
    try { await waitFor(testFn); log(name + '：页面状态已确认'); return 'success'; }
    catch (e) { log(name + '：结果待核实（' + e.message + '）'); return 'unknown'; }
  }

  function findLike() {
    return Array.from(document.querySelectorAll('.is-like')).find(isVisible) || null;
  }

  function findCollect() {
    return Array.from(document.querySelectorAll('.is-collection')).find(isVisible) || null;
  }

  function findFollow() {
    const scopes = document.querySelectorAll('.profile-intro, .blogger-info, .user-info, .profile-box, .article-info-box, #asideProfile');
    for (const scope of scopes) {
      const found = findByText('button,a,.tool-bt-button,.follow-btn', ['关注', '+关注', '+ 关注', '已关注', '取消关注'], scope);
      if (found) return found;
    }
    return findByText('.tool-bt-button,.follow-btn', ['关注', '+关注', '+ 关注', '已关注', '取消关注']);
  }

  function randomDelay() {
    return CONFIG.minDelay + Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function log(msg) {
    console.log('[CSDN互三工具] ' + msg);
  }

  function getText(el) {
    return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0
      && s.display !== 'none'
      && s.visibility !== 'hidden'
      && s.opacity !== '0';
  }

  function safeClick(el, name) {
    if (!el || !el.isConnected || !isVisible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') {
      log(name + ' 失败：元素不可用'); return false;
    }
    try { el.click(); log(name + ' 已点击，等待确认'); return true; }
    catch (e) { log(name + ' 点击异常：' + e.message); return false; }
  }

  /**
   * 统一等待函数：DOM 观察 + 低频补查，异常与超时统一清理
   */
  function waitFor(testFn, timeout = CONFIG.collectWaitTimeout) {
    return new Promise((resolve, reject) => {
      let observer, timer, poll, settled = false;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearTimeout(timer);
        clearInterval(poll);
        if (error) reject(error); else resolve(value);
      }
      function check() {
        if (settled) return;
        try { const found = testFn(); if (found) finish(null, found); }
        catch (e) { finish(e); }
      }
      check();
      if (settled) return;
      try {
        observer = new MutationObserver(check);
        observer.observe(document.body || document.documentElement,
          { childList: true, subtree: true, attributes: true, characterData: true });
        poll = setInterval(check, 250);
        timer = setTimeout(() => finish(new Error('等待页面确认超时')), timeout);
        check();
      } catch (e) { finish(e); }
    });
  }

  /* =====================
     状态提示（可见 Toast）
  ===================== */

  function showToast(msg, color = '#222') {
    const old = document.getElementById('yjlio_mhsj_toast');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'yjlio_mhsj_toast';
    el.textContent = msg;
    el.style.cssText =
      'position:fixed;right:20px;bottom:164px;z-index:1000000;' +
      'padding:8px 14px;border-radius:10px;font-size:12px;line-height:1.5;' +
      'color:#fff;background:' + color + ';' +
      'box-shadow:0 6px 20px rgba(0,0,0,.2);pointer-events:none;' +
      'transition:opacity .3s;';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 350); }, 5000);
  }

  /* =====================
     评论内容库
  ===================== */

  const COMMENT_BODIES = [
    '文章思路很清楚，步骤说明也比较完整，收藏起来后面慢慢学习。',
    '感谢博主分享，内容比较实用，对实际操作有参考价值。',
    '这篇文章整理得不错，很多细节讲得比较到位。',
    '认真看了一遍，文章结构清晰，阅读起来很顺畅。',
    '内容很干货，尤其是操作步骤部分，对我很有帮助。',
    '感谢整理，这类经验文章对实际工作很有参考意义。',
    '文章写得很用心，关键点总结得比较清楚。',
    '学习了，里面有些细节确实平时容易忽略。',
    '这篇内容适合收藏，后面遇到类似问题可以参考。',
    '文章讲解比较细，整体逻辑也比较顺。',
    '感谢博主分享经验，文章中的方法很有借鉴意义。',
    '内容比较完整，从现象到处理思路都有覆盖。',
    '这篇文章对新手比较友好，步骤说明很清楚。',
    '看完之后收获不少，尤其是排查思路部分值得学习。',
    '文章内容很实用，已经收藏备用。',
    '博主总结得很细，很多地方可以直接参考。',
    '这类实战经验很有价值，感谢分享。',
    '文章整体很清晰，读起来不费劲。',
    '内容有条理，关键步骤也说得比较明白。',
    '感谢分享，文章里的思路对我有启发。',
    '这篇文章写得挺扎实，适合反复看。',
    '步骤部分很清楚，实际操作时比较容易跟上。',
    '文章总结得不错，学习到了新的处理思路。',
    '感谢博主整理，内容对实际场景有帮助。',
    '这篇内容比较接地气，不只是简单罗列步骤。',
    '文章结构安排合理，重点也比较突出。',
    '看完感觉很有收获，感谢分享。',
    '内容讲得比较细，适合收藏备用。',
    '文章中的经验总结挺实用的。',
    '感谢分享，这篇文章对理解相关问题有帮助。',
    '整体阅读体验不错，逻辑比较清晰。',
    '这篇文章把问题讲得比较明白，值得学习。',
    '文章内容比较实在，没有太多废话。',
    '博主的思路很清晰，步骤也比较完整。',
    '学习了，文章里的处理方法有参考价值。',
    '感谢分享，已经收藏，后面慢慢研究。',
    '内容比较适合实操，细节说明很有用。',
    '文章写得很认真，能看出有实际经验。',
    '这篇文章对我理解这个问题有帮助。',
    '整体内容很清楚，感谢博主分享。',
    '文章中的步骤说明很详细，适合跟着操作。',
    '这个思路不错，后面遇到类似情况可以参考。',
    '内容整理得很系统，学习了。',
    '感谢博主分享，文章对实际排查很有帮助。',
    '讲解方式比较清楚，读完能抓住重点。',
    '这篇文章很适合做知识沉淀，收藏了。',
    '内容实用性比较强，对工作有参考意义。',
    '文章总结得很到位，尤其是注意事项部分。',
    '看完之后对这个问题有了更清楚的认识。',
    '感谢分享，文章整体质量不错。',
  ];

  const _usedBodies = new Set();

  function pickRandomBody() {
    if (_usedBodies.size >= COMMENT_BODIES.length) _usedBodies.clear();
    const available = COMMENT_BODIES.filter(c => !_usedBodies.has(c));
    const picked = available[Math.floor(Math.random() * available.length)]
      ?? '感谢分享，文章写得很用心。';
    _usedBodies.add(picked);
    return picked;
  }

  /* =====================
     跨标签页限速：localStorage
     同源标签页共享同一个 key；主流程持有 Web Lock 时读写
  ===================== */

  const RATE_KEY = 'yjlio_hushui_exec_times';

  /** 从 localStorage 读取执行时间列表，自动过滤超过窗口期的记录 */
  function readExecTimes() {
    const raw = localStorage.getItem(RATE_KEY);
    const all = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all) || all.some(t => !Number.isFinite(t) || t < 0)) {
      throw new Error('限速记录损坏，已阻止执行');
    }
    const now = Date.now();
    if (all.some(t => t > now)) throw new Error('系统时间回退，等待时间恢复后重试');
    return all.filter(t => now - t < CONFIG.rateWindow).sort((a, b) => a - b);
  }

  /** 将执行时间列表写入 localStorage */
  function writeExecTimes(times) {
    localStorage.setItem(RATE_KEY, JSON.stringify(times));
  }

  /**
   * 限速检测（跨标签页）
   * - 每次执行前读取 localStorage，判断 60s 内是否已达 3 次
   * - 若已达上限：倒计时等待，按钮实时显示剩余秒数，等待结束后循环重检
   * - 通过后：写入本次时间戳，退出函数，继续执行
   */
  async function waitIfRateLimited() {
    while (true) {
      const times = readExecTimes();

      if (times.length < CONFIG.rateLimit) {
        // 未达上限：登记本次时间戳后直接放行
        times.push(Date.now());
        writeExecTimes(times);
        log(`限速检查通过，当前窗口已执行 ${times.length} 次`);
        return;
      }

      // 已达上限：等到最早那条记录满 60s
      const endAt = times[0] + CONFIG.rateWindow;
      log(`跨标签页 60s 内已执行 ${times.length} 次，触发限速，等待至 ${new Date(endAt).toLocaleTimeString()}`);

      while (Date.now() < endAt) {
        const remain = Math.ceil((endAt - Date.now()) / 1000);
        showToast(`⏳ 评论限速（跨标签页），${remain}s 后继续`, '#e67e22');
        btn.textContent = `等待 ${remain}s`;
        await sleep(1000);
      }

      // 等待结束后重新循环检测（其他标签页在等待期间可能也写入了新记录）
      log('限速等待结束，重新检测...');
    }
  }

  /* =====================
     识别文章标题
  ===================== */

  function getArticleTitle() {
    const selectors = [
      '.title-article',
      'h1.title-article',
      '.article-title-box h1',
      'h1',
    ];

    let title = '';

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { title = getText(el); if (title) break; }
    }

    if (!title) {
      title = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
        || document.querySelector('meta[name="title"]')?.getAttribute('content')
        || document.title
        || '';
    }

    title = title
      .replace(/[-_]CSDN博客.*|[-_]博客.*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (title.length > 42) title = title.substring(0, 42) + '...';

    return title || '这篇文章';
  }

  /* =====================
     构造评论
  ===================== */

  function buildComment() {
    const title = getArticleTitle();
    const body = pickRandomBody();
    return `我是杨利杰：认真阅读了《${title}》这篇文章，${body}`;
  }

  /* =====================
     设置输入框内容（兼容 React / Vue 受控组件）
  ===================== */

  function setNativeValue(el, value) {
    if (!el) return false;
    el.focus();

    const tag = el.tagName.toLowerCase();

    if (tag === 'textarea' || tag === 'input') {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(el, value);
      else el.value = value;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (el.isContentEditable) {
      el.innerText = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      return true;
    }

    return false;
  }

  /* =====================
     查找元素辅助
  ===================== */

  function findByText(candidates, texts, scope = document) {
    return Array.from(scope.querySelectorAll(candidates)).find(el =>
      isVisible(el) && !el.disabled && texts.includes(getText(el)));
  }

  /* =====================
     评论动作
  ===================== */

  async function doComment() {
    const raw = localStorage.getItem(COMMENT_KEY);
    const record = raw ? JSON.parse(raw) : null;
    if (record) {
      if (!record.text || !['pending', 'confirmed'].includes(record.status)) {
        throw new Error('文章评论记录损坏，已阻止再次评论');
      }
      if (record.status === 'confirmed' || commentIsVisible(record.text)) {
        localStorage.setItem(COMMENT_KEY, JSON.stringify({ ...record, status: 'confirmed' }));
        log('本文章已提交过评论，跳过'); return 'already';
      }
      log('本文章曾提交评论但结果待核实，已阻止重复提交'); return 'unknown';
    }
    const entrance = document.querySelector('.tool-item-comment');
    if (entrance) safeClick(entrance, '打开评论区');
    let input;
    try { input = await waitFor(findCommentInput); }
    catch (e) { log('评论失败：' + e.message); return 'failed'; }
    const current = input.isContentEditable ? getText(input) : String(input.value || '').trim();
    if (current) { log('评论框已有内容，保留原文并跳过'); return 'skipped'; }
    const commentText = buildComment();
    if (!setNativeValue(input, commentText)) return 'failed';
    if (!CONFIG.autoSubmitComment) return 'filled';
    await sleep(randomDelay());
    const area = input.closest('#comment-box, .comment-con, .comment-edit-box') || input.parentElement;
    const submit = area?.querySelector('.btn-comment-input')
      || findByText('button,input[type="submit"]', ['发布评论', '提交', '发表评论'], area || document);
    if (!submit || !isVisible(submit) || submit.disabled) return 'failed';
    if ((input.isContentEditable ? getText(input) : input.value) !== commentText) {
      log('评论内容发生变化，已取消提交'); return 'failed';
    }
    // 提交前持久化：刷新、断网或未知响应后不盲目重发。
    localStorage.setItem(COMMENT_KEY, JSON.stringify({ status: 'pending', text: commentText, time: Date.now() }));
    if (!safeClick(submit, '提交评论')) return 'unknown';
    const result = await confirmAction(() => commentIsVisible(commentText), '评论');
    if (result === 'success') {
      localStorage.setItem(COMMENT_KEY, JSON.stringify({ status: 'confirmed', text: commentText, time: Date.now() }));
    }
    return result;
  }

  /* =====================
     点赞动作
  ===================== */

  async function doLike() {
    if (!CONFIG.autoLike) return 'skipped';
    await sleep(randomDelay());
    const like = findLike();
    if (!like) return 'failed';
    if (selected(like, ['已赞', '已点赞', '取消点赞'])) return 'already';
    if (!safeClick(like, '点赞')) return 'failed';
    return confirmAction(() => selected(findLike(), ['已赞', '已点赞', '取消点赞']), '点赞');
  }

  /* =====================
     收藏动作
  ===================== */

  async function doCollect() {
    if (!CONFIG.autoCollect) return 'skipped';
    await sleep(randomDelay());
    const icon = findCollect();
    if (!icon) return 'failed';
    if (selected(icon, ['已收藏', '取消收藏'])) return 'already';
    if (!safeClick(icon.querySelector('a') || icon, '打开收藏入口')) return 'failed';
    try {
      const target = await waitFor(() => {
        if (selected(findCollect(), ['已收藏', '取消收藏'])) return { done: true };
        const dialogs = Array.from(document.querySelectorAll('.el-dialog, [role="dialog"], .collect-box, .collection-box')).filter(isVisible);
        for (const dialog of dialogs) {
          if (!getText(dialog).includes('收藏')) continue;
          const button = findByText('button,a,.collect-btn,.el-button', ['收藏', '确定', '确认', '确认收藏', '完成'], dialog);
          if (button) return { button };
        }
        return null;
      });
      if (target.done) return 'success';
      if (!safeClick(target.button, '确认收藏')) return 'failed';
      return confirmAction(() => selected(findCollect(), ['已收藏', '取消收藏']), '收藏');
    } catch (e) { log('收藏结果待核实：' + e.message); return 'unknown'; }
  }

  /* =====================
     关注动作
  ===================== */

  async function doFollow() {
    if (!CONFIG.autoFollow) return 'skipped';
    await sleep(randomDelay());
    const follow = findFollow();
    if (!follow) return 'failed';
    if (['已关注', '取消关注'].includes(getText(follow))) return 'already';
    if (!safeClick(follow, '关注')) return 'failed';
    return confirmAction(() => ['已关注', '取消关注'].includes(getText(findFollow())), '关注');
  }

  /* =====================
     主逻辑
  ===================== */

  async function startAction() {
    if (btn.disabled) { showToast('任务正在执行，请勿重复触发', '#e67e22'); return; }
    btn.disabled = true;
    btn.style.background = '#999';
    try {
      if (!navigator.locks?.request) {
        throw new Error('浏览器不支持跨标签页锁，请使用新版 Chrome/Edge 的 HTTPS 页面');
      }
      await navigator.locks.request('yjlio_husan_action_v1', { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { showToast('另一个标签页正在执行，请稍后重试', '#e67e22'); return; }
        await waitIfRateLimited();
        btn.textContent = '执行中...';
        const results = [];
        const marks = { success: '✓', already: '已完成', filled: '已填入', skipped: '跳过', unknown: '待核实', failed: '失败' };
        for (const [name, action] of [['评论', doComment], ['点赞', doLike], ['收藏', doCollect], ['关注', doFollow]]) {
          showToast('正在' + name + '...', '#555');
          let result;
          try { result = await action(); }
          catch (e) { log(name + '异常：' + e.message); result = 'failed'; }
          results.push({ name, result });
        }
        const summary = results.map(({name, result}) => name + ':' + (marks[result] || '待核实')).join('  ');
        showToast(summary, results.every(r => ['success', 'already', 'skipped', 'filled'].includes(r.result)) ? '#27ae60' : '#e67e22');
        log(summary);
      });
    } catch (e) {
      log('执行已中止：' + e.message);
      showToast('执行已中止：' + e.message, '#c0392b');
    } finally {
      btn.textContent = '一键互三';
      btn.disabled = false;
      btn.style.background = '#e33e33';
    }
  }

  /* =====================
     悬浮按钮
  ===================== */

  const btn = document.createElement('button');
  btn.id = 'yjlio_mhsj_button';
  btn.textContent = '一键互三';
  btn.style.cssText =
    'position:fixed;right:20px;bottom:120px;z-index:99999;' +
    'width:90px;height:32px;background:#e33e33;color:#fff;' +
    'border:none;border-radius:4px;cursor:pointer;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.18);font-size:13px;';
  btn.title = '点击或按空格执行一键互三';
  btn.onclick = startAction;
  document.body.appendChild(btn);

  /* =====================
     空格键快捷执行
     - 输入或编辑文字时不触发
     - 长按空格时不重复触发
     - 执行过程中不重复启动
  ===================== */

  function isEditingText(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]'
    );
  }

  document.addEventListener('keydown', event => {
    if (!CONFIG.enableSpaceHotkey) return;
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    if (event.defaultPrevented || event.isComposing || isEditingText(event.target)) return;
    if (event.target instanceof Element && event.target.closest('button,a,[role="button"]')) return;

    // 空格已作为脚本快捷键使用，阻止页面继续向下滚动
    event.preventDefault();
    event.stopPropagation();
    startAction();
  }, true);

})();