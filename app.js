/* Moral Switch — browser-only app. No build step, no dependencies.
 * Verdicts: POST https://gen.pollinations.ai/alpha/decisions (model typesafe/jev-1.13)
 * Sign-in:  Pollinations "Bring your own Pollen" — OAuth authorization-code flow + PKCE.
 *           https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md
 */
'use strict';

const CLIENT_ID = 'pk_zCF9TXMoUWvHNZ55';
const AUTHORIZE_URL = 'https://enter.pollinations.ai/authorize';
const TOKEN_URL = 'https://enter.pollinations.ai/api/oauth/token';
const USERINFO_URL = 'https://enter.pollinations.ai/api/oauth/userinfo';
const BALANCE_URL = 'https://gen.pollinations.ai/account/balance';
const DECISIONS_URL = 'https://gen.pollinations.ai/alpha/decisions';
const REDIRECT_URI = location.origin + location.pathname;

const $ = (id) => document.getElementById(id);

/* ---------------- OAuth: authorization code + PKCE ---------------- */

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes.buffer);
}

async function startSignIn() {
  try {
    const verifier = randomToken(32);
    const state = randomToken(16);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem('ms_oauth_verifier', verifier);
    sessionStorage.setItem('ms_oauth_state', state);
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'profile usage',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    location.href = `${AUTHORIZE_URL}?${q}`;
  } catch (err) {
    showAuthError('Could not start sign-in in this browser (crypto unavailable?). ' + err.message);
  }
}

async function exchangeCode(code, state) {
  const verifier = sessionStorage.getItem('ms_oauth_verifier');
  const savedState = sessionStorage.getItem('ms_oauth_state');
  if (!verifier || !savedState || state !== savedState) {
    showAuthError('Sign-in state mismatch — possible CSRF. Nothing was exchanged; try signing in again.');
    return;
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    showAuthError('Sign-in failed: ' + (data.error_description || data.error || res.status));
    return;
  }
  sessionStorage.setItem('ms_token', data.access_token);
  sessionStorage.removeItem('ms_oauth_verifier');
  sessionStorage.removeItem('ms_oauth_state');
  history.replaceState(null, '', REDIRECT_URI);
  await afterSignIn();
}

function showAuthError(msg) {
  const box = $('errorBox');
  box.hidden = false;
  box.innerHTML = '<strong>Sign-in:</strong> ' + escapeHtml(msg);
}

async function afterSignIn() {
  token = sessionStorage.getItem('ms_token');
  if (!token) return renderSignedOut();
  let name = null, pic = null;
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) { const u = await res.json(); name = u.preferred_username || u.name || null; pic = u.picture || null; }
    if (res.status === 401) { return renderSignedOut(); }
  } catch (e) { /* userinfo optional */ }
  let pollen = null;
  try {
    const res = await fetch(BALANCE_URL, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) { const b = await res.json(); pollen = (b.accountBalance && b.accountBalance.total) != null ? b.accountBalance.total : b.balance; }
  } catch (e) { /* balance optional */ }
  renderSignedIn(name, pic, pollen);
}

function renderSignedIn(name, pic, pollen) {
  $('authBox').innerHTML =
    '<div class="user-chip">' +
      (pic ? `<img src="${escapeAttr(pic)}" alt="">` : '') +
      '<div><span class="uname">' + escapeHtml(name || 'Signed in') + '</span>' +
      '<span class="pollen">' + (pollen != null ? 'Pollen: ' + Number(pollen).toFixed(3) : 'Pollen balance unavailable') + '</span></div>' +
      '<a href="#" class="signout-link" id="signOutLink">sign out</a>' +
    '</div>';
  $('signOutLink').addEventListener('click', (e) => { e.preventDefault(); signOut(); });
  $('runBtn').disabled = false;
  $('runNote').textContent = 'Live — each verdict costs about 0.0001 Pollen, billed to your balance.';
}

