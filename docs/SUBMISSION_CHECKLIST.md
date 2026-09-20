# Luna Prix — Vibeathon Round 1 submission checklist

Verified 20 Sep 2026 against Official Rules **v1.0.2** (effective 8 Sep 2026 11:18 UTC).
Sources: portal <https://vibeathon.axieinfinity.ai/> · rules <https://vibeathon.axieinfinity.ai/rules/1.0.2> ·
resources <https://vibeathon.axieinfinity.ai/resources> · announcement <https://blog.axieinfinity.com/p/the-axie-vibeathon-is-live>

**DEADLINE: 21 Sep 2026, 13:00 UTC** (20:00 Vietnam time). "The Event Platform's server time and a
successful finalization receipt determine whether an entry is on time." — rules/1.0.2. That is
**~24 hours from now**. Submitting is not finishing — you must *finalize* and get the receipt.

---

## A. Could disqualify him outright

| # | Requirement | State | Do this |
|---|---|---|---|
| A1 | **Registration closed 7 Sep 2026, 13:00 UTC.** Entry is only open to registered builders. (portal home; rules/1.0.2) | **OWNER-ONLY — UNVERIFIED** | Open <https://vibeathon.axieinfinity.ai/sign-in>. If there is no registered entry under your Sky Mavis account, **nothing below matters** — stop and check this first. I cannot see behind the login. |
| A2 | "Confirm that the GitHub account **jaatster** has been invited to the repository or already has access." (rules/1.0.2) | **MISSING** | `gh api -X PUT repos/shylahrskeens/luna-prix-claude/collaborators/jaatster -f permission=pull` — verified today: repo is **PRIVATE**, sole collaborator `shylahrskeens`, **zero pending invitations**. Without this the judges cannot open the repo. |
| A3 | "Round 1 requires a **playable external build**… The Organizer does not host, iframe, proxy, preload, or execute participant games." (rules/1.0.2) | **MISSING** | Nothing is hosted. `.github/workflows/pages.yml` exists but its own header says Pages "needs the repo to be public on a free plan." Make the repo **public**, then Settings → Pages → Source: GitHub Actions. Public also satisfies A2's spirit, but **still tick the jaatster confirmation box**. |
| A4 | A **verified Discord connection** is required when finalizing a submission revision. (rules/1.0.2) | **OWNER-ONLY** | Connect Discord in the portal before you press finalize. |
| A5 | "Do not submit… **fabricated provenance**." (rules/1.0.2) | **FALSE CLAIM IN OUR DOCS** | See section D1 — fix before submitting. |
| A6 | Entry is individual, one account, one project, 18+. (rules/1.0.2) | DONE (solo build) | No action. |

---

## B. Required submission fields

Field list per rules/1.0.2 and the announcement post. **No word, character, thumbnail or video
limits are published on any page I could read** — the Builder Resource Kit and Get Started pages are
Notion pages that render via JavaScript and returned no text. Owner: open
<https://skymavis.notion.site/Get-Started-with-Axie-Vibeathon-3cec48ae3fdd81d6ba74d9b193aa8f4a>
and <https://skymavis.notion.site/Builder-Resource-Kit-39ec48ae3fdd81449b68d1c361d319a5> and check
limits against the copy below before pasting.

