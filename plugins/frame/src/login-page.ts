/** Standalone login document. It is not part of the console frame, so the sidebar is absent. */
import { DEFAULT_TITLE } from './site.ts'
import { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT } from './site-mark.ts'

export const LOGIN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${DEFAULT_TITLE}</title>
<link rel="icon" type="image/svg+xml" href="${DEFAULT_ICON_LIGHT}" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/svg+xml" href="${DEFAULT_ICON_DARK}" media="(prefers-color-scheme: dark)">
<script>
fetch('/console-api/site').then(function (response) {
  return response.json()
}).then(function (site) {
  if (typeof site.title === 'string' && site.title !== '') {
    document.title = site.title
    var heading = document.querySelector('.login-brand h1')
    if (heading) heading.textContent = site.title
  }
  var mark = document.querySelector('.logo-mark img')
  if (mark && typeof site.icon === 'string' && site.icon.indexOf('data:image/') === 0) mark.src = site.icon
  if (typeof site.icon !== 'string' || site.icon.indexOf('data:image/') !== 0) return
  document.querySelectorAll('link[rel="icon"]').forEach(function (node) { node.remove() })
  var link = document.createElement('link')
  link.rel = 'icon'
  link.href = site.icon
  document.head.appendChild(link)
}).catch(function (cause) { void cause })
</script>
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
    width: min(400px, 100%); background: #fff; border-radius: 6px;
    box-shadow: 0 8px 28px rgba(31, 35, 41, 0.08); padding: 32px 32px 28px;
  }
  .login-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .logo-mark {
    width: 28px; height: 28px; border-radius: 6px; background: transparent;
    display: grid; place-items: center;
  }
  .logo-mark img { width: 28px; height: 28px; display: block; object-fit: contain; }
  h1 { margin: 0; font-size: 20px; font-weight: 650; }
  .muted { margin: 0 0 18px; color: var(--muted); }
  label { display: grid; gap: 6px; margin-bottom: 14px; color: #606266; }
  input {
    height: 32px; border: 1px solid var(--border); background: #fff; border-radius: 4px; padding: 0 10px; outline: none;
  }
  input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 94, 235, 0.12); }
  button.primary {
    width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--primary);
    background: var(--primary); color: #fff;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .banner { background: var(--red-bg); border: 1px solid #f6c9c9; color: #c43838; padding: 8px 12px; border-radius: 4px; margin: 0 0 14px; }
  [hidden] { display: none; }
</style>
</head>
<body>
  <div class="login-wrap">
    <form class="login-card">
      <div class="login-brand"><span class="logo-mark"><img src="${DEFAULT_ICON_LIGHT}" alt=""></span><h1>${DEFAULT_TITLE}</h1></div>
      <p class="muted">使用用户名和密码登录。开启两步验证后，还需要验证码。</p>
      <p class="banner" hidden></p>
      <label>用户名<input name="username" value="admin" autocomplete="username" required></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
      <label data-totp hidden>验证码<input name="totp_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
      <button class="primary" type="submit">登录</button>
    </form>
  </div>
  <script>
    const form = document.querySelector('form')
    const banner = document.querySelector('.banner')
    const totp = document.querySelector('[data-totp]')
    const button = form.querySelector('button')
    function show(message) {
      banner.hidden = false
      banner.textContent = message
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      banner.hidden = true
      button.disabled = true
      const body = { username: form.username.value, password: form.password.value }
      if (!totp.hidden) body.totp_code = form.totp_code.value
      try {
        const response = await fetch('/console-api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.status === 401) {
          show(typeof payload.detail === 'string' ? payload.detail : '用户名或密码不正确')
          return
        }
        if (payload.totp_required) {
          totp.hidden = false
          form.totp_code.required = true
          show('这个账户开启了两步验证，请填写验证码')
          return
        }
        if (payload.ok) {
          location.assign('/')
          return
        }
        show('登录失败')
      } catch {
        show('登录失败')
      } finally {
        button.disabled = false
      }
    })
  </script>
</body>
</html>
`
