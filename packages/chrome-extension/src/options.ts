import { readSettings } from './readSettings.js';

// The only writer of the settings: the service worker reads them and reacts to their changes.
const scope = document.querySelector('#scope');
if (!(scope instanceof HTMLFieldSetElement)) {
    throw new TypeError('The options page is missing its inputs');
}

const settings = await readSettings();
for (const input of scope.querySelectorAll('input')) {
    input.checked = input.value === settings.scope;
}

scope.addEventListener('change', event => {
    if (event.target instanceof HTMLInputElement && (event.target.value === 'agent' || event.target.value === 'all')) {
        void chrome.storage.local.set({ scope: event.target.value });
    }
});
