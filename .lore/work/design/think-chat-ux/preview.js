// Static review presentation only. No application imports, service calls or storage.
const states = {
  new: { status: 'Ready', action: 'Send', draft: '', hint: 'Enter for a new line.', logging: 'Transcript starts with your first message.' },
  working: { status: 'Connected · AI using tools', action: 'Stop', draft: 'Could we make this work on an ordinary weekday?', hint: 'You can draft while the AI works.', logging: 'Transcript: live text pending.' },
  reading: { template: 'working', position: true, status: 'Connected · AI using tools', action: 'Stop', draft: 'Could we make this work on an ordinary weekday?', hint: 'You can draft while the AI works.', logging: 'Transcript: live text pending.' },
  disconnected: { status: 'Reconnecting · Last known: AI working', action: 'Stop', unavailable: true, draft: 'Keep the routine small enough for a busy day.', hint: 'Stop is unavailable until the service is reachable.', note: 'Work may still be running. Your draft stays here; it won’t send automatically.', logging: 'Transcript: last-known state · live text pending.' },
  logging: { status: 'Connected · Response complete', action: 'Send', draft: 'Let’s try that for a week.', hint: 'Enter for a new line.', warning: true },
  question: { status: 'Connected · Waiting for your answer', action: 'Stop', draft: 'I may want to combine the two.', hint: 'Your draft is separate from the answer above.', logging: 'Transcript: finished messages logged.' },
};
const params = new URLSearchParams(location.search);
const stateName = Object.hasOwn(states, params.get('state')) ? params.get('state') : 'new';
const state = states[stateName];
document.querySelector('#review-state').value = stateName;
document.querySelector('#review-state').addEventListener('change', event => {
  const url = new URL(location.href);
  url.searchParams.set('state', event.target.value);
  location.assign(url);
});
document.querySelector('#conversation-content').replaceChildren(document.querySelector(`#state-${state.template ?? stateName}`).content.cloneNode(true));
document.querySelector('#position-row').hidden = !state.position;
document.querySelector('#run-status').textContent = state.status;
document.querySelector('#message').value = state.draft;
document.querySelector('#compose-hint').textContent = state.hint;
const action = document.querySelector('#send-stop');
action.textContent = state.action;
action.disabled = Boolean(state.unavailable) || (state.action === 'Send' && !state.draft.trim());
document.querySelector('#message').addEventListener('input', event => {
  if (state.action === 'Send') action.disabled = Boolean(state.unavailable) || !event.target.value.trim();
});
if (state.note) {
  document.querySelector('#connection-note').hidden = false;
  document.querySelector('#connection-note').textContent = state.note;
}
const logging = document.querySelector('#log-status');
if (state.warning) {
  logging.classList.add('log-warning');
  const message = document.createElement('p');
  const heading = document.createElement('strong');
  heading.textContent = 'Transcript isn’t up to date.';
  message.append(heading, document.createElement('br'), 'Chat can continue. A background transcript also needs attention.');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'button text-button'; retry.dataset.sample = '';
  retry.textContent = 'Retry logging';
  logging.append(message, retry);
} else logging.textContent = state.logging;
document.addEventListener('click', event => {
  if (!event.target.closest('[data-sample]')) return;
  event.preventDefault();
  document.querySelector('#sample-feedback').textContent = 'Sample control only. This design preview does not run chat actions.';
});
document.querySelector('#message').addEventListener('keydown', event => {
  // The textarea is freely editable; no keyboard combination sends anything here.
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.preventDefault();
});
// Position an existing fictional exchange at its latest output once for review.
// This is not a streaming/autoscroll implementation.
document.fonts.ready.then(() => {
  if (stateName !== 'new' && !state.position) {
    const conversation = document.querySelector('.conversation');
    conversation.scrollTop = conversation.scrollHeight;
  }
});
