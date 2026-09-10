const admin = /\/admin(?:\.html)?\/?$/.test(location.pathname),
  app = document.querySelector("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (s) =>
  new Date(s).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
let me = null,
  data = null,
  mode = "login",
  month = "",
  search = "",
  filter = "all",
  tab = "members",
  receipt = null,
  requestId = null,
  credentials = [];
const SESSION_KEY = "fruit-membership-session-v2";
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}
function accessToken() {
  try {
    const raw =
      sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return "";
    const saved = JSON.parse(raw);
    if (saved.expiresAt <= Date.now() / 1000) {
      clearSession();
      return "";
    }
    return saved.token;
  } catch {
    clearSession();
    return "";
  }
}
function apiURL(path) {
  const cfg = window.FRUIT_CONFIG || {};
  if (!cfg.apiBase) return "/api/" + path;
  const [route, query = ""] = path.split("?");
  const url = new URL(cfg.apiBase);
  url.search = new URLSearchParams(query).toString();
  url.searchParams.set("route", route);
  return url.href;
}
function requestHeaders(body) {
  const headers =
    body === undefined ? {} : { "Content-Type": "application/json" };
  const token = accessToken();
  if (token) headers.Authorization = "Bearer " + token;
  if (window.FRUIT_CONFIG?.publishableKey)
    headers.apikey = window.FRUIT_CONFIG.publishableKey;
  return headers;
}
async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let r, d;
  try {
    r = await fetch(apiURL(path), {
      signal: controller.signal,
      method: body === undefined ? "GET" : "POST",
      credentials: window.FRUIT_CONFIG?.apiBase ? "omit" : "same-origin",
      headers: requestHeaders(body),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    d = await r.json();
  } finally {
    clearTimeout(timeout);
  }
  if (!r.ok) {
    if (r.status === 401 && path !== "login" && path !== "activate")
      clearSession();
    const e = new Error(d.error || "操作失败");
    e.status = r.status;
    throw e;
  }
  if (d.token) {
    clearSession();
    const storage =
      d.role === "member" && body?.remember ? localStorage : sessionStorage;
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: d.token, expiresAt: d.expiresAt }),
    );
  }
  if (path === "logout") clearSession();
  return d;
}
async function exportMonth() {
  try {
    const r = await fetch(apiURL("admin/export?month=" + month), {
      credentials: window.FRUIT_CONFIG?.apiBase ? "omit" : "same-origin",
      headers: requestHeaders(),
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || "导出失败");
    }
    const u = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = u;
    a.download = "水果领取-" + month + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  } catch (e) {
    error(e);
  }
}

