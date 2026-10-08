(function () {
  'use strict';

  var CFG = {
    defaultPlan: '3580',
    plans: {
      '18':   { group: 'free',    name: '免费会员', credits: '300',    blurb: '先试用各项 AI 助手',     cycle: null },
      '3580': { group: 'basic',   name: '普通会员', credits: '3,000',  blurb: '适合每周固定使用',       cycle: 'month' },
      '3582': { group: 'basic',   name: '普通会员', credits: '3,000',  blurb: '适合每周固定使用',       cycle: 'year' },
      '3583': { group: 'premium', name: '高级会员', credits: '10,000', blurb: '适合大量处理讲章与文件', cycle: 'month' },
      '3584': { group: 'premium', name: '高级会员', credits: '10,000', blurb: '适合大量处理讲章与文件', cycle: 'year' }
    }
  };

  var LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"></rect><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"></path></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function money(v) { return '$' + v.toFixed(2); }

  function enhance(form) {
    if (form.classList.contains('a4k-pms')) return;
    var radios = Array.prototype.slice.call(form.querySelectorAll('input[name="subscription_plans"]'));
    if (!radios.length) return;

    var isChange = form.id === 'pms-change-subscription-form';
    var plans = radios.map(function (r) {
      return {
        radio: r,
        meta: CFG.plans[r.value] || null,
        box: r.closest('.pms-subscription-plan'),
        label: r.closest('label'),
        price: parseFloat(r.getAttribute('data-price')) || 0
      };
    }).filter(function (p) { return p.box && p.label; });
    if (!plans.length) return;

    form.classList.add('a4k-pms');

    // 註冊頁帳號區：與方案區同樣的標題樣式，並標示這是兩個步驟
    var acct = form.querySelector('.pms-account-section-wrapper');
    if (acct) {
      var ah = el('div', 'a4k-head a4k-head-account');
      ah.appendChild(el('span', 'a4k-eyebrow', '第 1 步 · 帐号资料'));
      ah.appendChild(el('h2', 'a4k-title', '建立你的帐号'));
      ah.appendChild(el('p', 'a4k-sub', '带 * 为必填栏位'));
      acct.parentNode.insertBefore(ah, acct);

      Array.prototype.slice.call(acct.querySelectorAll('label')).forEach(function (l) {
        var t = l.textContent;
        if (/\*\s*$/.test(t)) {
          l.textContent = t.replace(/\s*\*\s*$/, '');
          var req = el('span', 'a4k-req', '*');
          req.setAttribute('aria-hidden', 'true');
          l.appendChild(req);
          var inp = l.getAttribute('for') && document.getElementById(l.getAttribute('for'));
          if (inp) inp.setAttribute('aria-required', 'true');
        }
      });

      var ac = { user_login: 'username', user_email: 'email', first_name: 'given-name', last_name: 'family-name', pass1: 'new-password', pass2: 'new-password' };
      Object.keys(ac).forEach(function (n) {
        var i = acct.querySelector('input[name="' + n + '"]');
        if (i && !i.getAttribute('autocomplete')) i.setAttribute('autocomplete', ac[n]);
      });
      var em = acct.querySelector('input[name="user_email"]');
      if (em) em.setAttribute('inputmode', 'email');
    }

    function counterpart(p, cycle) {
      if (!p.meta) return null;
      for (var i = 0; i < plans.length; i++) {
        var q = plans[i];
        if (q.meta && q.meta.group === p.meta.group && q.meta.cycle === cycle) return q;
      }
      return null;
    }
    function checked() {
      for (var i = 0; i < plans.length; i++) if (plans[i].radio.checked) return plans[i];
      return null;
    }
    function find(id) {
      for (var i = 0; i < plans.length; i++) if (plans[i].radio.value === id) return plans[i];
      return null;
    }
    function currentPrice(p) {
      var v = p.label.querySelector('.pms-subscription-plan-price-value');
      var n = v ? parseFloat(v.textContent.replace(/[^0-9.]/g, '')) : NaN;
      return isNaN(n) ? p.price : n;
    }

    // 方案卡片
    plans.forEach(function (p) {
      var m = p.meta;
      p.box.classList.add('a4k-plan');

      var ring = el('span', 'a4k-ring');
      ring.setAttribute('aria-hidden', 'true');
      p.radio.insertAdjacentElement('afterend', ring);

      var info = el('span', 'a4k-plan-info');
      var pmsName = p.label.querySelector('.pms-subscription-plan-name');
      info.appendChild(el('span', 'a4k-plan-name', m ? m.name : (pmsName ? pmsName.textContent : '')));
      if (m && m.blurb) info.appendChild(el('span', 'a4k-plan-blurb', m.blurb));
      ring.insertAdjacentElement('afterend', info);

      if (m) {
        var cr = el('span', 'a4k-plan-credits', '每月 ');
        cr.appendChild(el('span', 'a4k-plan-credits-value', m.credits));
        cr.appendChild(document.createTextNode(' 点额度'));
        info.insertAdjacentElement('afterend', cr);
      }

      var pw = el('span', 'a4k-plan-price');
      var priceSpan = p.label.querySelector('.pms-subscription-plan-price');
      if (priceSpan) {
        priceSpan.parentNode.insertBefore(pw, priceSpan);
        pw.appendChild(priceSpan);
      } else {
        p.label.appendChild(pw);
      }
      p.sub = el('span', 'a4k-plan-sub');
      pw.appendChild(p.sub);
    });

    var maxSave = 0;
    plans.forEach(function (p) {
      if (!p.meta || p.price === 0) { p.sub.textContent = p.price === 0 ? '不需付款' : ''; return; }
      if (p.meta.cycle === 'year') {
        var mo = counterpart(p, 'month');
        var t = '约每月 $' + (p.price / 12).toFixed(2);
        if (mo && mo.price > 0) {
          var s = Math.round((1 - p.price / (mo.price * 12)) * 100);
          if (s > 0) { t += '，省 ' + s + '%'; if (s > maxSave) maxSave = s; }
        }
        p.sub.textContent = t;
      } else if (p.meta.cycle === 'month') {
        p.sub.textContent = '按月计费';
      }
    });

    // PMS 依後台順序輸出（高级在前）；改為 免费 → 普通 → 高级。方案區只有一般 div，搬動是安全的。
    var RANK = { free: 0, basic: 1, premium: 2 };
    var parent = plans[0].box.parentNode;
    var anchor = plans[plans.length - 1].box.nextSibling;
    plans.slice().sort(function (a, b) {
      var ra = a.meta ? RANK[a.meta.group] : 9, rb = b.meta ? RANK[b.meta.group] : 9;
      return ra - rb;
    }).forEach(function (p) {
      if (p.box.parentNode === parent) parent.insertBefore(p.box, anchor);
    });
    var ordered = Array.prototype.slice.call(parent.querySelectorAll('.a4k-plan'));
    var first = ordered[0];
    var last = ordered[ordered.length - 1];

    // 標題
    var head = el('div', 'a4k-head');
    head.appendChild(el('span', 'a4k-eyebrow', isChange ? '更改会员方案' : (acct ? '第 2 步 · 选择方案' : '选择会员方案')));
    head.appendChild(el('h2', 'a4k-title', '选择适合你的方案'));
    var curEl = form.querySelector('.pms-upgrade__message strong');
    var subTxt = '注册后可随时在账户页更改方案';
    if (curEl) {
      var curName = curEl.textContent.trim();
      subTxt = '目前方案：' + curName;
      Object.keys(CFG.plans).forEach(function (k) {
        var cm = CFG.plans[k];
        if (curName.indexOf(cm.name) === 0 && subTxt.indexOf('额度') < 0) subTxt += ' · 每月 ' + cm.credits + ' 点额度';
      });
    }
    head.appendChild(el('p', 'a4k-sub', subTxt));
    first.parentNode.insertBefore(head, first);

    // 按月 / 按年
    var cycle = 'month';
    var btnMonth = null, btnYear = null;
    var hasYear = plans.some(function (p) { return p.meta && p.meta.cycle === 'year'; });
    var hasMonth = plans.some(function (p) { return p.meta && p.meta.cycle === 'month'; });
    if (hasYear && hasMonth) {
      var toggle = el('div', 'a4k-toggle');
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', '计费方式');
      btnMonth = el('button', null, '按月付');
      btnYear = el('button', null, '按年付');
      btnMonth.type = btnYear.type = 'button';
      if (maxSave > 0) btnYear.appendChild(el('span', 'a4k-save', '省 ' + maxSave + '%'));
      toggle.appendChild(btnMonth);
      toggle.appendChild(btnYear);
      first.parentNode.insertBefore(toggle, first);
      btnMonth.addEventListener('click', function () { setCycle('month', true); });
      btnYear.addEventListener('click', function () { setCycle('year', true); });
    }

    function setCycle(c, switchSelection) {
      cycle = c;
      plans.forEach(function (p) {
        var hide = !!(p.meta && p.meta.cycle && p.meta.cycle !== c);
        p.box.classList.toggle('a4k-hidden', hide);
      });
      if (btnMonth) {
        btnMonth.setAttribute('aria-pressed', c === 'month' ? 'true' : 'false');
        btnYear.setAttribute('aria-pressed', c === 'year' ? 'true' : 'false');
      }
      if (switchSelection) {
        var cur = checked();
        if (cur && cur.box.classList.contains('a4k-hidden')) {
          var cp = counterpart(cur, c);
          if (cp) cp.radio.click();
        }
      }
      refresh();
    }

    // 訂單摘要
    var sum = el('div', 'a4k-summary');
    sum.appendChild(el('span', 'a4k-summary-title', '订单摘要'));
    function row(label, cls) {
      var r = el('div', 'a4k-row' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', null, label));
      var v = el('span');
      r.appendChild(v);
      sum.appendChild(r);
      return v;
    }
    var vPlan = row('方案');
    var vCredits = row('每月额度');
    sum.appendChild(el('div', 'a4k-divider'));
    var vDue = row('今日应付', 'a4k-due');
    last.insertAdjacentElement('afterend', sum);

    // 自動續訂說明
    var renewBox = form.querySelector('input[name="pms_recurring"]');
    var renewNote = null;
    if (renewBox) {
      var rl = renewBox.closest('label');
      if (rl) {
        Array.prototype.slice.call(rl.childNodes).forEach(function (n) {
          if (n.nodeType === 3 && n.textContent.trim()) n.parentNode.removeChild(n);
        });
        var rt = el('span', 'a4k-renew-text');
        rt.appendChild(el('strong', null, '自动续订'));
        renewNote = el('span', 'a4k-renew-note');
        rt.appendChild(renewNote);
        rl.appendChild(rt);
      }
    }

    // 優惠碼收合
    var disc = form.querySelector('#pms-subscription-plans-discount');
    if (disc) {
      var code = disc.querySelector('input[name="discount_code"]');
      var msgs = form.querySelector('#pms-subscription-plans-discount-messages');
      var hasMsg = msgs && msgs.textContent.trim();
      if (!(code && code.value) && !hasMsg) {
        disc.classList.add('a4k-hidden');
        var link = el('button', 'a4k-link', '有优惠码？');
        link.type = 'button';
        link.addEventListener('click', function () {
          disc.classList.remove('a4k-hidden');
          link.parentNode.removeChild(link);
          if (code) code.focus();
        });
        disc.parentNode.insertBefore(link, disc);
      }
    }

    // 付款區標題
    var payHead = form.querySelector('#pms-stripe-connect .pms-field-type-heading h3');
    if (payHead) payHead.textContent = '付款方式';

    // 代理送出按鈕：原按鈕保留（名稱與值不變），只是隱藏
    var orig = form.querySelector('input[name="pms_register"], input[name="pms_change_subscription"]');
    var cta = null;
    if (orig) {
      cta = el('button', 'a4k-cta');
      cta.type = 'button';
      orig.parentNode.insertBefore(cta, orig);
      orig.classList.add('a4k-orig-submit');
      cta.addEventListener('click', function () { if (!orig.disabled) orig.click(); });
      new MutationObserver(refresh).observe(orig, { attributes: true, attributeFilter: ['disabled', 'value'] });

      var trust = el('p', 'a4k-trust');
      trust.innerHTML = LOCK + '<span>付款由 Stripe 加密处理，本站不会储存你的卡号</span>';
      cta.insertAdjacentElement('afterend', trust);
    }

    // 額度說明
    var ex = el('div', 'a4k-explain');
    ex.appendChild(el('strong', null, '额度怎么算'));
    ex.appendChild(el('span', null, 'AI 助手对话、讲章与文件处理都会使用额度，1 点约等于 1,000 个 token。'));
    ex.appendChild(el('span', null, '额度每月 1 日重置，未用完的额度不会累积到下个月。'));
    ex.appendChild(el('span', null, '升级立即生效：本月已用的额度会从新方案的额度中扣除。'));
    form.appendChild(ex);

    function refresh() {
      plans.forEach(function (p) { p.box.classList.toggle('a4k-selected', p.radio.checked); });
      var p = checked();
      var price = p ? currentPrice(p) : 0;
      var m = p && p.meta;
      var billing = m && m.cycle ? (m.cycle === 'year' ? '按年付' : '按月付') : '';
      vPlan.textContent = p ? ((m ? m.name : '') + (billing ? ' · ' + billing : '')) : '—';
      vCredits.textContent = m ? m.credits + ' 点' : '—';
      vDue.textContent = money(price);

      if (renewNote) {
        var yearly = m && m.cycle === 'year';
        renewNote.textContent = renewBox.checked
          ? (yearly ? '每年自动扣款续订，可随时在账户页取消。' : '每月自动扣款续订，可随时在账户页取消。')
          : (yearly ? '一年后到期，不会自动扣款。' : '一个月后到期，不会自动扣款。');
      }

      if (cta) {
        if (orig.disabled) {
          cta.disabled = true;
          cta.textContent = orig.value;
        } else {
          cta.disabled = false;
          cta.textContent = price > 0 ? '确认付款 ' + money(price) : (isChange ? '确认更改' : '免费注册');
        }
      }
    }

    form.addEventListener('change', function (e) {
      var n = e.target && e.target.name;
      if (n === 'subscription_plans' || n === 'pms_recurring') setTimeout(refresh, 0);
    });

    // 優惠碼套用後 PMS 會改寫價格文字
    plans.forEach(function (p) {
      var ps = p.label.querySelector('.pms-subscription-plan-price');
      if (ps) new MutationObserver(refresh).observe(ps, { childList: true, characterData: true, subtree: true });
    });

    // 初始選擇：PMS 預設選的是年費 $108；沒有使用者選擇過（無錯誤訊息重新顯示）時改選普通会员月付
    var cur = checked();
    var hasErrors = !!form.querySelector('.pms_field-errors-wrapper, .pms-form-errors-wrapper, .pms_errors');
    var def = CFG.defaultPlan ? find(CFG.defaultPlan) : null;
    var useDefault = def && !hasErrors && (!cur || cur.radio.getAttribute('data-default-selected') === 'true') && cur !== def;
    var startCycle = useDefault ? def.meta.cycle : (cur && cur.meta && cur.meta.cycle) || 'month';
    setCycle(startCycle, false);

    if (useDefault) {
      var pick = function () { if (!def.radio.checked) def.radio.click(); refresh(); };
      if (document.readyState === 'complete') setTimeout(pick, 0);
      else window.addEventListener('load', pick);
    }
  }

  function init() {
    var forms = document.querySelectorAll('#pms_register-form, #pms-change-subscription-form');
    for (var i = 0; i < forms.length; i++) {
      try { enhance(forms[i]); } catch (e) { if (window.console) console.warn('[a4k-pms-design]', e); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
