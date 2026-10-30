// Static review presentation only. No application imports, service calls or storage.
const states = {
  new: { action: 'Send', draft: '' },
  working: { action: 'Stop', draft: 'Could we make this work on an ordinary weekday?' },
  reading: { template: 'answer', position: true, action: 'Stop', draft: 'Could we make this work on an ordinary weekday?' },
  disconnected: { action: 'Stop', unavailable: true, draft: 'Keep the routine small enough for a busy day.', note: 'Reconnecting. Work may continue; Stop is unavailable.' },
  question: { action: 'Stop', draft: 'I may want to combine the two.' },
};
const params = new URLSearchParams(location.search);
const stateName = Object.hasOwn(states, params.get('state')) ? params.get('state') : 'new';
const state = states[stateName];
document.querySelector('#review-state').value = stateName;
document.querySelector('#review-state').addEventListener('change', event => {
  const url = new URL(location.href);
  url.searchParams.set('state', event.target.value);
  url.searchParams.delete('issue');
  location.assign(url);
});
document.querySelector('#conversation-content').replaceChildren(document.querySelector(`#state-${state.template ?? stateName}`).content.cloneNode(true));
document.querySelector('#latest-response').hidden = !state.position;
const editor = document.querySelector('#message');
editor.value = state.draft;
const action = document.querySelector('#send-stop');
action.textContent = state.action;
function fitEditor() {
  editor.style.height = 'auto';
  const max = Math.min(12 * parseFloat(getComputedStyle(document.documentElement).fontSize), innerHeight * .3);
  editor.style.height = `${Math.min(editor.scrollHeight + 2, Math.max(46, max))}px`;
  action.disabled = Boolean(state.unavailable) || (state.action === 'Send' && !editor.value.trim());
}
editor.addEventListener('input', fitEditor);
window.addEventListener('resize', fitEditor);
const note = state.note ?? (params.get('issue') === 'transcript' ? 'Transcript saving is still delayed.' : '');
if (note) {
  const exception = document.querySelector('#exception-note');
  exception.hidden = false;
  exception.textContent = note;
  action.setAttribute('aria-describedby', 'exception-note');
}
document.addEventListener('click', event => {
  if (!event.target.closest('[data-sample]')) return;
  event.preventDefault();
  document.querySelector('#sample-feedback').textContent = 'Sample control only. This design preview does not run chat actions.';
});
editor.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.preventDefault();
});
document.fonts.ready.then(() => {
  fitEditor();
  if (stateName !== 'new' && !state.position) {
    const conversation = document.querySelector('.conversation');
    conversation.scrollTop = conversation.scrollHeight;
  }
});