| # | Field | State | Source of copy |
|---|---|---|---|
| B1 | Project title | DONE — "Luna Prix" | SUBMISSION.md |
| B2 | One-sentence pitch | DONE | SUBMISSION.md "One line" |
| B3 | Short description | DONE (48 words) | SUBMISSION.md |
| B4 | Full description | DONE (270 words) | SUBMISSION.md |
| B5 | **Axie Core fit** — heaviest criterion at 35% | DONE, strong | SUBMISSION.md "How Luna Prix fits the Axie world" |
| B6 | **Product vision** — 20% | DONE | SUBMISSION.md "Product vision" |
| B7 | Platform selection (browser / Win / macOS / Android / iOS) | OWNER-ONLY | Tick **browser** only. |
| B8 | Playable link + run instructions per platform | **MISSING** | Blocked on A3. Instruction: "Open the link in a desktop browser with WebGL. Click GO. Keyboard, gamepad and touch all work." |
| B9 | Repository link | DONE (URL exists) | `https://github.com/shylahrskeens/luna-prix-claude` |
| B10 | **Full exact review commit SHA**, and confirm this commit produced every linked build | DONE **today only** | `7f03f144c46fb1c0e3a991715ad4548fe7d874ca`. Verified today: tree clean, `origin/main` identical, `npm run build` succeeds from it. **If you push anything else (e.g. the doc fixes in D), re-read the SHA with `git rev-parse HEAD` and paste the new one.** |
| B11 | Controls and supported devices | **MISSING from SUBMISSION.md** | Paste the controls table from README.md lines 39–48, then: "Desktop browser with WebGL 2. Gamepad and touch supported. Every binding is remappable in Settings." |
| B12 | **Known issues** — explicitly required, and we have none written | **MISSING** | Write exactly: "Frame rate on GPU hardware is unmeasured; the figures in docs/evidence/performance.md are CPU submit cost and a floor, not a frame rate. No handset was tested beyond a 414 px viewport. No memory soak test was run. Rank ladder and leaderboards are local to the browser profile; no hosted leaderboard is running. Multiplayer was proven with headless CLI clients against the local server, not two browsers." |
| B13 | Thumbnail image | **MISSING** | Use `docs/evidence/screens/02-gator-pit-leap.jpg`. Dimensions unpublished — if the portal rejects it, crop to 16:9 from `05-cloudforge-hangar.jpg`. |
| B14 | Demonstration video | OWNER-ONLY — **optional** per rules/1.0.2 ("A demonstration video is optional") but the portal lists a "fallback demo video" field | Film section E. Upload unlisted to YouTube; paste the link. Do this **after** A2/A3, not instead of them. |
| B15 | AI-use disclosure ("accurate disclosures for material AI use, pre-existing work, starters, dependencies, assets, and contributors") | **RISKY — INCOMPLETE** | SUBMISSION.md says only "Claude (Claude Code)". Our project memory records Luna Prix as also started in **Grok Build**. Owner: if any Grok Build work is in this codebase, name it. Also list dependencies: three.js MIT (runtime); TypeScript, Vite, esbuild, ws (dev); Inter via Google Fonts (SIL OFL). |

---

## C. Things the rules require that we are already clean on

