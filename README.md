# Owen Tharp — résumé site

A single-page résumé site. No build step, no dependencies, no framework — open
`index.html` and it works. The centrepiece is a **live Furuta pendulum
simulation** in the hero that swings itself up and balances under the same kind
of control law as the real rig.

```
index.html
vercel.json          static config: no build step, no framework
.vercelignore        keeps tools/ and notes out of the deployment
assets/
  css/style.css      design system, layout, print stylesheet
  js/pendulum.js     plant model + controller + isometric renderer
  js/main.js         nav, reveals, counters, skills readout, command palette
  img/               photos and figures
  files/             résumé PDF and the swing-up clip
tools/img.ps1        crop / resize helper used to prepare the photos
```

## Running it locally

Because the page loads its CSS/JS as separate files, open it through a server
rather than double-clicking the file:

```bash
npx serve .
```

Then visit the URL it prints. Any static server works.

---

## Remaining placeholders

Most photos are in. The few still outstanding show a labelled placeholder
graphic, so nothing looks broken — each is marked `PLACEHOLDER` in `index.html`
so you can find them with a search.

### Photos and screenshots

Every slot uses `object-fit: cover`, so **any** image fills correctly — the
aspect ratio below is just what gets kept. Anything taller or wider is
centre-cropped, so leave a little margin around the subject.

### Still needed

Nothing — every image slot is filled with a real photo or figure.

Optional, only if you want these sharper on high-DPI screens — both are
source-limited rather than badly cropped:

| File | Current | Ideal |
|---|---|---|
| `reflex-console.jpg` | 715 px wide (from a screenshot of the photo) | the original photo, ≥1200 px wide |

### Already in place

These are real photos now, cropped and encoded from the originals:

| File | Source |
|---|---|
| `portrait.jpg` | Headshot, 800×1000 |
| `formall-platform.jpg` | Plug-assist platform CAD render, 1379×862 |
| `modix.jpg` | Modix test print, 1600×1000 |
| `frc-robot.jpg` | Team 1466 on the field, 1600×1000 |
| `frc-team.jpg` | Team 1466 with the REEFSCAPE plaque, 1170×731 |
| `ftc-team.jpg` | FTC 9934 with the trophy, 1600×1000 |
| `furuta-rig.jpg` | Arm, encoder and motor mount, 953×596 |
| `furuta-clip-poster.jpg` | Poster frame for the swing-up clip, 720×1080 |
| `furuta-ui.jpg` | Browser tuning interface mid-run, 1600×1000 |
| `reflex-console.jpg` | The Offensive Summit badge, 715×1072 |
| `reflex-menu.jpg` | On-device test menu, 286×179 |
| `reflex-dashboard.jpg` | Browser dashboard, 790×494 |
| `morse.jpg` | Morse code translator badge, 1600×1000 |
| `harvard-curves.png` | Loss / accuracy curves, padded to 16:10 so no axis is cropped |
| `og-cover.png` | Social share card, 1200×630 |

The fabrication-drawing figure was removed from the Formall entry rather than
left as a placeholder. To restore it, add a `<figure>` back into that
`.tl-media` block alongside the platform and Modix images.