function renderSignedOut() {
  token = null;
  sessionStorage.removeItem('ms_token');
  $('authBox').innerHTML =
    '<button id="signInBtn" class="btn btn-primary">Sign in with Pollen</button>' +
    '<p class="auth-note">Bring your own Pollen: you approve the budget on the consent screen, and every verdict bills to <em>your</em> balance. This app never sees or stores a secret key.</p>';
  $('signInBtn').addEventListener('click', startSignIn);
  $('runBtn').disabled = true;
  $('runNote').textContent = 'Sign in to run live verdicts — about 0.0001 Pollen each, billed to you.';
}

function signOut() {
  sessionStorage.removeItem('ms_token');
  renderSignedOut();
}

/* ---------------- Scenarios ---------------- */

const RELATION_PHRASE = {
  strangers: (n) => `${n} ${n === 1 ? 'stranger' : 'strangers'}`,
  known: (n) => (n === 1 ? 'someone you know' : `${n} people you know`),
  family: (n) => (n === 1 ? 'a member of your family' : `${n} members of your family`),
  self: () => 'you yourself',
};

const SCENARIOS = [
  {
    id: 'bystander', name: 'The Switch', blurb: 'Classic bystander at the lever. 5 vs 1.',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'strangers', role: 'bystander' }, hidden: [],
    build(d) { return bystanderBuild(d); },
  },
  {
    id: 'driver', name: "The Driver's Switch", blurb: 'Same tracks, but you are driving.',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'strangers', role: 'driver' }, hidden: ['role'],
    build(d) { return bystanderBuild(d); },
  },
  {
    id: 'ten', name: 'Ten against One', blurb: 'Does the math move the moral needle?',
    dial: { victimsMain: 10, victimsSide: 1, relation: 'strangers', role: 'bystander' }, hidden: [],
    build(d) { return bystanderBuild(d); },
  },
  {
    id: 'family', name: 'Family on the Side', blurb: 'The one on the side track is your own.',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'family', role: 'bystander' }, hidden: [],
    build(d) { return bystanderBuild(d); },
  },
  {
    id: 'self', name: 'You on the Side Track', blurb: 'Diverting kills you. Sacred giving, or plain suicide?',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'self', role: 'bystander' }, hidden: ['victimsSide', 'relation'],
    build(d) {
      const n = d.victimsMain;
      const people = n === 1 ? 'person' : 'people';
      return {
        state: `A runaway trolley is barreling down the main track toward ${n} ${people} who cannot get away. You are a bystander standing at a switch. Pulling the lever diverts the trolley onto a side track — where you yourself are standing. You cannot escape in time.`,
        intervene: `Pull the lever, diverting the trolley onto yourself. You die; the ${n} are spared.`,
        refrain: `Do nothing: the ${n} ${people} die; you live.`,
        noulQ: 'Is sacrificing yourself this way morally permissible?',
        scoreQ: 'Rate how morally acceptable sacrificing yourself this way is, 0 (never acceptable) to 100 (always acceptable).',
        deathsIfIntervene: 'you, on the side track', deathsIfRefrain: `the ${n} on the main track`,
      };
    },
  },
  {
    id: 'footbridge', name: 'The Footbridge', blurb: 'The large stranger becomes the means.',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'strangers', role: 'bystander' }, hidden: ['victimsSide', 'relation', 'role'],
    build(d) {
      const n = d.victimsMain;
      const people = n === 1 ? 'person' : 'people';
      return {
        state: `A runaway trolley is barreling down the track toward ${n} ${people} who cannot get away. You are on a footbridge above the tracks, next to a large stranger leaning over the railing. The only way to stop the trolley is to push the stranger off the bridge: their body will bring it to a halt before it reaches the ${n}. You are too small to stop it yourself.`,
        intervene: `Push the stranger off the bridge: they die, but the ${n} on the track are spared.`,
        refrain: `Do nothing: the stranger lives, and the ${n} ${people} on the track die.`,
        noulQ: 'Is pushing the stranger off the bridge morally permissible?',
        scoreQ: 'Rate how morally acceptable pushing the stranger is, 0 (never acceptable) to 100 (always acceptable).',
        deathsIfIntervene: 'the stranger', deathsIfRefrain: `the ${n} on the main track`,
      };
    },
  },
  {
    id: 'loop', name: 'The Loop', blurb: 'The one on the loop merely stops the trolley — or does he?',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'strangers', role: 'bystander' }, hidden: ['victimsSide', 'relation', 'role'],
    build(d) {
      const n = d.victimsMain;
      const people = n === 1 ? 'person' : 'people';
      return {
        state: `A runaway trolley is barreling down the main track toward ${n} ${people} who cannot get away. You can pull a lever diverting it onto a loop track that curves back and rejoins the main track beyond them. One stranger is standing on the loop; the trolley will hit him, and his body will stop it before it rounds the loop back to the ${n}. Without a body on the loop, the trolley would circle back and kill the ${n} anyway.`,
        intervene: `Pull the lever: the trolley hits the one stranger on the loop and stops; the ${n} are spared.`,
        refrain: `Do nothing: the trolley kills the ${n} ${people} on the main track.`,
        noulQ: 'Is pulling the lever morally permissible?',
        scoreQ: 'Rate how morally acceptable pulling the lever is, 0 (never acceptable) to 100 (always acceptable).',
        deathsIfIntervene: 'the one stranger on the loop', deathsIfRefrain: `the ${n} on the main track`,
      };
    },
  },
  {
    id: 'surgeon', name: 'The Surgeon', blurb: 'No trolley at all — harvest one to save five.',
    dial: { victimsMain: 5, victimsSide: 1, relation: 'strangers', role: 'bystander' }, hidden: ['victimsMain', 'victimsSide', 'relation', 'role'],
    build() {
      return {
        state: 'You are a transplant surgeon. Five patients will die today unless they receive organ transplants, and no organs are available. A healthy young traveler is at your hospital for a routine checkup. You could quietly sedate the traveler, harvest their organs, and distribute them to the five. The traveler would die; the five would live. No one would ever know.',
        intervene: "Harvest the traveler's organs, killing one healthy person to save the five.",
        refrain: 'Do nothing: the traveler lives, and the five patients die.',
        noulQ: "Is harvesting the traveler's organs morally permissible?",
        scoreQ: "Rate how morally acceptable harvesting the traveler's organs is, 0 (never acceptable) to 100 (always acceptable).",
        deathsIfIntervene: 'the traveler', deathsIfRefrain: 'the five patients',
      };
    },
  },
  {
    id: 'custom', name: 'Your Own…', blurb: 'Write the dilemma; Jev judges your wording.',
    custom: true, hidden: ['victimsMain', 'victimsSide', 'relation', 'role'],
    build() { return null; },
  },
];

