# Architecture and work boundaries

Memory Loop has a Next application boundary and a private daemon. Next owns the browser-facing routes and presentation, and holds the server-only credential used to reach the daemon. The daemon owns vault access and the backend operations exposed to Next. Browsers do not access the private daemon directly. Configuration and application state are separate from vault content; see the [operator guide](README.md#separate-vault-and-transport-configuration) for their current locations.

Separate work by responsibility, not by a frozen feature list. Daemon work covers filesystem operations, validation, and the data and errors it exposes. UX work covers interactions, presentation, accessibility, and recovery in the browser. Next routes connect those sides and enforce the browser-facing boundary. A feature can need changes across all three; coordinate the shared interface rather than having the UI reach around the daemon or the daemon dictate the UI.

## Reading the project documents

- [Intents](.lore/work/intents/) capture product direction and its reasons. They are revisable: later decisions can refine or invalidate earlier intents.
- [Backend API](backend/API.md) describes the current protocol, including payloads and expected vault-relative identifiers. Precise interfaces let the tiers work together; they can evolve along with their consumers.
- [Implementation notes](backend/IMPLEMENTATION.md) describe current mechanisms and limitations, not a set of approved future requirements. In particular, current link handling is not a settled product policy.
- Design briefs and plans record the scope and decisions of their work at the time. Historical acceptance is evidence for that work, not a blanket rule for future features. Consult current code and operator guidance when checking what runs today.

This document defines how work is separated and how to read these records. It does not prescribe the application's future feature set or add an approval process for interface changes.
