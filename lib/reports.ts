import { SKILL_LEVELS, type StudentGoal, type StudentSkill, type TimelineEntry } from '@/lib/progress';

// Shared print palette (works on white paper, on-brand)
const INK = '#1E2A22';
const PINE = '#2C4A39';
const PINE_MID = '#3E6A52';
const SAGE = '#6E7C6F';
const PAPER = '#F7F2E8';

function esc(s?: string | null): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

type ReportInput = {
  orgName: string;
  memberNoun: string;
  student: any;
  goals: StudentGoal[];
  skills: StudentSkill[];
  timeline: TimelineEntry[];
  today: string; // pass in (Date is unavailable in some contexts)
};

/**
 * The coordinator-facing OUTCOME REPORT — the artifact a program hands to a
 * school or funder to prove students are actually learning. Editorial, factual.
 */
export function buildStudentReportHtml(i: ReportInput): string {
  const name = esc(i.student?.full_name || 'Student');
  const sub = [i.student?.grade, i.student?.school].filter(Boolean).map(esc).join(' · ');
  const active = i.goals.find((g) => g.status === 'active');
  const achieved = i.goals.filter((g) => g.status === 'achieved');
  const mastered = i.skills.filter((s) => s.level >= 3).length;
  const first = i.timeline.length ? i.timeline[i.timeline.length - 1].created_at : null;
  const last = i.timeline.length ? i.timeline[0].created_at : null;
  const span = first && last ? `${fmtShort(first)} – ${fmtShort(last)}` : '—';

  const goalPct = active ? Math.round((active.completed_checkpoints / active.target_checkpoints) * 100) : 0;

  const stat = (n: string | number, l: string) =>
    `<div style="flex:1;text-align:center;padding:14px 6px;"><div style="font-size:28px;font-weight:bold;color:${PINE};">${n}</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${SAGE};margin-top:4px;">${l}</div></div>`;

  const skillRows = i.skills.length
    ? i.skills.map((s) => `<tr><td style="padding:8px 0;border-bottom:1px solid #E7E0D2;">${esc(s.name)}</td><td style="padding:8px 0;border-bottom:1px solid #E7E0D2;text-align:right;color:${s.level >= 3 ? PINE_MID : SAGE};font-weight:${s.level >= 3 ? 'bold' : 'normal'};">${SKILL_LEVELS[s.level]}</td></tr>`).join('')
    : `<tr><td style="padding:8px 0;color:${SAGE};">No skills tracked yet.</td></tr>`;

  const goalBlock = active
    ? `<div style="background:${PAPER};border-radius:10px;padding:18px 20px;margin:8px 0 22px;">
         <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${SAGE};">Current goal</div>
         <div style="font-size:18px;font-weight:bold;color:${INK};margin-top:4px;">${esc(active.title)}${active.subject ? ` <span style="color:${SAGE};font-weight:normal;font-size:14px;">· ${esc(active.subject)}</span>` : ''}</div>
         <div style="height:8px;background:#E7E0D2;border-radius:5px;overflow:hidden;margin-top:12px;"><div style="width:${Math.max(goalPct, 3)}%;height:100%;background:${PINE_MID};"></div></div>
         <div style="font-size:13px;color:${SAGE};margin-top:8px;">${active.completed_checkpoints} of ${active.target_checkpoints} checkpoints reached (${goalPct}%)</div>
       </div>`
    : '';

  const achievedBlock = achieved.length
    ? `<p style="font-size:14px;line-height:1.7;margin:0 0 22px;"><b>Goals achieved:</b> ${achieved.map((g) => esc(g.title)).join(', ')}.</p>`
    : '';

  const timelineRows = i.timeline.length
    ? i.timeline.map((t) => `
        <div style="margin-bottom:16px;padding-left:14px;border-left:2px solid #E7E0D2;">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-weight:bold;font-size:14px;color:${INK};">${esc(t.title || 'Session note')}</span>
            <span style="font-size:12px;color:${SAGE};">${fmtDate(t.created_at)}</span>
          </div>
          <div style="font-size:13.5px;line-height:1.6;color:#3d463c;margin-top:3px;">${esc(t.content)}</div>
          ${t.author_name ? `<div style="font-size:12px;color:${SAGE};margin-top:3px;">— ${esc(t.author_name)}</div>` : ''}
        </div>`).join('')
    : `<p style="color:${SAGE};">No sessions logged yet.</p>`;

  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="font-family:Georgia,'Times New Roman',serif;color:${INK};margin:0;padding:48px 46px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${PINE};padding-bottom:16px;">
      <div>
        <div style="font-size:12px;letter-spacing:4px;color:${SAGE};">${esc(i.orgName.toUpperCase())} · ALLOY MENTORS</div>
        <div style="font-size:25px;font-weight:bold;margin-top:6px;">Student Progress Report</div>
      </div>
      <div style="text-align:right;font-size:12px;color:${SAGE};">Issued<br/><b style="color:${INK};">${esc(i.today)}</b></div>
    </div>

    <div style="margin-top:22px;">
      <div style="font-size:22px;font-weight:bold;">${name}</div>
      <div style="font-size:14px;color:${SAGE};margin-top:2px;">${sub || 'Student'}</div>
    </div>

    <div style="display:flex;margin:22px 0;border:1px solid #E7E0D2;border-radius:10px;">
      ${stat(i.timeline.length, 'Sessions')}
      ${stat(mastered, 'Skills mastered')}
      ${stat(achieved.length, 'Goals achieved')}
    </div>
    <p style="font-size:13px;color:${SAGE};margin:-8px 0 22px;">Progress recorded ${span}.</p>

    ${goalBlock}
    ${achievedBlock}

    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${PINE};margin-bottom:6px;">Skills</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:26px;">${skillRows}</table>

    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${PINE};margin-bottom:12px;">Growth timeline</div>
    ${timelineRows}

    <p style="font-size:11px;color:${SAGE};margin-top:40px;border-top:1px solid #E7E0D2;padding-top:14px;">
      Generated by Alloy Mentors for ${esc(i.orgName)}. Session notes are recorded by ${esc(i.memberNoun.toLowerCase())}s at the time of tutoring.
    </p>
  </body></html>`;
}

/**
 * The GUARDIAN DIGEST — a warm, plain-language note home. No jargon, no metrics
 * tables; just "here's how your child is doing and what they worked on."
 */
export function buildGuardianDigestHtml(i: ReportInput): string {
  const first = esc((i.student?.full_name || 'your child').split(' ')[0]);
  const active = i.goals.find((g) => g.status === 'active');
  const recent = i.timeline.slice(0, 4);
  const masteredNames = i.skills.filter((s) => s.level >= 3).map((s) => esc(s.name));

  const highlights = recent.length
    ? recent.map((t) => `<li style="margin-bottom:10px;line-height:1.6;"><b>${fmtShort(t.created_at)}:</b> ${esc(t.content)}</li>`).join('')
    : `<li style="color:${SAGE};">We'll share highlights here after ${first}'s next few sessions.</li>`;

  const goalLine = active
    ? `<p style="font-size:15px;line-height:1.7;">Right now ${first} is working on <b>${esc(active.title)}</b>, and is <b>${Math.round((active.completed_checkpoints / active.target_checkpoints) * 100)}%</b> of the way there. Every session builds on the last.</p>`
    : `<p style="font-size:15px;line-height:1.7;">${first} has been showing up and putting in the work — we're proud of the effort.</p>`;

  const masteredLine = masteredNames.length
    ? `<p style="font-size:15px;line-height:1.7;">Skills ${first} has really gotten the hang of: <b>${masteredNames.join(', ')}</b>.</p>`
    : '';

  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="font-family:Georgia,'Times New Roman',serif;color:${INK};margin:0;padding:48px 44px;">
    <div style="font-size:12px;letter-spacing:4px;color:${SAGE};">${esc(i.orgName.toUpperCase())}</div>
    <div style="font-size:26px;font-weight:bold;margin-top:6px;">How ${first} is doing</div>
    <div style="font-size:13px;color:${SAGE};margin-top:4px;">${esc(i.today)}</div>

    <p style="font-size:15px;line-height:1.7;margin-top:24px;">Hello,</p>
    <p style="font-size:15px;line-height:1.7;">We wanted to share a quick update on ${first}'s tutoring.</p>

    ${goalLine}
    ${masteredLine}

    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${PINE};margin:24px 0 10px;">Recent sessions</div>
    <ul style="font-size:14.5px;padding-left:20px;margin:0;">${highlights}</ul>

    <p style="font-size:15px;line-height:1.7;margin-top:24px;">Thank you for getting ${first} to sessions — it makes all the difference. Please reach out anytime.</p>
    <p style="font-size:15px;line-height:1.7;">— The ${esc(i.orgName)} team</p>
  </body></html>`;
}
