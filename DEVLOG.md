# Alloy — Dev Log

## Session 13 (2026-07-02) — Reliability loop, push activation, forgot-password

**Push notifications activated.** `send-push` (existing, undeployed code) is now live — deployed via CLI, and migration `0021_push_notification_webhook.sql` wires the DB trigger declaratively (`supabase_functions.http_request` on `messages` INSERT) instead of a manual dashboard webhook.

**Forgot-password flow.** New `app/(auth)/forgot-password.tsx` — email → 6-digit code (`resetPasswordForEmail` + `verifyOtp(type:'recovery')`, same pattern as create-org) → new password → done. Linked from login. Closes the dead-end where password users had zero recovery path.

**Reliability loop (pillar 3):**
- **Live coverage** — `lib/sessions.ts` `getRsvpCoverage(sessionId, orgId)` (going/not-going/no-response among non-student org members). Rendered as a track + "4 of 7 confirmed" in the calendar session detail sheet, coordinators only.
- **RSVP reminders** — new `supabase/functions/send-rsvp-reminders` (deployed): finds sessions starting in 90–150 min with `reminder_sent_at IS NULL`, pushes non-student members who haven't RSVP'd, marks reminded. Migration `0022_reliability_loop.sql` adds the column, enables `pg_cron`+`pg_net`, schedules the function every 15 min.
- **Attendance streaks** — `lib/checkin.ts` `getAttendanceStreak(userId)` (consecutive weeks with a check-in, counted back from the most recent attended week so an unstarted current week doesn't reset it). Replaces the old hours-leaderboard "Rank #1/Rookie" vanity system throughout `app/(tabs)/profile.tsx` (identity strip, stats sheet, badges, PDF certificate) with streak tiers (Just started → Building → Consistent → Dedicated → Unstoppable) — recognition tied to showing up, not hours logged.

`npx tsc --noEmit` clean throughout. **Run `migrations/0021` and `0022` in Supabase** (0022 assumes the project ref `gcveyqsnllfvnuxurnaq` for the cron→function URL — update if that ever changes). Both edge functions already deployed.

**Still open:** IA restructure (Students as a real tab, FAB shrink) — deferred, needs on-device review before building. App Store submission — in progress by user.

## Session 12 (2026-07-02) — Tenant isolation, account linking, Alloy Mentors rebrand

**Migration `0020_tenant_isolation.sql` (SECURITY — run this).** Pre-self-serve RLS leaked across orgs: students/notes/attendance/sessions/rsvps were `USING (true)` (any signed-in user, any org — minor PII included), hours were visible to leadership of ANY org, users was an open directory, and org chat had NO org column (two orgs would share one "All Members" thread). 0020: adds `messages.organization_id`, backfills all legacy NULL-org rows to ITB, drops and rebuilds policies on 11 tables — everything org-scoped via `current_org_id()`, writes restricted to members+ (`current_user_role() <> 'student'`), leadership actions org-scoped, and **student accounts can read ONLY their own linked roster row + its goals/skills/timeline** (`students.user_id = auth.uid()`). Chat client now stamps `organization_id` on sends and filters org-chat reads + realtime by org.

**Account ↔ roster linking.** `lib/progress.ts`: `listLinkableAccounts` / `getAccountById` / `linkStudentAccount`. Student screen (coordinators): an "App account" row — Not linked → bottom-sheet picker of unlinked student-role accounts in the org; linked → shows name/email with an Unlink option. This is what resolves Sarah's "My progress" on home.

**Rebrand → Alloy Mentors.** app.json (name "Alloy Mentors", slug alloy-mentors, scheme `alloymentors`, bundle/package `com.jpx.alloymentors` — safe, no App Store record existed yet), OAuth redirect scheme in login, send-email from `updates@alloymentors.com`, support emails, brand lockup tagline + onboarding title "Mentors", share messages, report footers. Only the internal QR salt keeps the old string (invisible; avoids my-qr/kiosk version skew). **Requires a fresh native build** (scheme + package changed) and the Supabase redirect URL `alloymentors://auth/callback`.

User actions: run 0020; update Supabase Auth redirect URL; Resend must verify **alloymentors.com** (senders: no-reply@ for SMTP, updates@ for the edge function); rebuild dev clients (`npx expo run:android`).

## Session 11 (2026-07-02) — Platform pivot: self-serve orgs + feature modules

**The shift:** orgs are no longer provisioned by us. Anyone (Bob) creates an organization in-app, gets shareable join codes, and configures what his program needs. The answer to "set features vs. per-org needs" is three layers: **base platform** (accounts, roles, codes, chat, announcements, calendar, profiles — every org), **feature modules** (hours, QR check-in, progress, session notes, guardian digests, gamification — admin toggles), **vocabulary** (member noun AND student noun — Tutor/Student, Coach/Athlete, Mentor/Mentee).

- **Migration `0019_self_serve_orgs.sql`** — organizations gains `org_type`, `student_noun(_plural)`, `features jsonb`, `created_by`; ITB backfilled all-on. `students.user_id` links a student ACCOUNT to a roster row (Sarah sees her own progress). Admin UPDATE policy on own org. `create_organization()` SECURITY DEFINER RPC: validates, generates unique unambiguous codes (`APP-M7K2` / `APP-S4QN`), inserts org, promotes caller to admin, returns codes.
- **`lib/features.ts`** — FEATURES registry + ORG_PRESETS (volunteer / tutoring business / sports coaching / other) + `featureEnabled()` (null features → all on, back-compat).
- **UserContext** — Org now carries orgType, studentNoun(s), features; added `refresh()`.
- **`app/(auth)/create-org.tsx`** — email → OTP → preset picker + names → RPC → codes + share sheet → dashboard. Onboarding gains "Start a new organization".
- **`app/org-settings.tsx`** (admins) — join codes with Share, feature Switch list, vocabulary editor (all four nouns). Entries: gear in Director Panel header; profile Organization row (admins → settings, members keep leave).
- **Gating pass** — FAB (Log Hours→hours, QR/kiosk→checkin, student-only trimming for role=student), home (season card + admin hours hero + pending reviews→hours; students strip→progress; chips per module), profile (Export PDF→hours, Check-In QR row→checkin), kiosk hard guard, guardian digest button→guardian_digests.
- **Student view (v1)** — role=student home: lean shortcuts + "My progress" chip when a coordinator has linked their roster row (`students.user_id`); friendly notice when unlinked. FAB shows RSVP only.

**Run in Supabase: `migrations/0019_self_serve_orgs.sql`.** Follow-ups: admin UI to link student accounts to roster rows; resolve_org_code could return student nouns for intake copy; org type presets could drive home layout more deeply.

## Session 10 (2026-07-01) — Fix batch: QR security, iMessage chat, calendar RSVP, deep profile

**Rotating branded QR (my-qr + kiosk).** Replaced the external api.qrserver.com image (generic, leaked user ids, static/abusable) with a fully local system: `lib/qrcode.ts` (vendored dependency-free QR encoder, byte mode EC-H v1–6 — **round-trip verified against the jsQR reference decoder, 4/4 payloads + center-chip occlusion up to 30% width**), `components/ui/AlloyQR.tsx` (ink runs on cream so it blends with the page, pine "A" brand chip), `lib/qr.ts` (payload `AT1.<uuid32>.<bucket36>.<sha256-sig8>` rotating every 30s via expo-crypto; kiosk accepts bucket ±1 ≈ 60–90s validity). my-qr shows a live countdown + progress track and re-signs on rotation; kiosk rejects expired codes with a friendly re-scan prompt. The duplicate stale QR modal in profile settings now routes to /my-qr.

**iMessage-style chat + migration `0018_chat_reactions_edit.sql`.** Messages gain `edited_at`/`deleted_at`; new `message_reactions` (one tapback per user per message) with RLS + realtime publication; senders can update only their own rows. UI: pine/ivory bubbles with group tails, long-press → tapback bar (❤️ 👍 👎 😂 ‼️ ❓) + Edit (own, 15-min window) / Unsend (soft delete → "You unsent a message") / Report (others); reaction pills overlap the bubble corner; "Edited" captions; live reaction + edit/unsend updates over realtime. channelRef/typing/blocking/read-receipts untouched.

**Calendar.** Today is now a solid pine circle (cream numeral) in both the week strip and month grid (was a faint dashed outline). The session detail sheet gains real RSVP buttons (getMyRsvp/setMyRsvp), and the FAB "RSVP to Session" deep-links (?rsvp=1) to open the next upcoming session's sheet — previously it just landed on the calendar and read as broken.

**Log Hours redesign (modal.tsx).** Duration chips + 0.25-step stepper (no keyboard), last-14-days date strip (no more typing YYYY-MM-DD), activity-type chips (prefixed into the description as "[Type] …" — no schema change), 240-char note with counter, live summary line, solid pine submit.

**Profile depth.** Edit now opens `app/edit-profile.tsx` — full editor (identity, contact, institution, subjects/languages/availability/t-shirt via lib/intake option sets, emergency contact) with unsaved-changes guard; profile refetches on focus. **Email change now requires a 6-digit code** (auth.updateUser → verifyOtp type email_change; needs SMTP + `{{ .Token }}` in the Email Change template). The Role row opens `app/org-tree.tsx` — the whole org as a hierarchy (Admins → President → VPs → Directors → Mentors → Students) with connector rails, counts, role chips, "(You)" marker.

**Intake.** Phone + School/Institution now required for members (labels marked *).

**Tap-out everywhere.** Every popup dismisses by tapping empty space: home overlays + session detail, calendar detail + add sheet, chat new-chat/report/action sheets, announcement composer, my-pairing profile sheet, profile email modal (admin + stats already had it).

**Resend skeleton.** `supabase/functions/send-email/index.ts` — POST {to,subject,html} → Resend API, reads RESEND_API_KEY from secrets, from updates@alloytutors.com. Undeployed until the key is set.

**Run in Supabase: `migrations/0018_chat_reactions_edit.sql`.** Device tests: QR scan round-trip (two phones), reaction/edit/unsend live sync. `npx tsc --noEmit` clean.

---

## Session 9 (2026-07-01) — Product rethink: student progress (Phase 1)

Reframed Alloy from an hour-tracker into a **tutoring-relationship OS** centered on **student progress** (the "missing soul" + the licensing moat). See memory `alloy-product-direction`.

- **Migration `0016_student_progress.sql`** — `student_goals` (title/subject/status/target+completed checkpoints), `student_skills` (name + 0–3 mastery, unique per student), and `student_notes` gains `title` / `marker` / `goal_id` so notes render as a growth timeline. RLS: org members read + record progress (`current_org_id()`).
- **`lib/progress.ts`** — goals (create/bump/status, auto-achieve at target), skills (upsert/cycle level), timeline (`listTimeline`), and `logProgress()` which writes a timeline entry and advances the linked goal in one flow.
- **`app/student/[id].tsx`** — the flagship: identity + safety flag, a pine "current goal" card with progress, a skills mastery grid (tap to cycle, elevated), a growth timeline (marker-coloured dots), a details section, and a sticky "Log today's session" CTA. Log / set-goal / add-skill sheets.
- Wiring: `students.tsx` roster row and `my-pairing.tsx` card header now drill into `/student/[id]` (removed the old inline detail modal from the roster). Route registered in `app/_layout.tsx`.
- Also (session 8.5): calendar header restructured (title was wrapping "Sc/he/dul/e"), FAB leadership actions → pine (were illegible titanium), tab bar floats (absolute), status bar → dark, FAB menu centered + stronger blur.

`npx tsc --noEmit` clean. **Run `migrations/0016_student_progress.sql` in Supabase.**

**Phase 2 — outcome reports.** `lib/reports.ts` `buildStudentReportHtml` → editorial PDF (org header, summary stats, current/achieved goals, skills table, growth timeline) via `expo-print`, shared through the OS share sheet. Export button added to the student screen top bar. The artifact a program hands a funder/school.

**Phase 3 — guardian digests.** `buildGuardianDigestHtml` — a warm, jargon-free "how your child is doing" note → PDF + share ("Send … a progress update" button in the student details). Works today via the device share sheet; automated emailing awaits SMTP. Migration `0017_student_guardian_email.sql` adds `students.guardian_email` + a field in add-student + `createStudent`.

**Home integration.** A **"Your students"** strip on the home page (`myStudentsWithGoals`) lists the tutor's paired students with their active-goal progress, each one tap from `/student/[id]`. Surfaces the whole progress system from home (start of the "Today" reframe). `npx tsc --noEmit` clean. **Also run `0017`.**

---

## Session 8 (2026-06-30) — Rebrand to Alloy Tutors + multi-org licensing

Rebranded **Alloy Volunteers/Volunteer Connect → Alloy Tutors** (domain alloytutors.com) and made the app generic across licensed organizations (ITB is now just the first tenant, not special).

**Rebrand / identity**
- `app.json`: name "Alloy Tutors", slug `alloy-tutors`, scheme `alloytutors`, bundleId/package `com.jpx.alloytutors`, splash + adaptive-icon bg → cream `#F2ECDE`.
- `login.tsx` OAuth `makeRedirectUri` scheme `alloy` → `alloytutors` (was mismatched with app.json — latent bug, now consistent).
- Brand tagline "Volunteer Connect" → "Tutors"; onboarding hero, profile version string, support email → `support@alloytutors.com`.

**Multi-org licensing (migration `0015_multi_org_licensing.sql`)**
- `organizations` gains `member_code`, `student_code` (per-org join codes, unique case-insensitive) and `member_noun`/`member_noun_plural` (each org's word for a tutor). ITB backfilled: codes ITB-M/ITB-S, noun **"Mentor"**.
- `resolve_org_code(text)` RPC — anon-callable (onboarding is pre-auth), SECURITY DEFINER so it resolves a held code without exposing the org table. Plus an own-org SELECT policy so members can read their org's name/label.
- `lib/org.ts` `resolveOrgCode` is now **async** → DB lookup (was hard-coded ITB-M/ITB-S). `RememberedOrg` carries `orgId` + nouns; onboarding→login→intake thread `orgId`/`memberNoun`; intake writes `organization_id` directly (no name lookup).

**Per-org labels**
- `UserContext` now exposes `org` = `{ id, name, memberNoun, memberNounPlural }`.
- `roleLabel(role, subject, memberNoun?)` defaults to "Tutor"; threaded `org.memberNoun` in profile/admin/my-qr.
- ITB-specific copy made dynamic: certificate ("Tutoring Hours Confirmation", org name), chat ("All {membersLabel}", "{orgName} admins"), kiosk ("Scan {noun} QR", "{plural} in"), index ("Total {noun} Hours"), profile org row.

`npx tsc --noEmit` clean.

**Manual steps for the user:**
1. Run **`migrations/0015_multi_org_licensing.sql`** in Supabase.
2. Supabase → Auth → URL Configuration → add redirect URL **`alloytutors://auth/callback`** (new scheme).
3. When licensing a new org: insert an `organizations` row with its own `member_code`/`student_code`/`member_noun`.
4. New `bundleIdentifier`/`package` = fresh app identity for EAS builds (fine — not published yet).

---

## Session 7 (2026-06-30) — UI reskin: "cream & pine, editorial"

Replaced the dark liquid-metal / diamond-black + platinum-glass skin with a calm, paper-like **cream & pine** editorial look. Same content and layout — just a calmer surface.

**Source of truth** — `lib/theme.ts`: kept every token *name* but repointed it (dark→light inversion), so screens + components inherit the skin.
- `base` cream `#F2ECDE`, `surface` ivory `#FBF6EC`, `surfaceStrong` `#FFFDF7`; `text` ink `#22271F`, `textDim/Faint/Ghost` = `rgba(34,39,31,·)`; `hairline` = `rgba(43,70,56,·)` pine.
- `platinum` is now **pine `#375946`** (primary accent). Status: `mint` pine `#3E6A52`, `gold` ochre `#B08A3E`, `rose` clay `#B15A4E`, `sky`/`iris` slate `#5E7488`. `alloyGradient` = pine `['#4A7059','#375946','#284035']`.

**Components** — `AuroraBackground` now a cream field with soft sage/pine washes (no facets/veil); `GlassCard` is a **flat** ivory tile + pine hairline + soft lift (BlurView removed); `GlassButton` = pine fill/cream label or ivory/pine; `GlassInput` = ivory + pine focus + ink text (blur removed).

**Screens** — recolored via a property-aware codemod (`recolor.js`/`recolor2.js` in scratchpad), then hand-fixed edge cases:
- `color:` whites → ink; low-alpha white borders/tracks → pine hairline; `backgroundColor:` whites → ivory.
- Emerald `#10b981`/`#6ee7b7` family → pine; purple → slate; gold/amber → ochre; red/rose → clay.
- Dark bottom-sheets, menus, the **tab-bar pill**, and announcement **banners** → light tints (they hosted ink text → were unreadable).
- **Every `BlurView tint="dark"` → `"light"`** (a dark blur over a light surface muddies it back to gray).
- Active/inactive splits fixed (RSVP menu, calendar day numbers, chat tabs, member roles); cream text/icons kept only on solid-pine fills (send button, checkboxes, FAB, CTAs).

`npx tsc --noEmit` clean. Not yet visually verified on device.

---

## Session 6 (2026-06-18) — App-wide bug audit + fixes

Ran a 6-agent parallel audit (75 findings); fixed the real user-facing/data issues.

**Data bugs**
- Home + Profile "Students" counted the legacy `assignments` table (always 0 / errors) → now counts distinct paired students from `session_attendance`.
- Home org stats (hours/members/pending) now scoped to `organization_id` (were global across orgs).
- Announcements scoped to org (migration **0013** adds `announcements.organization_id`; modal sets it, banner filters by it, `.single()`→`.maybeSingle()`).

**Dead buttons / toggles (profile)** — wired Help Center, Contact Support, Request Data Export (mailto), Privacy/Terms (links), Rate the App (alert); removed the no-op Auto-Dark-Mode toggle; Push-Notifications toggle now persists (AsyncStorage); Role row no longer shows a fake chevron; misleading weekly-trend caret fixed.

**Chat** — bidirectional blocking (blocked users hidden + their messages filtered both ways); removed the dead settings menu + no-op "Mute"; report/ block now surface errors (no more false "Reported"); report disabled on unsent messages; read-receipts only attempted on DMs; typing indicator resets per chat; group fetch null-guarded.

**Validation** — Log Hours (positive hours, YYYY-MM-DD date, required description); Create Event (real date-range check, end-after-start, org guard); Add Student birthday rejects impossible dates.

**Role gates** — Kiosk and Admin (Director Panel) now guard by role in-screen, not just at the launcher. Admin: rejected status now rose (was green = looked approved); decisions refetch stats; manual hours use the target's org; can't change your own role / only admins grant admin.

**Intake/auth** — Google OAuth uses `makeRedirectUri` (was hard-coded localhost); dev redirect box gated to `__DEV__`; `completeVolunteerIntake` errors on missing org + surfaces consent-insert failures; minor guardian-required consents enforced; `orgIdByName` no longer string-builds a PostgREST filter.

**Rosters/pairing** — add-note errors surfaced (both roster + pairing); My Pairing live-refetches via realtime + focus and clamps the pager; My QR guards empty profile; kiosk "Check in by name" actually switches to the list.

**Migrations to run:** **0013** (new). Prior: 0010, 0011, 0012 if not yet applied.

**Deferred (need product decisions, not bugs):** light-theme system, real address autocomplete, org-configurable annual goal, RSVP from the calendar detail sheet, real Privacy/ToS documents, deleting the orphaned `signup.tsx` (intake.tsx is canonical).

---

## Session 5 (2026-06-18) — Design overhaul, OTP intake, consent, fixes

### Chat "All Mentors" red error — fixed
- `handleTyping` created a 2nd Supabase channel with the same topic as the subscribed one → realtime-js "tried to subscribe multiple times". Now reuses the subscribed channel via `channelRef`.

### Design system → diamond-black + platinum (research-driven)
- `lib/theme.ts`: base → `#08090C`; facet tokens, platinum glass tokens (`surface` now `rgba(228,232,238,0.10)`), `catchLight` 0.45, `scrim` `rgba(6,8,12,0.66)`.
- `AuroraBackground.tsx`: darker metal blobs + a pure-RN faceted "black diamond" overlay (`DiamondFacets`, no SVG dep) above the single blur + drifting sheen.
- `GlassCard.tsx`: platinum frost (blur 20, deeper bottom shade); fill carries the look even when Android blur is off.

### Popup layering bug — root cause + fix
- Cause (traced in code): modals wrapped a `GlassCard` (own light BlurView) inside a **dark BlurView scrim** → nested-blur averaging → muddy gray (worse on Android). Fix: scrims are now **solid dim Views** (`colors.scrim`), one blur per stacking context. Applied to CreateAnnouncementModal + home + profile + calendar modals.

### Email-verified OTP intake (NEW)
- `lib/intake.ts`: 6-digit OTP, option sets, `VOLUNTEER_CONSENTS` (7 sample docs + disclaimer), `completeVolunteerIntake` writes the full profile into `public.users` + records consents in `user_consents`.
- `app/(auth)/intake.tsx`: email → 6-digit code → rich form (identity, skills/availability chips, logistics, emergency contact, **minor branch** w/ required guardian section, consents). Login "Create account" routes here. **Also fixes name-not-loading** for new users (writes full_name/org_id directly).

### Student intake (richer) + Profile email-change + Kiosk manual entry
- `add-student.tsx`/`lib/checkin.ts`: subjects-help chips, English level, interpreter, allergies, emergency contact, transportation, guardian relationship, consent toggles. Immigration status intentionally omitted; sensitive-field column-gating = follow-up.
- Profile → Email opens a dedicated **Change Email** modal (`auth.updateUser`).
- Kiosk scanner has a **"Can't scan? Check in by name"** fallback → searchable list.

### Migration `0009_intake_and_consents.sql`
- Volunteer + student intake columns; `user_consents` table + RLS.

### To activate Session 5
1. Run **`0008`** (if not yet) and **`0009`** in Supabase (each one paste).
2. **OTP email:** Supabase → Auth → Email Templates → Magic Link → ensure body includes `{{ .Token }}` so the 6-digit code appears.
3. Consent text is **sample/template, not legal advice** — attorney review required.

---

## Session 4 (2026-06-18) — UI polish pass + chat fix

### Chat engine + "All Mentors" red error
- **Engine:** Supabase Realtime (Postgres rows + WebSocket `postgres_changes` / `presence` / `broadcast`). Not a third-party chat SDK.
- **Bug:** `handleTyping` created a **second** `supabase.channel('chat_org')` with the same topic as the already-subscribed channel, then `.send()` on it → realtime-js throws "tried to subscribe multiple times". Fired on first keystroke in any chat (org chat most visibly).
- **Fix:** Store the subscribed channel in `channelRef` and reuse it for typing broadcasts. `app/(tabs)/chat.tsx`.

### Home page (`app/(tabs)/index.tsx`)
- Greeting card de-grayed → real glass: transparent fill + `intensity=40` light blur + top catch-light + bottom shade (was a muddy 6% gray slab).
- New **Quick Actions** row: Log Hours · My QR · Schedule.
- New **This Season** snapshot card: Sessions Attended / Hours This Month / Students Paired (new queries: `session_attendance` count, month-filtered hours).
- Existing stat cards relabeled "Your Totals".

### Calendar (`app/(tabs)/calendar.tsx`)
- **Month toggle fixed:** replaced the cycling `toggleView` (day→week→month needed multiple taps) with a direct **Week | Month segmented control** (`setView`) — one tap.
- Header cluster cleaned: compact **Today** pill + segmented toggle + add button, all metallic (platinum/silver, de-greened). Removed the cramped "Jump to Today" text.

### Aurora background (`components/ui/AuroraBackground.tsx`)
- More brushed-metal: added a graphite lower-sheen blob, shifted accents toward steel/chrome, reduced the cool titanium tint, and added a slow `BrushedSheen` vertical highlight band drifting across — subtle machined-metal feel.

### Add Student (`app/add-student.tsx` — full rewrite)
- **Photo:** take/upload via `expo-image-picker` → uploaded to Supabase Storage `student-photos` bucket → public URL stored (`uploadStudentPhoto` in `lib/checkin.ts`).
- First/Last name as a **row**. Grade + Birthday as a **row** (birthday MM/DD/YYYY → stored as `date`).
- Separate **School** and **Home/Preferred Language** fields (language matters for refugee students).
- Optional **Gender** segmented, **Guardian Name + Phone** row (phone validated), **Notes** (allergies/accommodations) multiline.

### FAB "+" menu (`app/(tabs)/_layout.tsx`)
- Added for everyone: **My Check-In QR** (→ new `app/my-qr.tsx` screen showing personal `ALLOY:<id>` QR) and **RSVP to Session** (→ calendar).

### Migration `0008_demo_admin_sample_student_fields.sql`
- Promotes `jpx465.co+demo@gmail.com` to **admin** (all-access).
- Seeds a sample session **Sat June 20 2026, 10:00–12:30**, "Saturday Tutoring — Riverside Park" for ITB.
- Adds student columns: `school, birthday, photo_url, gender, language, guardian_name, guardian_phone, notes`.
- Creates public `student-photos` storage bucket + RLS policies.

### To activate Session 4
1. **Run `migrations/0008_…sql`** in Supabase (one paste).
2. `expo-camera` + `expo-image-picker` are bundled in **Expo Go** — QR scan & photo picker work without a custom rebuild.

---

## Session 3 (2026-06-17)

### 5 — Calendar Month-View Navigation Arrows
- **File:** `app/(tabs)/calendar.tsx`
- **What changed:**
  - Added `goToPrevMonth` / `goToNextMonth` helpers (set `selectedDate` to first of prev/next month)
  - Added a navigation row inside the month GlassCard above the weekday headers: `‹ Month Year ›`
  - Tapping `‹` / `›` moves one month back/forward without leaving month view
  - The subtitle in the page header already reflected the selected month — no additional changes needed

---

### 6 — Leave Group UI
- **File:** `app/(tabs)/chat.tsx`
- **What changed:**
  - Added `leaveGroup()` function: confirms via `Alert`, then deletes the user's row from `group_chat_members`, closes the chat thread, and refreshes the group list
  - Added `···` button to the **right side of the chat thread header** for DM and group chats (not org chat)
    - Group chat → triggers `leaveGroup()`
    - DM → triggers block-user confirm alert → `blockUser()`
  - No migration needed — `group_chat_members` delete policy already existed (added in 0007)

---

## Session 2 (2026-06-17)

### Supabase RLS Fix (Migration 0006)
- **Problem:** `users` table returning 500 "stack depth exceeded" on every read
- **Cause:** `current_org_id()`, `is_leadership()`, `can_create_events()` all queried `public.users` but were used inside `users` RLS policies → infinite recursion
- **Fix:** Added `SECURITY DEFINER SET search_path = public` to all three helper functions
- **Migration:** `migrations/0006_fix_rls_recursion.sql`
- **Verified:** All 8 tables (`users`, `organizations`, `sessions`, `session_rsvps`, `students`, `session_attendance`, `hours_logs`, `announcements`) return HTTP 200

---

### 1 — QR Scanning at Check-In Kiosk
- **Package:** `expo-camera` (installed via `npx expo install expo-camera`)
- **File:** `app/kiosk.tsx`
- **What changed:**
  - Added `CameraView` + `useCameraPermissions` from `expo-camera`
  - In Volunteers mode, a **"Scan Volunteer QR"** button appears above the list
  - Tapping it requests camera permission, then opens a full-screen camera overlay
  - Reads QR codes in `ALLOY:<uuid>` format (same format the volunteer's Profile screen generates)
  - On successful scan: looks up the volunteer, calls `checkInVolunteer()`, shows confirm alert with "Scan next" / "Done" options
  - Invalid QR or unknown volunteer shows error with retry option
- **Note:** Requires a native rebuild (`npx expo run:ios` or `npx expo run:android`) — camera is a native module, won't work in Expo Go

---

### 2 — Calendar UX Fix
- **File:** `app/(tabs)/calendar.tsx`
- **What changed:**
  - Fixed a bug where `contentOffset.y` was used instead of `contentOffset.x` in `onMomentumScrollEnd` — caused the strip to snap back to position 0 randomly after horizontal scrolling
  - Changed `snapToInterval` from `ITEM_WIDTH * 7` (full-week jumps) to `ITEM_WIDTH` (single-day) so dragging is smooth
  - On tab focus and on view mode toggle, strip now scrolls to `todayIndex - 2` so today appears ~2 days from the left edge (shows ~2 past days + ~4 upcoming days)

---

### 3 — Push Notifications
- **Files:** `contexts/UserContext.tsx`, `supabase/functions/send-push/index.ts`
- **Migration:** `migrations/0007_group_chats_push.sql` (adds `expo_push_token` column to `users`)
- **What changed:**
  - Moved push token registration out of `chat.tsx` into `UserContext` — now fires automatically on every sign-in, not just when the chat tab is opened
  - Added `Notifications.setNotificationHandler` so alerts appear while the app is in the foreground
  - Token is stored in `users.expo_push_token` on every login
  - Created Supabase Edge Function at `supabase/functions/send-push/index.ts`:
    - Triggered by a Database Webhook on `messages INSERT`
    - Sends Expo push notification to DM recipient or all group chat members (excluding sender)
    - Skips org-wide chat to avoid spam
- **To deploy Edge Function:**
  ```bash
  npx supabase functions deploy send-push --no-verify-jwt
  ```
  Then: Supabase Dashboard → Database → Webhooks → create hook on `messages` INSERT → point to the Edge Function URL

---

### 4 — Custom Group Chats + DMs
- **File:** `app/(tabs)/chat.tsx` (full rewrite)
- **Migration:** `migrations/0007_group_chats_push.sql`

#### Database changes (0007)
| Table | Change |
|---|---|
| `users` | Added `expo_push_token text` |
| `group_chats` | New table: `id`, `name`, `organization_id`, `created_by`, `created_at` |
| `group_chat_members` | New table: `group_chat_id`, `user_id`, `joined_at` (composite PK) |
| `messages` | Added `group_chat_id uuid` FK → `group_chats` |
| `messages` RLS | Updated SELECT policy to scope group-chat messages to members only |

#### Chat screen changes
- Chat list now shows three sections: **Org Chat → Groups → Direct Messages**
- **"+" button** opens a bottom sheet with a toggle:
  - **Direct Message tab** — search members, tap to open DM (same as before)
  - **New Group tab** — enter group name + multi-select members → "Create Group" button
- Group creation: inserts into `group_chats` + `group_chat_members` (creator auto-added), then opens the new group immediately
- Message routing:
  - Org chat: `receiver_id IS NULL AND group_chat_id IS NULL`
  - DM: `receiver_id = userId AND group_chat_id IS NULL`
  - Group chat: `group_chat_id = groupId`
- Realtime subscriptions, typing indicators, date dividers, read receipts, PII warning, report/block — all work per chat type
- Removed push notification registration code from this file (moved to UserContext)

---

### Android Setup
- Android SDK is on the external SSD at `/Volumes/JPX_Beta_Mac_Ext/SDKs + XCODE Data/AndroidSDK`
- Android Studio is at `/Volumes/JPX_Beta_Mac_Ext/Applications/Android Studio.app`
- Added to `~/.zshrc`:
  ```bash
  export ANDROID_HOME='/Volumes/JPX_Beta_Mac_Ext/SDKs + XCODE Data/AndroidSDK'
  export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
  ```
- `adb` confirmed working (`adb version 1.0.41`)
- To build for Android: open a new terminal then `npx expo run:android` (with phone plugged in + USB debugging on)

---

## Migrations Needed (run in order in Supabase SQL Editor)

| File | Status | Notes |
|---|---|---|
| `migrations/0001_roles_and_org.sql` | ✅ Run | Must run PART 1 then PART 2 separately |
| `migrations/0002_sessions_rsvp.sql` | ✅ Run | |
| `migrations/0003_students_checkin_matching.sql` | ✅ Run | |
| `migrations/0004_hours.sql` | ✅ Run | |
| `migrations/0005_announcements_elevated.sql` | ✅ Run | |
| `migrations/0006_fix_rls_recursion.sql` | ✅ Run | Critical RLS fix |
| `migrations/0007_group_chats_push.sql` | ✅ Run | Group chats + push token |

---

## Known Follow-ups
- **QR scanning** needs a native rebuild before it works (`npx expo run:ios` or `npx expo run:android`) — not available in Expo Go
- **Push Edge Function** needs to be deployed + webhook wired in Supabase Dashboard:
  ```bash
  npx supabase functions deploy send-push --no-verify-jwt
  ```
  Then: Supabase Dashboard → Database → Webhooks → create hook on `messages` INSERT → point to Edge Function URL
- **Push notifications**: not tested end-to-end yet (need Edge Function deployed first)
- ~~Calendar month-view navigation arrows~~ ✅ Done (Session 3)
- ~~Leave group UI~~ ✅ Done (Session 3)