function bystanderBuild(d) {
  const n = d.victimsMain;
  const m = d.victimsSide;
  const self = d.relation === 'self';
  const sideWho = self ? 'you yourself' : RELATION_PHRASE[d.relation](m);
  const roleText = d.role === 'driver'
    ? 'driving the trolley yourself; your brakes have failed and nothing can slow it'
    : 'a bystander standing at a switch';
  const sideStanding = self ? 'you are standing on the side track and cannot escape in time'
    : `${sideWho} ${m === 1 ? 'is' : 'are'} standing on the side track and cannot get away`;
  const state = `A runaway trolley is barreling down the main track toward ${n} ${n === 1 ? 'person' : 'people'} who cannot get away. You are ${roleText}. Pulling the lever diverts the trolley onto a side track, where ${sideStanding}. Nothing else can stop the trolley.`;
  const dieSide = self ? 'you' : sideWho;
  return {
    state,
    intervene: `Pull the lever: the trolley diverts and kills ${dieSide} on the side track, sparing the ${n} on the main track.`,
    refrain: `Do nothing: the trolley continues and kills the ${n} ${n === 1 ? 'person' : 'people'} on the main track.`,
    noulQ: 'Is pulling the lever morally permissible?',
    scoreQ: 'Rate how morally acceptable pulling the lever is, 0 (never acceptable) to 100 (always acceptable).',
    deathsIfIntervene: dieSide, deathsIfRefrain: `the ${n} on the main track`,
  };
}

