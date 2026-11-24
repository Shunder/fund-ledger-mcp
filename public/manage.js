"use strict";
const el = (id) => document.getElementById(id);
let auth, token;
const templates = {
  add: { platform: "", code: "", day: "", shares: "", unitCost: "" },
  update: { platform: "", code: "", day: "", shares: "", unitCost: "" },
  record: {
    id: "",
    platform: "",
    code: "",
    kind: "buy",
    status: "pending",
    orderDay: "",
    amount: "",
    fee: "0",
  },
  delete_record: { id: "" },
  delete_holding: { platform: "", code: "" },
};
function reset() {
  token = null;
  el("confirm").hidden = true;
  el("result").textContent = "";
}
function template() {
  reset();
  const a = el("action").value;
  el("payload").value =
    a === "import"
      ? "platform,code,day,shares,unitCost\n"
      : JSON.stringify(templates[a], null, 2);
}
async function call(name, input) {
  const access = await auth.getTokenSilently();
  const r = await fetch("/api/tools/" + name, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + access,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await r.json();
  if (!r.ok) throw Error(JSON.stringify(body.error));
  return body.result;
}
async function list() {
  const r = await call("get_portfolio", {}),
    table = document.createElement("table");
  const heads = [
    "平台",
    "基金",
    "份额",
    "成本（元）",
    "市值（元）",
    "净值日期",
  ];
  const tr = table.insertRow();
  heads.forEach((t) => {
    const th = document.createElement("th");
    th.textContent = t;
    tr.append(th);
  });
  for (const i of r.holdings) {
    const row = table.insertRow();
    if (!table.querySelector("#fund-" + i.code)) row.id = "fund-" + i.code;
    for (const v of [
      i.platform,
      i.code,
      i.shares,
      i.cost,
      i.marketValue,
      i.navDay,
    ])
      row.insertCell().textContent = v ?? "待披露";
  }
  el("positions").replaceChildren(table);
  if (/^#fund-\d{6}$/.test(location.hash))
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
function handle(id, fn) {
  el(id).onclick = async () => {
    el(id).disabled = true;
    try {
      await fn();
    } catch (e) {
      el("status").textContent = e.message;
    } finally {
      el(id).disabled = false;
    }
  };
}
async function init() {
  const c = await (await fetch("/web-config")).json();
  if (!c.clientId) {
    el("login").disabled = true;
    el("status").textContent = "尚未配置浏览器 OAuth 客户端。";
    return;
  }
  auth = await auth0.createAuth0Client({
    domain: c.domain,
    clientId: c.clientId,
    authorizationParams: {
      audience: c.audience,
      scope: "openid portfolio:read portfolio:write",
      redirect_uri: location.origin + "/manage",
    },
    cacheLocation: "memory",
  });
  if (new URLSearchParams(location.search).has("code")) {
    await auth.handleRedirectCallback();
    history.replaceState({}, "", "/manage");
  }
  handle("login", () => auth.loginWithRedirect());
  handle("logout", () =>
    auth.logout({ logoutParams: { returnTo: location.origin + "/manage" } }),
  );
  const logged = await auth.isAuthenticated();
  el("ledger").hidden = !logged;
  el("login").hidden = logged;
  el("logout").hidden = !logged;
  if (!logged) return;
  template();
  el("action").onchange = template;
  el("payload").oninput = reset;
  handle("reload", list);
  handle("preview", async () => {
    reset();
    const action = el("action").value;
    const data =
      action === "import"
        ? { data: { csv: el("payload").value } }
        : JSON.parse(el("payload").value);
    const op = ["add", "update"].includes(action)
      ? { holding: data }
      : action === "record"
        ? { transaction: data }
        : data;
    const r = await call("preview_portfolio_changes", {
      operation: { action, ...op },
    });
    token = r.token;
    el("result").textContent = JSON.stringify(r.changes, null, 2);
    el("confirm").hidden = false;
  });
  handle("confirm", async () => {
    const r = await call("confirm_changes", { token });
    reset();
    el("status").textContent = "已提交 " + JSON.stringify(r);
    await list();
  });
  await list();
}
init().catch(() => {
  el("status").textContent =
    "登录或加载失败，请检查浏览器客户端配置与账户授权。";
});