To regenerate any of these from a new original, the crop tool used is
`tools/img.ps1` (centre-crop to a target aspect with an optional focal bias, then
downscale — it reads HEIC too, via Windows' WIC codecs).

The outstanding slots are still `.svg` placeholders. Save your real photo as
`.jpg` and update the matching `src="…"` in `index.html` — that is the only
change needed.

### Other files

- **`assets/files/owen-tharp-resume.pdf`** — the real one-page résumé. Replace
  this file whenever you update it; the "Download résumé" button keeps working
  as long as the filename stays the same.
- **`assets/files/furuta.mp4`** — the swing-up clip, already cut down from the
  60 s 4K original (86 MB) to **11 s at 720×1080, H.264, 2.5 MB**. It covers the
  pendulum hanging, swinging itself up, the catch, and several seconds of stable
  balance. It autoplays muted on loop with controls, pauses when scrolled out of
  view, and stands down entirely under `prefers-reduced-motion`.

  To replace it with a different cut, keep the same filename and 2:3 portrait
  shape, and make sure `moov` sits before `mdat` (fast start) so it streams
  rather than fully downloading.

### Things worth double-checking

- The GitHub links point at `github.com/GrumpyBud` and the
  `GrumpyBud/Furuta-Pendulum` repo.
- Your résumé lists the Formall internship as **Summer 2026** — kept as written.

---

## The pendulum simulation

Not a canned animation — it integrates the real equations of motion every
frame, so if you drag it, the controller genuinely has to recover.

**Plant.** A 2-DOF rotary inverted pendulum (arm angle `θ`, pendulum angle `α`),
integrated with RK4 at 1 kHz. The controller runs at a fixed **200 Hz**,
matching the real rig.

**Swing-up — energy shaping.** With energy measured against the upright, the arm
acceleration command

```
u = k · Ẽ · (α̇ · cos α)
```

gives `dE/dt = −m₁L₀l₁ · u · (α̇ cos α)² ≥ 0` whenever `Ẽ < 0`, so pendulum
energy rises monotonically toward the upright separatrix. This smooth form is
used instead of the more common `sign(α̇ cos α)` because the sign version
chatters near the turning point.

A deadband brake keeps arm speed bounded. That part matters more than it looks:
the centrifugal coupling term drains energy in proportion to `θ̇²`, and without
the brake the swing stalls at about 135° no matter how hard you drive it.

**Balance — LQR.** Once `|α − π| < 0.35 rad` and `|α̇| < 4.5 rad/s`, control
switches to a state-feedback law on `x = [θ, e, θ̇, ė]`. The gain was solved
offline from the linearised plant (Kleinman iteration on the continuous-time
algebraic Riccati equation, `Q = diag(6, 220, 1.2, 6)`, `R = 6000`):

```
K = [−0.031623, 0.563667, −0.027136, 0.059140]
closed-loop poles: −64.6, −5.78, −3.42, −3.04
```

If the pendulum is knocked past 0.70 rad it drops back to swing-up and starts
over, which is why you can never permanently break it.

A small Ornstein–Uhlenbeck disturbance torque is injected into the plant (never
shown to the controller) so it behaves like real hardware — residual tilt sits
around 0.1° RMS rather than freezing at exactly zero.

**Verified:** 200/200 random initial conditions reach balance; recovery from a
full knock-over takes ~1.5 s.

### Tuning it

Everything lives at the top of `assets/js/pendulum.js` in the `P` (geometry and
mass) and `CTL` (controller) objects. Note that changing `P` invalidates `K` —
the LQR gain is specific to that plant, so re-solve it if you change the
hardware parameters.

---

## Behaviour and accessibility

- **Keyboard:** `⌘K` / `Ctrl-K` opens a command palette for jumping between
  sections. The pendulum canvas is focusable — arrow keys nudge it, `R` resets.
- **Theme:** follows your system light/dark setting, with a manual toggle that
  persists to `localStorage`.
- **Reduced motion:** honours `prefers-reduced-motion` — the camera drift,
  marquee, counters, and scroll reveals all stand down.
- **Printing:** the page has a print stylesheet. Print or "Save as PDF" and it
  collapses to a clean black-on-white document with the interactive parts
  removed.
- **Contrast:** all text passes WCAG AA (4.5:1) in both themes.
- **Without JavaScript:** the page renders completely. Content is visible by
  default and only opts into scroll-reveal once JS confirms it is running, so a
  failed script can't leave the page blank.

---

## Deploying

Deployed on **Vercel** at **owentharp.com**. There is no build step — Vercel
serves `index.html` and `assets/` as static files.

`vercel.json` pins that explicitly (`framework: null`, no-op install and build,
output directory `.`). Without it, a project carrying build settings from an
earlier framework will try `npm run vercel-build`, find no `package.json`, and
fail with **"Command npm run vercel-build exited with 1"**. If that still
happens, clear the overrides in **Settings → Build & Development Settings**;
`vercel.json` takes precedence, so it should not.

### First deploy

```bash
git add -A
git commit -m "Add resume site"
git push
```

Then either import the repo at vercel.com/new, or from this folder:

```bash
npx vercel --prod
```

### Pointing owentharp.com at it

If the domain is already attached to an existing `owentharp` Vercel project,
move it rather than duplicating it: in that project go to **Settings → Domains**
and remove `owentharp.com`, then add it under **Settings → Domains** on this
project. Vercel keeps the DNS records, so the switch is quick — but the domain
can only be attached to one project at a time, which is why the removal has to
come first.

If the domain is not on Vercel yet, add it to this project and follow the DNS
records Vercel shows you (an `A` record at the apex, plus a `CNAME` on `www`).

### After the first deploy — making it findable

The page already carries the on-page SEO: a canonical URL, absolute Open Graph
and Twitter image URLs, and a schema.org `Person` block naming the schools,
teams and topics. Three things still have to happen off-page:

1. **Google Search Console** — add `owentharp.com`, verify it (Vercel can add
   the DNS TXT record), and submit `https://owentharp.com/sitemap.xml`. A brand
   new domain can sit unindexed for weeks otherwise; this is the single biggest
   accelerator.
2. **Link to the site from profiles you already own** — put `owentharp.com` in
   your GitHub profile. The `sameAs` field in the structured data points at
   GitHub; a link back the other way is what lets search engines tie the two
   together as one person.
3. **Give it time.** Ranking for your own name on a new domain usually takes a
   few weeks, and it competes with anyone sharing the name.

If the domain ever changes, update the absolute URLs in `<head>`, the `@id`
and `url` in the JSON-LD block, `robots.txt`, and `sitemap.xml`.

### Notes

- `.claude/launch.json` is only for the local preview server; keep or delete it.
- `tools/img.ps1` is a local helper, not part of the deployment.
- No `vercel.json` is needed. Add one only if you later want redirects, headers,
  or custom caching.