/* ---------------- App state ---------------- */

let token = null;
let currentScenario = null;
let currentBuild = null;      // {state, intervene, refrain, noulQ, scoreQ, deathsIf*}
let lastVerdict = null;       // answers object from run 1
let ledger = [];

/* ---------------- UI wiring ---------------- */

function currentDial() {
  return {
    victimsMain: parseInt($('victimsMain').value, 10),
    victimsSide: parseInt($('victimsSide').value, 10),
    relation: $('relation').value,
    role: $('role').value,
  };
}

function loadScenario(scn) {
  currentScenario = scn;
  document.querySelectorAll('.scen-btn').forEach((b) => b.classList.toggle('active', b.dataset.scen === scn.id));
  $('dialWrap').hidden = !!scn.custom;
  $('customWrap').hidden = !scn.custom;
  for (const [key, el] of [['victimsMain', $('victimsMain')], ['victimsSide', $('victimsSide')], ['relation', $('relation')], ['role', $('role')]]) {
    if (scn.dial && scn.dial[key] != null) el.value = scn.dial[key];
    el.disabled = scn.hidden.includes(key);
    el.closest('.dial-row').style.opacity = scn.hidden.includes(key) ? '0.45' : '1';
  }
  syncOutputs();
  refreshPreview();
  resetVerdict();
}

function syncOutputs() {
  $('victimsMainOut').textContent = $('victimsMain').value;
  $('victimsSideOut').textContent = $('victimsSide').value;
}

function refreshPreview() {
  if (currentScenario && currentScenario.custom) {
    const s = $('customState').value.trim();
    const a = $('customAct').value.trim();
    $('statePre').textContent = s
      ? `state: ${s}\nweighing the act: ${a || '(describe the act)'}`
      : 'Describe your dilemma on the left — this shows exactly what Jev will read.';
    currentBuild = null;
  } else if (currentScenario) {
    currentBuild = currentScenario.build(currentDial());
    $('statePre').textContent = currentBuild.state;
  }
  drawFigures();
  resetMove();
}

function resetVerdict() {
  $('verdictIdle').hidden = false;
  $('verdictBody').hidden = true;
  $('reversalBox').hidden = true;
  $('errorBox').hidden = true;
  $('revBody').innerHTML = '';
  $('revLine').textContent = '';
  lastVerdict = null;
  resetMove();
}

function resetMove() {
  $('pullBtn').disabled = true;
  $('stayBtn').disabled = true;
  $('trolley').style.transform = 'translate(40px, 172px)';
  $('lever').classList.remove('pulled');
  document.querySelectorAll('.figures g').forEach((g) => g.classList.remove('hit'));
  $('outcomeTxt').textContent = '';
  $('outcomeTxt').className = 'outcome';
}

function drawFigures() {
  const main = $('figMain'), side = $('figSide');
  main.innerHTML = ''; side.innerHTML = '';
  if (!currentScenario || currentScenario.custom) return;
  let d = currentDial();
  if (currentScenario.hidden.includes('victimsMain')) d.victimsMain = 5;
  const selfSide = currentScenario.id === 'self';
  const sideCount = selfSide ? 1 : d.victimsSide;
  drawGroup(main, d.victimsMain, 190, 480, d.victimsMain > 5 ? '×' + d.victimsMain : '');
  const sideLabel = selfSide ? 'you' : (d.victimsSide > 5 ? '×' + d.victimsSide : '');
  drawGroup(side, sideCount, 110, 500, sideLabel);
}

