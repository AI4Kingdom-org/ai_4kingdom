# Public access plan (visitors without login)

Status: approved 2026-10-07, not started.

## Goals

1. Every chatbot and assistant is usable without logging in.
2. Visitors get a one-time trial of **50 credits** per device. It never resets.
3. Registered, logged-in users get the free **300 credits** per month. Pro and ultimate are unchanged.
4. On pastor and church pages, 文檔列表 and 主日信息導航 are public. Anyone can read 信息总结, 每日灵修 and 查经指引.
5. Upload/transcribe stays visible only to designated users. Delete and rename keep today's rule: the uploader or a designated user.

## Decisions

| # | Question | Answer |
|---|---|---|
| a | Guest 50 credits | Once per device, never reset |
| b | Reading summary/devotional/bible | Free for everyone, no credits deducted |
| c | Enforce credit limits on the server for members too | Yes |
| d | Visitors on the church-page chat bubble and creative-studio | Yes, within the same 50 credits |
| e | What visitors cannot download | Only the 下载完整版 button (`/api/sunday-guide/download-pdf`) |
| f | Registering after using the trial | Always a fresh 300 |

## Current state (why this is more than a UI change)

- The login gate exists only in the browser.
  - `WithChat` renders nothing until a user exists.
  - About 10 pages have `if (!user) return null`.
  - The 5 `*/navigator` pages show 請先登錄.
- WordPress gates too. The `[*_iframe]` shortcodes in the hello-biz theme `functions.php` return `请先登录查看内容` for logged-out visitors (see README §6). They also put `userId` in the iframe URL. Pages affected:
  - 3938, 4236, 4271, 4282, 4371, 4747, 4791
  - 48, 4140, 4145, 4213, 3415, 1320, 647, 4186
  - plus others
- Credits are never checked on the server. `/api/chat` only records usage, so today's free 300 isn't enforced for chat. The only limit is the upload button, which is disabled when credits reach 0.
- The server trusts `userId` from the request in all of these:
  - chat, routing-agent
  - sunday-guide content
  - documents DELETE/PATCH
  - download-pdf
  - threads, messages
  - usage/monthly
- The documents list returns each uploader's `userId`, so anyone can call DELETE as that uploader. **This is exploitable today.**
- Upload, youtube, transcription and process-document have no permission check on the server; they are hidden in the UI only. Only `vector-store/upload` checks `allowedUploaders`.
- Reading summaries currently deducts estimated tokens (`content/[assistantId]/route.ts`).
- `routing_agent` already has a localStorage guest ID, with no usage tracking.

## Phases

### 0. Identity the server can check (ship first)

- **mu-plugin:** `/hello-biz/v1/session` also returns a short-lived HMAC-signed member token `{uid, exp}`. The secret is shared with the app.
- **App, guests:** a new endpoint issues a signed guest ID. It is stored in localStorage and sent as a header. Not a cookie: the app runs in a cross-site iframe, and Safari blocks third-party cookies.
- **App, shared helper:** `getRequestIdentity(req)` returns `{kind: 'member', userId}`, `{kind: 'guest', guestId}` or `null`.
- Replace every trusted `userId` param:
  - chat, routing-agent
  - content
  - documents DELETE/PATCH (same rule: uploader or `allowedUploaders`)
  - download-pdf (members only)
  - threads, messages, usage
- Upload, youtube, transcription and process-document require a designated user, checked on the server.

### 1. Credits

- `plans.ts`: add `guest: 50_000` tokens (50 credits).
- Guest usage is stored in `MonthlyTokenUsage` as `UserId = guest:<id>` with a fixed `YearMonth = 'lifetime'`, so it never resets.
- Check the balance on the server before every OpenAI call:
  - chat, routing-agent
  - upload, transcription, youtube
  - creative-studio
- When credits run out, return `402 {code: 'INSUFFICIENT_CREDITS', loginRequired}`.
- Content reads (summary/devotional/bible) no longer deduct anything.
- Abuse controls:
  - per-IP daily guest token cap (DynamoDB counter with TTL)
  - per-minute rate limit
  - message length cap
  - global daily guest budget kill switch, set by an env var
  - optional Turnstile check on a guest's first message
- `CreditContext` works for guests too. Show 「訪客試用 剩餘 X / 50 — 註冊即得 300」, with register/login links using `target="_top"`.

### 2. Open the chatbots

- `WithChat`: build the config for either a member or a guest, and render once the auth check finishes.
- Remove the `!user` gates on:
  - spiritual-partner, life-mentor, teen-console, child-mental, johnsung, kou-shih-yuan, homeschool
  - home-console, root page
  - church/pastor floating chat
- Guest chat history stays on the device and is not migrated on signup.
- These stay login-only:
  - usercredit, file-records, user-sunday-guide
  - user-permissions, admin/*, token-management, management
  - homeschool-prompt

### 3. Pastor and church pages

Pages: agape-church, east-christ-home, cfsc-church, chinese-pastor-network, jian-zhu, zhiming-yuan, sunday-guide-v2, and the 5 navigator pages.

- The document list and the navigator render for guests.
- 下载完整版 is hidden for guests and refused by the server.
- Delete/rename rule is unchanged.
- The upload section is shown only to designated users.
- Check `sunday-guide-v2`: it currently shows upload to any logged-in user (`devSkip || !!user`).

### 4. WordPress

- Replace the theme's `[*_iframe]` shortcodes with a mu-plugin version that renders for logged-out visitors and drops `userId` from the URL. Theme updates overwrite `functions.php`, so the shortcodes shouldn't live there.
- Upload the mu-plugin, then clear OPcache.
- Check the PMS content restriction on the pages and on the nav-menu items.
- Pricing page 1978 has hardcoded credits: add the visitor 50 trial.
- Routing agent `PAGE_MAP.login` text currently says login is required.

### 5. Deploy and test

- New server secrets go into the `.env.production` that `amplify.yml` writes.
- Redeploy the Fly worker if the process-document contract changes.
- Test matrix:
  - users: guest, free member, pro, designated uploader, uploader of their own file
  - browsers: Chrome, plus Safari inside the WordPress iframe
  - cases: guest hitting 50; member hitting 300

## Risks

- Server-side enforcement starts blocking free members who chat past 300.
- Visitors trigger real OpenAI cost. Set the daily guest budget before launch.
- Bots: there is a history of about 1,191 fake registrations and a login flood. A free 300 for registering makes fake signups more attractive, so consider email verification or a captcha on registration.
- A guest who clears browser storage gets a fresh 50. The per-IP cap limits this but cannot prevent it.
