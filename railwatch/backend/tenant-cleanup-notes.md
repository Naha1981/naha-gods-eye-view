# RailWatch tenant hardening

RailWatch resolves its default tenant from `RAILWATCH_DEFAULT_TENANT` and enforces operator-token tenant scope on incident reads/actions.

Deployment configuration should set a tenant name appropriate to the deployment rather than relying on a hard-coded demo tenant.
