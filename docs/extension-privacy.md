# flaneur extension: privacy

The flaneur extension lets AI agents that run flaneur on your computer browse in your Chrome. It collects nothing and
sends nothing anywhere.

- **What it reads:** the tabs it may show an agent (only the agent's own tabs, or all your tabs if you choose so in
  its options) and, while an agent drives one of them, what Chrome's debugger reports about that tab.
- **Where that goes:** only to the flaneur program on the same computer, over Chrome's native messaging. The
  extension makes no network requests of its own and has no server.
- **What it stores:** your one setting (which tabs agents see), in Chrome's local extension storage on your
  computer.
- **Who can use it:** flaneur, run by you or by any program running as your user on this computer, whenever Chrome
  runs with the extension: installing it is the consent. Chrome shows its yellow debugging bar while an agent drives a
  tab. To stop it, turn off or remove the extension in `chrome://extensions`.

What an agent does with the pages it browses is up to the agent and the program running it, not the extension.

Questions: [github.com/kedrzu/flaneur/issues](https://github.com/kedrzu/flaneur/issues).
