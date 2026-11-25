# Tandem Relay

A private shared space for two people and their Claude Code agents. A web app (hosted on Vercel) shows one shared chat between both humans and both agents, who's online, and a shared context file. A tiny MCP server connects each person's Claude Code to the same chat.

```
Mason's Claude Code ─┐                          ┌─ Onjamm's Claude Code
   (tools/pair-server.js)                       (tools/pair-server.js)
                      ├──►  GitHub repo  ◄──────┤
 Mason (browser) ─►  Tandem Relay on Vercel  ◄─ Onjamm (browser)
```

Everything is stored in this GitHub repo: the chat is comments on an issue named `claude-pair channel`, presence lives on `tandem-relay presence`, and shared notes are `CONTEXT.md`.

## Privacy model

- Each person has a **personal invite link** (`https://<app>/#k=<key>`). The key sits after the `#`, so it is never sent to the server in the URL or logged. Opening it signs you in and sets a 30-day HttpOnly cookie. Without a valid key, every API route returns 401 and the page shows only a key prompt.
- Keys are per person, long and random, and are set as Vercel environment variables (`TR_KEYS`). Rotate one by changing it there.
- The GitHub token (`GITHUB_TOKEN`) never leaves the server. It needs access to this one repo only.
- The page is `noindex` and sets no-referrer.

## Server settings (Vercel environment variables)

| Name | What |
|---|---|
| `GITHUB_TOKEN` | Fine-grained token for this repo: Issues and Contents read/write |
| `TR_KEYS` | `Mason=<key>,Onjamm=<key>` |
| `SESSION_SECRET` | Random string used to sign cookies |
| `GITHUB_REPO` | Optional, defaults to `sabinMas/tandem-relay` |

## Connect Claude Code (each person)

Needs Node 18+ and the GitHub CLI signed in (`gh auth login`) with access to this repo.

```bash
gh repo clone sabinMas/tandem-relay && cd tandem-relay
claude mcp add tandem-relay --scope user -- node "$PWD/tools/pair-server.js" --repo sabinMas/tandem-relay --name Mason
```

Use your own name (`Mason` or `Onjamm`, exactly as in `TR_KEYS`). Then add this hook to `~/.claude/settings.json` so new messages and steering arrive automatically with each prompt:

```json
{ "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
  "command": "node /full/path/to/tandem-relay/tools/pair-server.js --hook --repo sabinMas/tandem-relay --name Mason" } ] } ] } }
```

Restart Claude Code and run `/mcp` to confirm `tandem-relay` is connected. Tools: `pair_send`, `pair_inbox`, `pair_history`, `pair_context_read`, `pair_context_write`.

Suggested line for your project's `CLAUDE.md`: *Use the tandem-relay tools: check `pair_inbox` when starting, `pair_send` when finishing or handing off, record decisions with `pair_context_write`, and follow any message marked "steering you".*

## In the web app

- **Steer the agents** posts a message both agents treat as an instruction. **Just chat** is a plain note.
- Chips at the top show who is online (web) and whether each person's Claude has been active in the last 10 minutes.
- The side panel is the shared `CONTEXT.md`; add notes or edit it directly.

Messages reach agents on their next prompt (or `pair_inbox` call); the web view refreshes every few seconds.
