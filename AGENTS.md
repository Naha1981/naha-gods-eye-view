# RailWatch engineering operating rules

This repository is maintained with an autonomous, test-first engineering loop. The working assumption is that the product is already valuable and working; changes must preserve existing behavior unless the task explicitly changes it.

## Default loop

1. Inspect the current implementation before changing it.
2. Make the smallest safe change that solves the identified problem.
3. Add or strengthen an automated regression test for the failure mode.
4. Run the narrowest relevant test locally/CI-first, then the broader suite.
5. Build the production bundle.
6. Push to `main` so Render auto-deploys.
7. Wait for the deployed commit to become live.
8. Run production health + API smoke checks against the exact deployed commit.
9. Run browser/operator QA and retain screenshots/logs as evidence.
10. Only after the current change is proven should another feature change begin.

## Autonomous QA agents

Treat each QA role as an independent agent with a specific responsibility:

- **API Contract Agent**: validates health, ingestion, persistence-facing contracts, authentication, idempotency and incident data.
- **Operator Workflow Agent**: drives the RailWatch UI through DETECT → LOCATE → VERIFY → RESPOND → RESOLVE → PROVE and verifies the visible operator experience.
- **UX Guard Agent**: checks that critical overlays stay inside the viewport, remain readable, have usable scroll/click behavior and do not steal the wrong cursor state.
- **Evidence Agent**: checks that incident evidence, integration metadata, evidence-chain fields and the final proof/report remain present and bounded.
- **Production Watch Agent**: checks that Render is serving the expected Git commit and raises a persistent GitHub issue when deployment verification remains unhealthy.

Agents should fail loudly with a precise reason and leave machine-readable evidence where practical. A passing unit test is not enough when the user-visible workflow can still be broken.

## Beginner-first user interaction

The user is the product owner, not the build system. Do not ask them to perform developer work when tooling can do it automatically. Do not ask them to copy code, edit configuration, inspect logs, or run commands unless there is no safe automated route. When a manual action is genuinely unavoidable, give exactly the minimum click-by-click instruction needed and then resume automation.

Use ordinary language in user updates. Prefer "the deployment is still building" over internal jargon. Never claim a test or deployment passed unless the result was actually observed.

## Safety boundaries

RailWatch is an operational intelligence prototype, not certified rail-control software. Never invent live Transnet endpoints, credentials, asset coordinates, or authoritative GIS facts. Demonstration data must remain clearly labelled. The platform must not autonomously command signalling, train movement, or field dispatch.

## Definition of done

A change is not considered done merely because its code is committed. It is done when:

- a regression test protects the behavior;
- the relevant automated agents pass;
- the production build is live on the intended commit;
- the production health/API probe passes;
- user-visible behavior is covered where applicable;
- no known blocker has been hidden from the product owner.
