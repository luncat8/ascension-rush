# AGENTS.md


## style

- use a single tab indentation. LF end

- avoid deep nesting of braces { } and long if-else.
- flatten with early returns, helper functions, or flat data tables.

- avoid duplication of code.

- avoid allocations in the hot path (per-frame loop, sim, render).
- no new {}, [], object literals, closures, or string concat
- inside the frame loop.
- reuse preallocated buffers / typed arrays / scratch objects.
- allocate once at setup, mutate in place per frame.
- these are not strict rules, use best.

- plan*.md is NOT the implementation log. if need - update/improve plan, but keep final plan as artifact for possible fork or reimplementation without referring of what was and what done, without referring chat, etc.
- plan number i.e. 0.1 - is not version sequence. it is ok to continue old numbers by subject and implement in any useful order.

- only essential concise comments in code that really helpful i.e. explain why and decision. prefer descriptive naming.

- no legacy support, no old versions, no outdated browsers, no leftovers and no over protecting from unreal edge cases. we need clean architecture.

## runtime

- file:// friendly, classic <script> tags, no modules, no build.
- guard module.exports so files also run under node.
- no internet links: vendor any lib as a local js file.

## concepts


## files

findings-pitfalls-skills.md - notes and pitfalls for LLM agents. write here if found good way to do something.

archive/ - for implemented plans

experiments/ - measurement scripts (node), not loaded by the page.
experiments/logs/ - keep useful;
experiments/balance.js - economy Monte Carlo through the real dispatch/autopilot/physics: margin bands per world, bracket, stage count and payload. `experiments/logs/0.4.4-balance.txt` is its recorded run; `node experiments/balance.js 20261004 4 2 damage` flies the same chains with the damage model on.
experiments/failure.js - damage Monte Carlo through the same path: failure rates, stress per hop and repair bills per world and build strength. `experiments/logs/0.5.1-failures.txt` is its recorded run.

## damage
- js/damage.js is the whole model; its tuning is constants.damage and nothing else.
- it runs inside the physics step, so it allocates nothing: every scratch buffer is module-level.
- the baselines (envelope.js, build-sweep.js, impact-accuracy.js, balance.js) fly with damage off - the harness switches it off at load, and a script that is about damage switches it back on.

## sandbox

git push returns "Invalid username or token" is ok, no need to investigate or report - i will apply manually

## Workflow
- **Worklog**: record development steps and its validation in `archive/*-worklog.md`, end job with a next step suggestion.
example:
0.1.x-draft.md
archive/0.1.0-plan.md
archive/0.1.0-worklog.md
0.1.1-plan.md
0.1.3-draft.md - you may also write user prompts as draft files to store reference of global task
0.1.2-plan.md