function error(e) {
  const el = document.querySelector("#error");
  if (el) {
    el.textContent = ["TimeoutError", "AbortError"].includes(e.name)
      ? "连接超时，请检查网络后重试。"
      : e.message;
    el.hidden = false;
  } else alert(e.message);
}
function input(id, label, type = "text", extra = "") {
  return `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${extra} required>`;
}
function passwordInput() {
  return input(
    "password",
    "密码（10 位以上，包含字母和数字）",
    "password",
    `minlength="10" maxlength="128" autocomplete="${mode === "login" ? "current-password" : "new-password"}"`,
  );
}
function authView(setup = false) {
  app.innerHTML = `<section class="card auth"><div class="eyebrow">${admin ? "管理工作台" : "会员水果福利"}</div><h1>${setup ? "初始化管理员" : mode === "activate" ? "激活会员账号" : admin ? "管理员登录" : "会员登录"}</h1><p class="small">${setup ? "仅首次部署需要初始化密钥。" : mode === "activate" ? "请使用管理员私下提供的激活码设置密码。" : "使用会员手机号和密码登录。"}</p><form id="auth">${setup ? input("token", "初始化密钥", "password", 'autocomplete="off"') + input("name", "管理员姓名") : ""}${input("phone", "手机号", "tel", 'pattern="1[3-9][0-9]{9}" maxlength="11" autocomplete="username" inputmode="numeric"')}${mode === "activate" ? input("code", "一次性激活码", "text", 'autocomplete="off" maxlength="32"') : ""}${passwordInput()}${setup || mode === "activate" ? input("repeat", "再次输入密码", "password", 'autocomplete="new-password"') : ""}${!admin ? '<label><input type="checkbox" id="remember" checked>在我的手机上保持登录 30 天</label>' : ""}<p id="error" class="error" role="alert" hidden></p><button class="primary" type="submit">${setup ? "创建管理员" : mode === "activate" ? "激活并登录" : "登录"}</button></form>${!admin ? `<button id="switch" style="width:100%;margin-top:12px">${mode === "login" ? "首次使用 / 重置后激活" : "已有密码，返回登录"}</button><p class="muted">忘记密码？请联系管理员核实身份后重新获取激活码。</p>` : '<p class="muted">仅授权管理员可访问领取数据。</p>'}</section>`;
  if (!admin)
    document.querySelector("#switch").onclick = () => {
      mode = mode === "login" ? "activate" : "login";
      authView();
    };
  document.querySelector("#auth").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    const originalLabel = b.textContent;
    b.textContent = "正在验证，请稍候…";
    document.querySelector("#error").hidden = true;
    try {
      const f = Object.fromEntries(new FormData(e.target));
      if ((setup || mode === "activate") && f.password !== f.repeat)
        throw new Error("两次密码不一致");
      f.remember = !!document.querySelector("#remember")?.checked;
      if (setup) {
        await api("setup", f);
        mode = "login";
        authView();
        return;
      }
      await api(mode === "activate" ? "activate" : "login", f);
      await boot();
    } catch (e) {
      error(e);
    } finally {
      b.disabled = false;
      b.textContent = originalLabel;
    }
  };
}
async function boot() {
  try {
    if (window.FRUIT_CONFIG?.apiBase && !accessToken()) {
      authView();
      if (admin) {
        const status = await api("status");
        if (!status.initialized && status.setupAvailable) authView(true);
      }
      return;
    }
    const results = await Promise.all([
      api("me"),
      admin ? api("admin/data" + (month ? "?month=" + month : "")) : null,
    ]);
    me = results[0];
    month = month || me.month;
    if (admin && me.user.role !== "admin") {
      app.innerHTML =
        '<section class="card auth"><h2>此账号没有管理权限</h2><p>请退出后使用管理员账号登录。</p><button id="logout">退出登录</button></section>';
      bindLogout();
      return;
    }
    if (admin) {
      data = results[1];
      adminView();
    } else if (me.user.role === "admin") {
      app.innerHTML =
        '<section class="card auth"><h2>当前为管理员账号</h2><p>管理员账号不能领取，请使用会员账号。</p><button id="logout">退出登录</button></section>';
      bindLogout();
    } else claimView();
  } catch (e) {
    if (e.status === 401) {
      const status = admin ? await api("status") : { initialized: true };
      if (admin && !status.initialized) {
        if (status.setupAvailable) {
          authView(true);
        } else
          app.innerHTML =
            '<section class="card auth"><h2>等待初始化</h2><p>请先配置服务器初始化密钥 SETUP_TOKEN。</p></section>';
      } else authView();
    } else {
      app.innerHTML =
        '<section class="card auth"><h2>暂时无法连接服务</h2><p id="error" class="error"></p><button id="retry">重试</button></section>';
      error(e);
      document.querySelector("#retry").onclick = boot;
    }
  }
}
function bindLogout() {
  document.querySelector("#logout").onclick = async () => {
    try {
      await api("logout", {});
      me = null;
      receipt = null;
      requestId = null;
      credentials = [];
      mode = "login";
      await boot();
    } catch (e) {
      error(e);
    }
  };
}
function claimView() {
  const n = me.count;
  const blocked = n >= 4 || me.weeklyBlocked;
  const claimLabel =
    n >= 4
      ? "本月额度已用完"
      : me.weeklyBlocked
        ? "未到下次领取时间"
        : "登记领取一份";
  app.innerHTML = `<div class="grid"><section class="card hero"><div class="eyebrow">FRESH MOMENTS / 每月会员福利</div><h1>把新鲜，<br>带回日常。</h1><p>每月四份时令水果，<br>为生活添一点自然的甜。</p><span class="fruit">🍐🍊</span></section><section class="card"><div class="row"><h2>${esc(me.user.name)}，你好</h2><button id="logout">退出</button></div><span class="muted phone">${esc(me.user.phone)}</span><div class="quota"><div><strong>${n}</strong><small> / 4 份已领取</small></div><span class="pill ${n >= 4 ? "full" : ""}">${me.month} · ${n >= 4 ? "已领满" : `剩余 ${4 - n} 份`}</span></div><div class="dots">${Array.from({ length: 4 }, (_, i) => `<i class="${i < n ? "used" : ""}"></i>`).join("")}</div>${receipt ? `<div class="receipt" role="status"><h2>领取登记成功 ✓</h2><b>${esc(me.user.name)} · 1 份</b><p>${date(receipt.at)}</p><span class="small">凭证编号：${esc(receipt.id)}</span><p class="muted">请向现场工作人员出示本次凭证。</p></div>` : ""}<p id="error" class="error" role="alert" hidden></p><button id="claim" class="primary" ${blocked ? "disabled" : ""}>${claimLabel}</button><p class="muted">每月最多 4 份，两次领取至少间隔 7 天（跨月也适用）。到店领取时提交。${me.weeklyBlocked ? `<br><strong>下次可领取：${date(me.nextEligibleAt)}</strong>` : ""}</p><div class="history"><h2>本月领取记录</h2>${me.records.map((r) => `<div><span>${date(r.at)}</span><span>${r.voided ? "已撤销" : "领取 1 份"}</span></div>`).join("") || '<p class="muted">本月尚无领取记录</p>'}</div></section></div>`;
  bindLogout();
  document.querySelector("#claim").onclick = async (e) => {
    if (
      !requestId &&
      !confirm("确认现在领取一份水果？提交后扣减一次本月额度。")
    )
      return;
    const button = e.target;
    button.disabled = true;
    button.textContent = "正在登记，请勿重复提交…";
    document.querySelector("#error").hidden = true;
    requestId = requestId || crypto.randomUUID();
    try {
      const result = await api("claim", { requestId });
      me = result;
      receipt = result.claim;
      requestId = null;
      claimView();
    } catch (e) {
      if (e.status && e.status < 500) requestId = null;
      error(
        new Error(
          e.status
            ? e.message
            : "网络响应较慢，暂未确认登记结果。请点击“重试确认领取结果”，不会重复扣次数。",
        ),
      );
      if (e.status === 401 || e.status === 409) await boot();
    } finally {
      button.disabled = me.count >= 4 || me.weeklyBlocked;
      button.textContent = requestId
        ? "重试确认领取结果"
        : me.count >= 4
          ? "本月额度已用完"
          : me.weeklyBlocked
            ? "未到下次领取时间"
            : "登记领取一份";
    }
  };
}
function tableView() {
  const users = data.members.filter(
    (m) =>
      (m.name.includes(search) || m.phone.includes(search)) &&
      (filter === "all" ||
        (filter === "full"
          ? m.count >= 4
          : filter === "inactive"
            ? !m.activated
            : m.count < 4)),
  );
  const headings =
    tab === "members"
      ? ["会员", "手机号", "本月已领", "状态", "账号操作"]
      : ["会员", "手机号", "领取时间", "状态", "操作"];
  const rows =
    tab === "members"
      ? users.map(
          (m) =>
            `<tr><td>${esc(m.name)}</td><td>${esc(m.phone)}</td><td>${m.count} / 4 份</td><td><span class="pill ${m.count >= 4 ? "full" : ""}">${!m.enabled ? "已停用" : !m.activated ? "待激活" : m.count >= 4 ? "已达上限" : "可领取"}</span></td><td><button data-reset="${m.id}">重置激活码</button> <button data-toggle="${m.id}">${m.enabled ? "停用" : "启用"}</button></td></tr>`,
        )
      : data.records
          .filter((r) => users.some((m) => m.id === r.member_id))
          .map(
            (r) =>
              `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${date(r.at)}</td><td>${r.voided ? "已撤销" : "有效"}</td><td>${r.voided ? "—" : `<button data-revoke="${r.id}">撤销</button>`}</td></tr>`,
          );
  return `<div class="tablewrap"><table><thead><tr>${headings.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>${rows.length ? "" : '<div class="empty">暂无符合条件的数据</div>'}</div>`;
}
function adminView() {
  app.innerHTML = `<div class="row"><div><div class="eyebrow">MEMBER BENEFITS / 管理工作台</div><h1>水果领取概览</h1><p>${esc(me.user.name)} · 管理员</p></div><div class="topactions"><button id="entry">复制领取链接</button><button id="qr">下载领取二维码</button><button id="export">导出本月 CSV ↓</button><button id="logout">退出</button></div></div><div class="stats">${[
    ["会员总数", data.members.length],
    ["本月领取份数", data.records.filter((r) => !r.voided).length],
    ["已领取会员", data.members.filter((m) => m.count > 0).length],
    ["已达上限", data.members.filter((m) => m.count >= 4).length],
  ]
    .map(
      ([l, n]) =>
        `<div class="card stat"><span>${l}</span><strong>${n}</strong></div>`,
    )
    .join(
      "",
    )}</div><section class="card"><details id="importDetails"><summary>＋ 添加 / 批量导入会员</summary><p class="small">每行“姓名,手机号”，最多 500 人；也可上传包含“姓名,手机号”表头的 CSV 文件。已有手机号会跳过。激活码有效期为 7 天，请私下发给对应会员。</p><label for="csvFile">上传 CSV 文件</label><input type="file" id="csvFile" accept=".csv,text/csv"><label for="imports">会员名单</label><textarea id="imports" placeholder="张三,13800138000&#10;李四,13900139000"></textarea><button id="import">导入并生成激活码</button></details><div id="codes"></div><p id="error" class="error" role="alert" hidden></p><div class="row"><div class="tabs"><button data-tab="members" class="${tab === "members" ? "active" : ""}">会员领取情况</button><button data-tab="records" class="${tab === "records" ? "active" : ""}">领取明细</button></div><input id="month" type="month" value="${month}" aria-label="统计月份" style="width:170px"></div><div class="toolbar"><input id="search" placeholder="搜索姓名或手机号" value="${esc(search)}"><select id="filter"><option value="all">全部会员</option><option value="full">已达上限</option><option value="available">仍有额度</option><option value="inactive">待激活</option></select><button id="refresh">刷新数据</button><button id="cleanup">清理历史月份</button></div><div id="results">${tableView()}</div><p class="muted">领取次数由服务端校验。撤销记录保留在导出文件中，统计时只计算有效记录。</p></section>`;
  bindLogout();
  document.querySelector("#filter").value = filter;
  document.querySelector("#filter").onchange = (e) => {
    filter = e.target.value;
    renderTable();
  };
  document.querySelector("#search").oninput = (e) => {
    search = e.target.value;
    renderTable();
  };
  document.querySelector("#month").onchange = (e) => {
    if (e.target.value) {
      month = e.target.value;
      boot();
    }
  };
  document.querySelector("#refresh").onclick = boot;
  document.querySelector("#cleanup").onclick = async () => {
    if (month >= me.month) {
      error(new Error("只能清理已经结束的月份"));
      return;
    }
    const typed = prompt(
      "此操作永久删除 " +
        month +
        " 的领取明细。请先导出本月 CSV 并确认本地文件可打开；确认已备份后输入月份 " +
        month +
        "：",
    );
    if (typed === null) return;
    try {
      const r = await api("admin/cleanup", { month, confirm: typed });
      await boot();
      alert("已清理 " + r.deleted + " 条历史记录");
    } catch (e) {
      error(e);
    }
  };
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        adminView();
      }),
  );
  document.querySelector("#export").onclick = exportMonth;
  document.querySelector("#qr").onclick = () => {
    const q = qrcode(0, "M");
    q.addData(new URL("index.html", location.href).href);
    q.make();
    const url = URL.createObjectURL(
      new Blob([q.createSvgTag({ cellSize: 8, margin: 32, scalable: true })], {
        type: "image/svg+xml",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "会员水果领取二维码.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.querySelector("#entry").onclick = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL("index.html", location.href).href,
      );
      document.querySelector("#entry").textContent = "已复制 ✓";
    } catch {
      alert(new URL("index.html", location.href).href);
    }
  };
  document.querySelector("#csvFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 100000) {
        error(new Error("文件不能超过 100 KB"));
        return;
      }
      document.querySelector("#imports").value = await file.text();
    }
  };
  document.querySelector("#import").onclick = async (e) => {
    e.target.disabled = true;
    try {
      const rows = parseCSV(document.querySelector("#imports").value.trim());
      if (rows[0]?.[0] === "姓名") rows.shift();
      if (rows.some((r) => r.length !== 2))
        throw new Error("每行需要姓名和手机号两列");
      const result = await api("admin/import", {
        members: rows.map(([name, phone]) => ({
          name: name.trim(),
          phone: phone.trim(),
        })),
      });
      credentials = result.created;
      await boot();
      showCodes(
        `已新增 ${result.created.length} 位，跳过已有会员 ${result.skipped.length} 位。`,
      );
    } catch (e) {
      error(e);
    } finally {
      e.target.disabled = false;
    }
  };
  renderTable();
  if (credentials.length) showCodes();
}
function renderTable() {
  document.querySelector("#results").innerHTML = tableView();
  document
    .querySelectorAll("[data-revoke]")
    .forEach(
      (b) =>
        (b.onclick = () => action(b, "revoke", "确认撤销本次领取并恢复额度？")),
    );
  document.querySelectorAll("[data-toggle]").forEach(
    (b) =>
      (b.onclick = () => {
        const m = data.members.find((m) => m.id === b.dataset.toggle);
        action(
          b,
          "toggle",
          m.enabled
            ? "确认停用会员？该会员将被退出，无法登录领取。"
            : "确认启用会员？",
          { enabled: !m.enabled },
        );
      }),
  );
  document.querySelectorAll("[data-reset]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !confirm(
            "请先核实会员本人身份。重置将使旧密码和所有登录失效，是否继续？",
          )
        )
          return;
        b.disabled = true;
        try {
          const r = await api("admin/reset", { id: b.dataset.reset }),
            m = data.members.find((m) => m.id === b.dataset.reset);
          credentials = [{ name: m.name, phone: m.phone, code: r.code }];
          await boot();
          showCodes("新的激活码仅在此显示，请私下发给本人。");
        } catch (e) {
          error(e);
        } finally {
          b.disabled = false;
        }
      }),
  );
}
async function action(b, route, message, extra = {}) {
  if (!confirm(message)) return;
  b.disabled = true;
  try {
    await api("admin/" + route, { id: b.dataset[route], ...extra });
    await boot();
  } catch (e) {
    error(e);
  } finally {
    b.disabled = false;
  }
}
function showCodes(message = "请保存激活码并私下发放，有效期 7 天。") {
  const el = document.querySelector("#codes");
  if (!el) return;
  el.innerHTML = `<div class="message"><p>${esc(message)}</p>${credentials.length ? `<pre>${credentials.map((c) => `${esc(c.name)} · ${esc(c.phone)} · ${esc(c.code)}`).join("\n")}</pre><button id="downloadCodes">下载激活码 CSV</button> <button id="hideCodes">已保存，关闭显示</button>` : ""}</div>`;
  if (credentials.length) {
    document.querySelector("#downloadCodes").onclick = () =>
      downloadCSV("会员激活码.csv", [
        ["姓名", "手机号", "激活码"],
        ...credentials.map((c) => [c.name, c.phone, c.code]),
      ]);
    document.querySelector("#hideCodes").onclick = () => {
      credentials = [];
      el.innerHTML = "";
    };
  }
}
function downloadCSV(name, rows) {
  const content =
    "\uFEFF" +
    rows
      .map((r) =>
        r
          .map((v) => {
            let s = String(v);
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n");
  const u = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [],
    row = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if ((c === "," || c === "，" || c === "\t") && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((s) => s.trim())) rows.push([...row]);
      row.length = 0;
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(cell);
  if (row.some((s) => s.trim())) rows.push(row);
  return rows;
}
boot();
