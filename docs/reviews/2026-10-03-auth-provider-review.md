# Authentication and provider issue review

Reviewed 2026-10-03. Scope: #75–#79 and the existing implementations in #87
(`fbeacb3`), #91 (`2a1b8fb`), and #90 (`8911172`). The separate `chatgpt-signin`
worktree was changing during review; its unfinished implementation is not treated as
a submitted PR. Review and regression probes use the isolated `auth-review-followups`
worktree based on main `3dc24da`.

## Confirmed implementation defects

1. **P2 — Codex initialization timeout prevents all subsequent requests (#87).**
   `CodexBackend.ensure()` caches the rejected initialization promise while retaining
   the live child. A second model lookup reuses that failure instead of recovering.
   Reproduced by withholding the first initialize response and allowing a replacement
   server to respond. The replacement is never spawned before the correction.
   Correction: disconnect and terminate only the child whose handshake failed; later
   callers can create a fresh server. An initialized server serving other turns is
   outside this cleanup path.
2. **P2 — Claude cancellation unlocks a still-running login (#91).**
   Cancellation and timeout resolve before the login child's close event. Another
   attempt can begin while the first process still has authority to persist credentials.
   Reproduced with a child that acknowledges a kill request without exiting immediately.
   Correction: wait for close, escalate only the owned child, and retain the attempt lock
   if termination cannot be confirmed within the shutdown deadline.
3. **P2 — Claude cancellation can report authenticated (#91).**
   During the final account-status probe, cancellation still targets the completed login
   stage and the final result ignores the cancellation flag. A late successful status
   response is returned as authenticated. Reproduced by delaying that final response.
   Correction: make cancellation apply to the whole attempt and check it after the final
   probe. Explain that CLI credentials may already have changed.

All three regressions failed before the local corrections and passed afterward. The
focused run covering these regressions, backend health, Claude login, and Codex backend
behavior reported **26 passed, 1 Windows platform skip**. Both the backend-health and
narrow/zoomed Settings Electron tests also passed. This is fixture evidence, not
a real login or model-entitlement claim. No provider credentials were changed.

## Acceptance gaps to reconcile before closing the issues

| Issue | Triage and remaining work |
| --- | --- |
| #75 | Fix the confirmed initialization defect. Complete version/capability reporting and the verified-access lifecycle, or explicitly rescope those acceptance criteria: the submitted status type only permits `access: unverified` and discards version output. Add status failure/stale-result UI coverage and README guidance. Coordinate with #68 before landing overlapping backend lifecycle changes. |
| #76 | Continue the existing owner’s app-owned OAuth implementation. Check protected storage, refresh serialization, per-registration child ownership, thread identity binding, and non-interruption of active turns against the issue. Record the narrowly scoped authentication-network decision; coding execution stays in Codex. Real sign-in, completed turn, renewal and resume remain separate acceptance evidence. |
| #77 | Fix both confirmed cancellation defects. Verify older-CLI capability detection before invoking `auth status`, because the existing comment itself notes unsupported subcommands may be interpreted as prompts. Reconcile the Settings attempt with #68’s terminal remedy, show all known credential methods, add README guidance, and retain the real interactive-login/turn gate. |
| #78 | Keep the conditional CLI/ACP decision and disabled provider. Expand the report with the requested eligibility/platform and login lifecycle matrices; distinguish observed initialize support from authenticated sessions, approvals and resume. Publish bounded implementation follow-ups only after the provider-scope decision. |
| #79 | Keep CLI feasibility independent from public OAuth enrollment. Add exact subscription eligibility, credential precedence, enforced-team/login policy and lifecycle cases. The current prose cites those documents but does not record the requested specifics. Keep the provider disabled pending the stated permission and native-platform gates. |

## Primary-source checks and research corrections

- The [OpenAI Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
  supports an app-owned OAuth grant supplied to the child and requires restarting with
  renewed credentials before resuming. Model discovery is explicitly not entitlement
  evidence. Thus #76 must retain its process/account isolation design; merely adding
  existing CLI login does not complete it.
- [Claude's CLI reference](https://code.claude.com/docs/en/cli-reference) documents JSON
  auth status, signed-in/signed-out exit codes, and six authentication-method values.
  [Credential precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)
  explains why a saved subscription login does not necessarily supply a coding turn's
  credential. Status copy must describe the effective method without exposing tokens.
- [Gemini authentication](https://geminicli.com/docs/get-started/authentication/) distinguishes
  personal free/Pro/Ultra accounts, organization/Workspace accounts and project-requiring
  Code Assist licenses. API-key and Vertex credentials are separate routes. Its
  [installation guide](https://geminicli.com/docs/get-started/installation/) recommends
  macOS 15+, Windows 11 24H2+, Ubuntu 20.04+ and Node 20+, and links supported locations.
  Those vendor recommendations are not a claim that Modex has validated each platform.
- The [Grok Build launch](https://x.ai/news/grok-build-cli) names SuperGrok and X Premium
  Plus subscribers. The [Warp announcement](https://x.ai/news/grok-warp) establishes a
  named third-party integration, not public registration for Modex. The
  [enterprise guide](https://docs.x.ai/build/enterprise) documents per-model precedence
  (`model.api_key`, `model.env_key`, active session, then `XAI_API_KEY`), refreshable
  browser/device/external-provider authentication, and enforced team/login policies.
  `force_login_team_uuid` can reject mismatched teams; `disable_api_key_auth` prevents
  first-party API keys from bypassing the required identity route. These specifics
  belong in #79’s decision matrix.

## Delivery order and ownership

Resolve #75 and #68 lifecycle overlap first. Rebase the dependent Claude work onto the
agreed status contract; review #76 separately for account-bound execution and credentials.
The Gemini/Grok research can finish independently without enabling either backend.

Existing PR branches and worktrees were not modified by this review. Local corrections
are prepared for coordinated delivery; they do not establish that #75–#79 are complete
or that any current PR should be marked ready. Confirm which session owns the existing
branches before updating or superseding their work.