- **Basic play must not require a wallet or Event Platform account** (rules/1.0.2) — DONE. No chain code, no wallet, no account. `docs/COMPLIANCE.md` "Web3" is accurate.
- **Sufficient rights for everything submitted** — DONE for the shipped build. `assets-incoming/` (the official `jaatster/axie-3d-assets` GLBs) is gitignored and absent from `dist/`; verified today. If you *do* import a GLB before the deadline, you must also keep its `RIGHTS.md` and `THIRD_PARTY_NOTICES.md` alongside it (<https://github.com/jaatster/axie-3d-assets>).
- **Licence grant** — by finalizing you grant Sky Mavis a perpetual, irrevocable, sublicensable licence to run, modify and promote the entry (rules/1.0.2). There is **no LICENSE file** in the repo; none is required by the rules. Leave it or add MIT — your call, not a blocker.
- **"Live approved Mixer" and "complete game loop"** are **Round 2** expectations, not Round 1. Do not chase the Mixer today.

---

## D. False or risky statements in our existing docs — fix before submitting

| # | Where | Problem | Replace with |
|---|---|---|---|
| D1 | `docs/SUBMISSION.md` line 62; `docs/COMPLIANCE.md` line 40 | Claims the three drivers are "named for the models in the **official Axie 3D starter toolkit**". The toolkit's mascots are Bing, Kibo, Kotaro, Paladill, Pomodoro, Tripp, Xia — verified today by listing `assets-incoming/axie-3d-assets/assets/mascots/`. **Buba and Puffy are not in it.** Only Pomodoro is. This reads as fabricated provenance (A5). | "Pomodoro is named for one of the seven mascots in the official Axie 3D asset kit, so that mesh drops into the same `AxieDefinition`. Buba and Puffy are original demo drivers authored for this build." |
| D2 | `docs/SUBMISSION.md` line 100 | "**674 KB total, 186 KB gzipped**" — wrong. | Measured from `npm run build` today: **728 kB raw, 202 kB gzipped** (index 1.68/0.84, css 12.88/3.63, app 219.4/73.5, three 493.5/124.3). |
| D3 | `docs/evidence/performance.md` lines 24–30 | "704 kB / 197 kB" — also stale. | Same figures as D2. |
| D4 | `docs/SUBMISSION.md` line 110 | "**Multiplayer proven end to end**: two clients, one server, one race" — the evidence log is two *headless node CLI clients* on localhost, not two browsers over a network. | "Multiplayer proven with two headless clients against the authoritative server on localhost, one under 80 ms simulated latency and 3% loss. No browser-to-browser session over a real network has been run." |
| D5 | `README.md` line 7 | "runs… with no network connection" — `index.html` loads Inter from `fonts.googleapis.com` / `fonts.gstatic.com` (verified in `dist/index.html`). | "no wallet and no backend. The only network request is a Google Fonts stylesheet; the game runs without it." |
| D6 | `docs/SUBMISSION.md` line 121 | Shot list is **60 seconds**. Section E replaces it with a 45 s one-take. | Use section E. |
| D7 | `docs/SUBMISSION.md` lines 142–143 | Links are placeholders: "*(host dist/ and paste the link)*" / "*(push and paste the link)*". | Fill after A3. Repo URL is known (B9). |

**I have not verified** any character/word limit, thumbnail dimension, or video length cap — no
public page states one, and the two Notion pages that might are login/JS-gated (URLs in section B).
I also could not see the submission form itself; it is behind <https://vibeathon.axieinfinity.ai/sign-in>.

---

## E. 45-second demo video — one take, no editing

Seconds allocated to match the judging weights: Axie Core 35% → 16 s, Gameplay 25% → 11 s,
Vision 20% → 9 s, Feasibility 10% → 5 s, Docs 10% → 4 s.

Start in the **Garage**, screen recorder already running, game already loaded. Do not narrate; add
one on-screen caption per block afterwards only if your recorder does it without editing.

| Time | What you do on screen | Criterion it feeds |
|---|---|---|
| 0:00–0:04 | Garage, Buba on the turntable. Hold still 2 s so the Axie reads as a character, not a decal. | Axie Core |
| 0:04–0:10 | Swap one body part. **Let the six stat bars visibly move.** Pause on them 2 s. This is the single most valuable shot in the video — it is the 35% criterion on screen. | Axie Core |
| 0:10–0:16 | Switch driver Buba → Pomodoro, then Pomodoro → Puffy. Let each class passive card show. | Axie Core |
| 0:16–0:20 | Hit Race. Lights out on Lunacia Canopy Run, nail the start boost. | Gameplay |
| 0:20–0:27 | First two corners: hold drift, let the meter run blue → orange, release on the exit and take a rival. | Gameplay |
| 0:27–0:31 | The gator pit — the approach, the ramp, the leap, jaws breaching under you, the landing. | Gameplay |
| 0:31–0:36 | Cross the alternate-line sign, take the branch, rejoin ahead. Do **not** crash here; if you do, keep driving and let it run. | Vision / Gameplay |
| 0:36–0:41 | Finish the lap, results screen: position, rank movement, coins. Hold on it 3 s so the ladder reads. | Vision |
| 0:41–0:45 | Esc to the menu, show the mode list (Ranked, bonus events) and stop recording. | Feasibility / Docs |

If a take goes wrong, restart the whole 45 s. A visible mistake is cheaper than a cut.

---

## F. Order of operations for the next hour

1. **A1** — sign in and confirm a registered entry exists. Everything else is wasted if it does not.
2. **A3** — make the repo public, enable Pages, wait for the workflow, open the live URL yourself.
3. **A2** — invite `jaatster` anyway, and tick the confirmation box in the form.
4. **D1–D5** — fix the four false claims. Push. Then **re-read the SHA** for B10.
5. **B11, B12, B13** — controls, known issues, thumbnail.
6. **E** — film the 45 s take.
7. **A4** — connect Discord, finalize, **screenshot the receipt**.