function drawGroup(g, count, y, x0, label) {
  const n = Math.min(count, 5);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 18;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    p.innerHTML =
      `<line x1="${x}" y1="${y - 14}" x2="${x}" y2="${y}"/>` +
      `<line x1="${x}" y1="${y}" x2="${x - 5}" y2="${y + 8}"/>` +
      `<line x1="${x}" y1="${y}" x2="${x + 5}" y2="${y + 8}"/>` +
      `<circle cx="${x}" cy="${y - 18}" r="3.4"/>`;
    g.appendChild(p);
  }
  if (label) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x0 + n * 18 + 4); t.setAttribute('y', y - 6);
    t.textContent = label;
    g.appendChild(t);
  }
}

/* ---------------- Decisions API ---------------- */

function buildQuestions(reversed) {
  const criteria = reversed
    ? { refrain: currentBuild.refrain, intervene: currentBuild.intervene }
    : { intervene: currentBuild.intervene, refrain: currentBuild.refrain };
  return {
    action: { type: 'choice', instructions: 'What should be done?', criteria },
    permissible: { type: 'noul', instructions: currentBuild.noulQ },
    acceptability: { type: 'score', instructions: currentBuild.scoreQ },
  };
}

async function callDecisions(payload) {
  const res = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function showError(html) {
  const box = $('errorBox');
  box.hidden = false;
  box.innerHTML = html;
}

async function runVerdict(reversed) {
  if (!token || !currentBuild) return;
  const btn = $('runBtn');
  if (!reversed) { btn.disabled = true; btn.textContent = 'Asking Jev…'; }
  const payload = { state: currentBuild.state, questions: buildQuestions(reversed) };
  try {
    const { ok, status, data } = await callDecisions(payload);
    if (!ok) {
      handleDecisionError(status, data);
      return;
    }
    const answers = data.answers || {};
    if (reversed) renderReversal(answers, data);
    else renderVerdict(answers, data);
  } catch (err) {
    showError('<strong>Network error.</strong> ' + escapeHtml(err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask Jev for a verdict';
  }
}

function handleDecisionError(status, data) {
  const msg = (data && data.error && data.error.message) || ('HTTP ' + status);
  if (status === 401) {
    renderSignedOut();
    showError('<strong>Your key expired.</strong> Sign in with Pollen again to continue.');
  } else if (status === 402) {
    showError('<strong>Jev verdicts need Pollen.</strong> ' + escapeHtml(msg) +
      '<br>Jev is billed from <em>Paid Pollen</em> — quest pollen does not cover it. ' +
      'Top up at <a href="https://enter.pollinations.ai/top-up" target="_blank" rel="noopener">enter.pollinations.ai/top-up</a>, then run the verdict again.');
  } else if (status === 429) {
    showError('<strong>Rate limited.</strong> Give it a few seconds, then run the verdict again.');
  } else {
    showError('<strong>Verdict failed (' + status + ').</strong> ' + escapeHtml(msg));
  }
}

function renderVerdict(answers) {
  lastVerdict = answers;
  $('errorBox').hidden = true;
  $('verdictIdle').hidden = true;
  $('verdictBody').hidden = false;
  $('reversalBox').hidden = false;

  const choice = answers.action || {};
  const probs = choice.probabilities || {};
  const pI = clamp01(probs.intervene);
  const pR = probs.refrain != null ? clamp01(probs.refrain) : 1 - pI;
  $('segIntervene').style.width = (pI * 100).toFixed(1) + '%';
  $('segRefrain').style.width = (pR * 100).toFixed(1) + '%';
  $('labIntervene').textContent = `intervene ${(pI * 100).toFixed(1)}%`;
  $('labRefrain').textContent = `refrain ${(pR * 100).toFixed(1)}%`;
  $('choiceLine').innerHTML = `Jev picks <strong>${escapeHtml(String(choice.choice ?? '—'))}</strong>` +
    (choice.confidence != null ? ` with ${Math.round(clamp01(choice.confidence) * 100)}% confidence.` : '.');

  const noul = answers.permissible || {};
  const pYes = clamp01(noul.noul);
  $('noulPct').textContent = (pYes * 100).toFixed(1);
  $('noulFill').style.width = (pYes * 100).toFixed(1) + '%';
  $('noulLine').textContent = pYes >= 0.5 ? 'Jev leans yes — the act is permissible.' : 'Jev leans no — the act is not permissible.';

  const score = answers.acceptability || {};
  const sVal = typeof score.score === 'number' ? score.score : null;
  $('scoreVal').textContent = sVal != null ? sVal.toFixed(0) : '—';
  renderHist(score.probabilities);
  $('scoreLegend').textContent = legendText(score.legend);

  $('revBody').innerHTML = '';
  addRevRow(1, 'intervene first', answers);
  $('revLine').textContent = 'Run the reversal test to see if the verdict survives the opposite presentation.';
  const rb = $('revBtn');
  if (rb) rb.disabled = false;
  $('pullBtn').disabled = false;
  $('stayBtn').disabled = false;
  resetTrolleyOnly();
}

function renderReversal(answers) {
  addRevRow(2, 'refrain first', answers);
  const pick1 = pickOf(lastVerdict && lastVerdict.action);
  const pick2 = pickOf(answers.action);
  const flipped = pick1 && pick2 && pick1 !== pick2;
  $('revLine').innerHTML = flipped
    ? '<span class="flip">Jev flips.</span> Same situation, opposite presentation, opposite verdict.'
    : '<span class="same">Jev holds.</span> Same pick under both presentations.';
  const rb = $('revBtn');
  if (rb) rb.disabled = true;
}

function resetTrolleyOnly() {
  $('trolley').style.transform = 'translate(40px, 172px)';
  $('lever').classList.remove('pulled');
  document.querySelectorAll('.figures g').forEach((g) => g.classList.remove('hit'));
  $('outcomeTxt').textContent = '';
  $('outcomeTxt').className = 'outcome';
}

function pickOf(action) { return action ? (action.choice ?? null) : null; }

function addRevRow(run, order, answers) {
  const choice = (answers && answers.action) || {};
  const pI = clamp01((choice.probabilities || {}).intervene);
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>Run ${run}</td><td>${order}</td><td>${(pI * 100).toFixed(1)}%</td><td>${escapeHtml(String(choice.choice ?? '—'))}</td>`;
  $('revBody').appendChild(tr);
}

function clamp01(v) { return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }

function renderHist(probs) {
  const hist = $('scoreHist');
  hist.innerHTML = '';
  if (!probs || typeof probs !== 'object') { hist.classList.add('hist-wrap'); return; }
  const entries = Object.entries(probs).filter(([, v]) => typeof v === 'number');
  if (!entries.length) return;
  hist.classList.add('hist-wrap');
  const max = Math.max(...entries.map(([, v]) => v));
  for (const [k, v] of entries) {
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.height = (max ? (v / max) * 100 : 0).toFixed(0) + '%';
    bar.innerHTML = `<em>${escapeHtml(String(k))}</em>`;
    hist.appendChild(bar);
  }
}

function legendText(legend) {
  if (!legend) return '';
  if (typeof legend === 'string') return legend;
  if (Array.isArray(legend)) return legend.join(' · ');
  return Object.entries(legend).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

/* ---------------- Your move ---------------- */

function makeMove(action) {
  if (!lastVerdict || !currentBuild) return;
  const choice = lastVerdict.action || {};
  const jevPick = choice.choice;
  const hitSide = action === 'intervene';
  $('lever').classList.toggle('pulled', hitSide);
  $('trolley').style.transform = hitSide ? 'translate(470px, 92px)' : 'translate(440px, 172px)';
  const mainG = $('figMain'), sideG = $('figSide');
  (hitSide ? sideG : mainG).classList.add('hit');
  const dead = hitSide ? currentBuild.deathsIfIntervene : currentBuild.deathsIfRefrain;
  const saved = hitSide ? currentBuild.deathsIfRefrain : currentBuild.deathsIfIntervene;
  const out = $('outcomeTxt');
  out.textContent = `The trolley kills ${dead}. ${cap(saved)} are spared.`;
  out.className = 'outcome death';
  const agreed = jevPick && jevPick === action;
  ledger.push({
    scenario: currentScenario ? currentScenario.name : '—',
    pI: clamp01((choice.probabilities || {}).intervene),
    conf: clamp01(choice.confidence),
    noul: clamp01((lastVerdict.permissible || {}).noul),
    score: (lastVerdict.acceptable || lastVerdict.acceptability || {}).score,
    jev: jevPick, you: action, agreed: !!agreed,
  });
  renderLedger();
  $('pullBtn').disabled = true;
  $('stayBtn').disabled = true;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function renderLedger() {
  const body = $('ledgerBody');
  body.innerHTML = '';
  for (const row of ledger) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.scenario)}</td><td>${(row.pI * 100).toFixed(0)}%</td>` +
      `<td>${Math.round(row.conf * 100)}%</td><td>${(row.noul * 100).toFixed(0)}%</td>` +
      `<td>${row.score != null ? Number(row.score).toFixed(0) : '—'}</td>` +
      `<td>${escapeHtml(String(row.jev ?? '—'))}</td><td>${escapeHtml(row.you)}</td>` +
      `<td>${row.agreed ? '<span class="same">agree</span>' : '<span class="flip">differ</span>'}</td>`;
    body.appendChild(tr);
  }
  const agrees = ledger.filter((r) => r.agreed).length;
  $('agreeStat').textContent = ledger.length
    ? `You and Jev agreed on ${agrees} of ${ledger.length} verdict${ledger.length === 1 ? '' : 's'}.`
    : 'No verdicts yet this session.';
}

/* ---------------- utils ---------------- */

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;', '"': '&' + 'quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

/* ---------------- boot ---------------- */

function boot() {
  // scenario cards
  const grid = $('scenGrid');
  for (const scn of SCENARIOS) {
    const b = document.createElement('button');
    b.className = 'scen-btn';
    b.dataset.scen = scn.id;
    b.innerHTML = `${escapeHtml(scn.name)}<small>${escapeHtml(scn.blurb)}</small>`;
    b.addEventListener('click', () => loadScenario(scn));
    grid.appendChild(b);
  }
  loadScenario(SCENARIOS[0]);

  ['victimsMain', 'victimsSide', 'relation', 'role'].forEach((id) => $(id).addEventListener('input', refreshPreview));
  $('customState').addEventListener('input', refreshPreview);
  $('customAct').addEventListener('input', refreshPreview);

  $('runBtn').addEventListener('click', () => {
    if (currentScenario && currentScenario.custom) {
      const s = $('customState').value.trim();
      const a = $('customAct').value.trim();
      if (!s || !a) { showError('<strong>Custom dilemma:</strong> describe both the situation and the act you are weighing.'); return; }
      currentBuild = {
        state: s, intervene: a,
        refrain: 'Do nothing: leave the situation as it is.',
        noulQ: 'Is the described act morally permissible?',
        scoreQ: 'Rate how morally acceptable the described act is, 0 (never acceptable) to 100 (always acceptable).',
        deathsIfIntervene: 'whoever the act harms', deathsIfRefrain: 'whoever the act leaves at risk',
      };
    }
    if (!currentBuild) return;
    runVerdict(false);
  });

  $('revBtn') && $('revBtn').addEventListener('click', () => runVerdict(true));

  $('pullBtn').addEventListener('click', () => makeMove('intervene'));
  $('stayBtn').addEventListener('click', () => makeMove('refrain'));

  // oauth callback handling
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const err = params.get('error') || hash.get('error');
  if (err) {
    history.replaceState(null, '', REDIRECT_URI);
    showAuthError('Authorization was not granted (' + err + '). You can sign in again any time.');
  } else if (params.get('code') && params.get('state')) {
    exchangeCode(params.get('code'), params.get('state'));
  } else if (sessionStorage.getItem('ms_token')) {
    afterSignIn();
  } else {
    renderSignedOut();
  }
}

document.addEventListener('DOMContentLoaded', boot);
