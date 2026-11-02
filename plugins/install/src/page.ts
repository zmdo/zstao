/** Standalone install document. The shell is not loaded, so this page does not call it. */
import { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT, DEFAULT_TITLE } from '@smp/console-frame/site-mark'

export const INSTALL_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${DEFAULT_TITLE}</title>
<link rel="icon" type="image/svg+xml" href="${DEFAULT_ICON_LIGHT}" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/svg+xml" href="${DEFAULT_ICON_DARK}" media="(prefers-color-scheme: dark)">
<style>
  :root {
    --bg: #f4f6f8; --text: #323232; --muted: #8a8f99; --border: #dcdfe6;
    --primary: #005eeb; --red-bg: #fdecec;
    color: var(--text);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 13px; line-height: 1.5;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  button, input { font: inherit; color: inherit; }
  button { cursor: pointer; }
  .login-wrap {
    height: 100vh; overflow: auto; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(900px 420px at 50% -10%, rgba(0, 94, 235, 0.08), transparent 60%), var(--bg);
  }
  .login-card {
    width: min(640px, 100%); background: #fff; border-radius: 6px;
    box-shadow: 0 8px 28px rgba(31, 35, 41, 0.08); padding: 32px 32px 28px;
  }
  .login-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .logo-mark {
    width: 28px; height: 28px; border-radius: 6px; background: transparent;
    display: grid; place-items: center;
  }
  .logo-mark img { width: 28px; height: 28px; display: block; object-fit: contain; }
  .brand { margin: 0; font-size: 20px; font-weight: 650; color: var(--text); }
  h1 { margin: 0 0 8px; font-size: 20px; font-weight: 650; }
  .muted { margin: 0 0 18px; color: var(--muted); }
  label, .field { display: grid; gap: 6px; margin-bottom: 14px; color: #606266; }
  .field label { margin: 0; }
  input {
    height: 32px; border: 1px solid var(--border); background: #fff; border-radius: 4px; padding: 0 10px; outline: none;
  }
  input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 94, 235, 0.12); }
  .group {
    border: 1px solid var(--border); border-radius: 4px; margin: 0 0 16px; padding: 14px 14px 0;
  }
  .group h2 { margin: 0 0 12px; font-size: 14px; font-weight: 650; color: var(--text); }
  .key-row { display: flex; gap: 8px; }
  .key-row input { flex: 1; min-width: 0; }
  button.generate {
    height: 32px; padding: 0 12px; border-radius: 4px; white-space: nowrap;
    border: 1px solid var(--border); background: #fff;
  }
  button.primary {
    width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--primary);
    background: var(--primary); color: #fff;
  }
  button.connect {
    width: 100%; height: 36px; margin-bottom: 14px; border-radius: 4px;
    border: 1px solid #1b9a4b; background: #1b9a4b; color: #fff;
  }
  .connected { margin: -4px 0 14px; color: #1f7a3a; }
  button:disabled { opacity: 0.6; cursor: default; }
  .banner { background: var(--red-bg); border: 1px solid #f6c9c9; color: #c43838; padding: 8px 12px; border-radius: 4px; margin: 0 0 14px; }
  [hidden] { display: none; }
</style>
</head>
<body>
  <div class="login-wrap">
    <form class="login-card">
      <div class="login-brand"><span class="logo-mark"><img src="${DEFAULT_ICON_LIGHT}" alt=""></span><p class="brand">${DEFAULT_TITLE}</p></div>
      <h1>安装</h1>
      <p class="muted">填写数据库信息和加密密钥。</p>
      <p class="banner" hidden></p>
      <section class="group">
        <h2>数据库配置</h2>
        <label>地址<input name="host" autocomplete="off" required></label>
        <label>端口<input name="port" inputmode="numeric" autocomplete="off" required></label>
        <label>数据库<input name="database" autocomplete="off" required></label>
        <label>用户名<input name="username" autocomplete="off" required></label>
        <label>密码<input name="password" type="password" autocomplete="off" required></label>
        <p class="connected" hidden>已连上</p>
        <button class="connect" type="button">连接测试</button>
      </section>
      <section class="group">
        <h2>加密配置</h2>
        <div class="field"><label for="encryptionKey">加密密钥</label><span class="key-row"><input id="encryptionKey" name="encryptionKey" autocomplete="off" required><button class="generate" type="button">生成</button></span></div>
      </section>
      <button class="install primary" type="submit" disabled>安装</button>
    </form>
  </div>
<script>
  const form = document.querySelector('form')
  const banner = document.querySelector('.banner')
  const button = form.querySelector('button.install')
  const connectButton = form.querySelector('button.connect')
  const connected = form.querySelector('.connected')
  const databaseNames = ['host', 'port', 'database', 'username', 'password']
  function databaseBody() {
    const data = new FormData(form)
    const body = {}
    databaseNames.forEach(function (name) { body[name] = data.get(name) })
    return body
  }
  function markDisconnected() {
    button.disabled = true
    connected.hidden = true
  }
  databaseNames.forEach(function (name) {
    form.elements[name].addEventListener('input', markDisconnected)
  })
  connectButton.addEventListener('click', function () {
    const missing = databaseNames.some(function (name) { return !form.elements[name].reportValidity() })
    if (missing) return
    banner.hidden = true
    connected.hidden = true
    connectButton.disabled = true
    button.disabled = true
    fetch('/console-api/install/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(databaseBody()),
    }).then(function (response) {
      return response.json().then(function (payload) {
        return { ok: response.ok, payload: payload }
      })
    }).then(function (result) {
      connectButton.disabled = false
      if (result.ok && result.payload.ok === true) {
        connected.hidden = false
        button.disabled = false
        return
      }
      banner.textContent = typeof result.payload.detail === 'string' ? result.payload.detail : '数据库连不上'
      banner.hidden = false
    }).catch(function () {
      connectButton.disabled = false
      banner.textContent = '数据库连不上'
      banner.hidden = false
    })
  })
  form.querySelector('.generate').addEventListener('click', function () {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    let text = ''
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
    form.elements.encryptionKey.value = btoa(text).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
  })
  form.addEventListener('submit', function (event) {
    event.preventDefault()
    banner.hidden = true
    button.disabled = true
    const data = new FormData(form)
    fetch('/console-api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: data.get('host'),
        port: data.get('port'),
        database: data.get('database'),
        username: data.get('username'),
        password: data.get('password'),
        encryptionKey: data.get('encryptionKey'),
      }),
    }).then(function (response) {
      return response.json().then(function (payload) {
        return { ok: response.ok, payload: payload }
      })
    }).then(function (result) {
      if (result.ok && result.payload.ok === true) {
        window.location.assign('/')
        return
      }
      banner.textContent = typeof result.payload.detail === 'string' ? result.payload.detail : '安装失败'
      banner.hidden = false
      button.disabled = false
    }).catch(function () {
      banner.textContent = '安装失败'
      banner.hidden = false
      button.disabled = false
    })
  })
</script>
</body>
</html>
`
