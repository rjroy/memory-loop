// Isolated design presentation. No app imports, storage, requests or mutations.
const params = new URLSearchParams(location.search);
const knownStates = ['ready', 'loading', 'empty', 'missing', 'malformed', 'mixed', 'long'];
const state = knownStates.includes(params.get('state')) ? params.get('state') : 'ready';
const feedback = document.querySelector('#review-feedback');
const explain = text => { feedback.textContent = text; };
const stateControl = document.querySelector('#review-state');
stateControl.value = state;
stateControl.addEventListener('change', event => {
  const url = new URL(location.href);
  url.searchParams.set('state', event.target.value);
  location.assign(url);
});
const largeText = document.querySelector('#large-text');
largeText.checked = params.get('text') === '200';
function setTextSize() { document.documentElement.style.fontSize = largeText.checked ? '200%' : ''; }
setTextSize();
largeText.addEventListener('change', setTextSize);

const chats = [
  ['Making room for writing', 'Today, 10:36', 'Current in Think'],
  ['A chorus that leaves a question', 'Today, 09:54', 'Work in progress'],
  ['The shape of a small beginning', 'Yesterday, 21:08', 'Work status unavailable'],
  ['A song for the long way home', 'Yesterday, 18:32', ''],
  ['Following the image, not the outline', '30 Oct, 14:16', ''],
  ['A quieter second verse', '29 Oct, 20:41', ''],
  ['What belongs in the first draft?', '29 Oct, 11:27', ''],
  ['Untitled conversation', '28 Oct, 19:02', ''],
  ['An ordinary weekday', '27 Oct, 08:55', ''],
  ['Keeping the useful fragments', '26 Oct, 16:40', ''],
];
const chatList = document.querySelector('#conversation-list');
for (const [index, [title, time, reason]] of chats.entries()) {
  const li = document.createElement('li');
  li.className = 'conversation-row';
  const text = document.createElement('div');
  const heading = document.createElement('p');
  heading.className = 'conversation-title'; heading.textContent = title;
  const recency = document.createElement('span');
  recency.className = 'conversation-time'; recency.textContent = time;
  text.append(heading, recency);
  if (reason) {
    const protection = document.createElement('span');
    protection.id = `protection-${index}`; protection.className = 'protection'; protection.textContent = reason;
    text.append(protection);
  }
  const actions = document.createElement('div'); actions.className = 'row-actions';
  const resume = document.createElement('a');
  resume.className = 'resume-link'; resume.href = `#sample-chat-${index}`;
  resume.textContent = 'Resume'; resume.setAttribute('aria-label', `Resume ${title}`);
  resume.dataset.resume = title;
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'delete-button'; remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${title}`); remove.dataset.delete = title;
  if (reason) { remove.setAttribute('aria-disabled', 'true'); remove.setAttribute('aria-describedby', `protection-${index}`); }
  actions.append(resume, remove); li.append(text, actions); chatList.append(li);
}

const names = { actions: 'Quick Actions', inspiration: 'Inspiration', prompts: 'Prompts', goals: 'Goals', captures: 'Captures', conversations: 'Recent conversations' };
const empty = { actions: 'No quick actions yet.', inspiration: 'No inspiration yet.', prompts: 'No questions yet.', goals: 'No goals written yet.', captures: 'No captures yet.', conversations: 'No recent conversations yet.' };
const paths = { actions: 'quick-actions.md', inspiration: 'inspiration.md', prompts: 'prompts.md', goals: 'goals.md' };
function replaceState(card, mode) {
  const key = card.dataset.card;
  const body = card.querySelector('.card-body');
  body.replaceChildren(); body.classList.add('local-state');
  const p = document.createElement('p');
  p.textContent = mode === 'loading' ? 'Loading…' : mode === 'empty' ? empty[key]
    : mode === 'missing' ? `${names[key]} file not found.` : mode === 'malformed' ? `${names[key]} couldn’t be read.` : `${names[key]} couldn’t be loaded.`;
  if (key === 'captures' && mode === 'missing') p.textContent = 'Capture folder not found.';
  if (key === 'conversations' && ['missing', 'malformed'].includes(mode)) p.textContent = 'Recent conversations couldn’t be loaded.';
  body.append(p);
  if (mode === 'loading') { card.setAttribute('aria-busy', 'true'); return; }
  if (mode === 'empty') return;
  if (paths[key] && ['missing', 'malformed'].includes(mode)) {
    const path = document.createElement('span'); path.className = 'resource-path';
    path.textContent = `03_Resources/Memory-Loop/${paths[key]}`; body.append(path);
  }
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'quiet-button';
  retry.textContent = ['missing', 'malformed'].includes(mode) && key !== 'conversations' ? 'Check again' : 'Retry'; retry.dataset.sample = '';
  body.append(retry);
}
if (['loading', 'empty', 'missing', 'malformed'].includes(state)) {
  document.querySelectorAll('[data-card]').forEach(card => replaceState(card, state));
}
if (state === 'mixed') {
  replaceState(document.querySelector('[data-card="prompts"]'), 'error');
  const warning = document.createElement('p'); warning.className = 'refresh-warning';
  warning.textContent = 'Couldn’t update. Showing the previous version.';
  document.querySelector('[data-card="inspiration"] .card-body').append(warning);
}
if (state === 'long') {
  const title = 'Making room for a very small writing practice when the week is full and the first draft still feels a long way away';
  document.querySelector('.conversation-title').textContent = title;
  const firstResume = document.querySelector('[data-resume]'); firstResume.dataset.resume = title; firstResume.setAttribute('aria-label', `Resume ${title}`);
  const firstDelete = document.querySelector('[data-delete]'); firstDelete.dataset.delete = title; firstDelete.setAttribute('aria-label', `Delete ${title}`);
  document.querySelector('.capture-excerpt').textContent = 'AnUnbrokenFilenameOrCapturedThoughtThatMustNeverStretchThePhoneViewportBeyondItsAvailableWidthAndHideTheActualControlsOrSourceNoteIdentity';
  document.querySelector('.capture-path').textContent = '00_Inbox/a-long-source-note-identity-with-no-ellipsis-and-a-real-markdown-extension.md';
  const question = 'What is one small, concrete beginning that would make room for the work you still care about, even on an ordinary day with very little time?';
  document.querySelector('.question-action span').textContent = question;
  document.querySelector('.question-action').dataset.prefill = question;
}

let pendingConfirmation;
function showHandoff(trigger, label) {
  if (pendingConfirmation) { pendingConfirmation.querySelector('button').focus(); return; }
  const box = document.createElement('div'); box.className = 'handoff-confirmation';
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
  const message = document.createElement('p'); message.textContent = `${label === 'Open conversation' ? 'Open this conversation?' : 'Start a new chat?'} Your draft stays in the current chat.`;
  const buttons = document.createElement('div'); buttons.className = 'confirmation-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'quiet-button'; cancel.textContent = 'Cancel';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'quiet-button'; confirm.textContent = label;
  const close = () => { box.remove(); pendingConfirmation = undefined; trigger.focus(); };
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => { close(); explain('Sample only: a real handoff would preserve the old draft and open Think without sending or stopping work.'); });
  box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  buttons.append(cancel, confirm); box.append(message, buttons);
  trigger.closest('[data-card]').append(box); pendingConfirmation = box; cancel.focus();
}
const dialog = document.querySelector('#delete-dialog');
let deleteTrigger;
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const first = document.querySelector('#cancel-delete');
  const last = document.querySelector('#confirm-delete');
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.querySelector('#cancel-delete').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { deleteTrigger?.focus(); });
document.querySelector('#confirm-delete').addEventListener('click', () => {
  dialog.close(); explain('Sample only. Nothing was deleted; no daemon or vault is connected to this design artifact.');
});
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-sample], [data-prefill], [data-resume], [data-delete]');
  if (!trigger) return;
  event.preventDefault();
  if (trigger.hasAttribute('data-prefill')) { showHandoff(trigger, 'Start new chat'); return; }
  if (trigger.hasAttribute('data-resume')) { showHandoff(trigger, 'Open conversation'); return; }
  if (trigger.hasAttribute('data-delete')) {
    if (trigger.getAttribute('aria-disabled') === 'true') { explain('Sample only: deletion is unavailable for the visible protection reason.'); return; }
    if (pendingConfirmation) { pendingConfirmation.querySelector('button').focus(); return; }
    deleteTrigger = trigger; document.querySelector('#delete-title').textContent = `Delete “${trigger.dataset.delete}”?`;
    dialog.showModal(); document.querySelector('#cancel-delete').focus(); return;
  }
  explain('Sample control only. This design preview does not navigate the application or read files.');
});
