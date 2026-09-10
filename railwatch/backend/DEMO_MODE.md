# RailWatch demo mode

This MVP supports an explicit public demo mode for the command-centre walkthrough.

Set `RAILWATCH_DEMO_MODE=true` only for a demonstration deployment. In demo mode,
`/api/v1/demo/line-breach` is intentionally public and the C2 WebSocket accepts
connections without the private operator key. Do not enable this mode for a
production operational deployment.
