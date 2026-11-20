import { readSettings } from './readSettings.js';

// The only writer of the settings: the service worker reads them and reacts to their changes.
const allowAgents = document.querySelector('#allowAgents');
const scope = document.querySelector('#scope');
if (!(allowAgents instanceof HTMLInputElement) || !(scope instanceof HTMLFieldSetElement)) {
    throw new TypeError('The options page is missing its inputs');
}

const settings = await readSettings();
allowAgents.checked = settings.allowAgents;
scope.disabled = !settings.allowAgents;
for (const input of scope.querySelectorAll('input')) {
    input.checked = input.value === settings.scope;
}

allowAgents.addEventListener('change', () => {
    scope.disabled = !allowAgents.checked;
    void chrome.storage.local.set({ allowAgents: allowAgents.checked });
});
scope.addEventListener('change', event => {
    if (event.target instanceof HTMLInputElement && (event.target.value === 'agent' || event.target.value === 'all')) {
        void chrome.storage.local.set({ scope: event.target.value });
    }
});
