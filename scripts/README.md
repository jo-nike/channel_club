# Release execution

CI uploads a unique staging directory and runs `deploy_release.py` on the target
host. The host needs Python 3, Docker Compose, and the existing host-managed
`.env`. A Linux `flock` held by the helper covers acceptance, compose replacement,
container update, and health verification, regardless of runner concurrency.

Only descendants of the last accepted source commit (or the same commit retried)
are accepted. Full Git history is shipped as commit IDs, with no source files or
credentials. A failed deployment still advances the accepted-source watermark:
an older queued runner cannot silently roll back the attempted release. Force
pushes/divergent histories require an explicit operator decision. No mutable
`latest` tag is published or promoted.

`deployment.json` records the last verified release. `previous-compose.yaml` and
`previous-deployment.json` retain the preceding installation for investigation.
Failures leave the candidate installed and return a nonzero result; automatic
rollback is not implemented. An operator performing an intentional rollback must
hold `.deploy.lock` through compose restoration and verification, then explicitly
update `.accepted-source` to the chosen revision. Never delete that watermark to
make a stale queued job pass. Optional upstream services are not release liveness
requirements; the application health endpoint remains the check.

Regression tests run independent local processes against temporary deployment
directories and replace Docker/health actions with controlled functions. They do
not connect to the deployment host or claim a production rollout.

Each build receives a fresh random build identifier in `APP_VERSION`, even for
same-day reruns of the same commit. CI resolves the digest after pushing the
scanned image and installs `repository@sha256:...` in Compose. The host explicitly
pulls it, checks the unique application version, then verifies the container's
actual image ID and configured digest against that exact local image. Both are
recorded in `deployment.json`; previous records and compose manifests make the
prior artifact addressable without relying on a mutable tag. Rollback restores
that recorded digest, not a newly resolved tag with an old version label.

Run `python3 -m scripts.check_release_images` from the repository root for the
optional real Docker identity check. It requires a preexisting `alpine:latest`,
builds two isolated synthetic images from the same source marker, replaces a
fixture Compose container, and restores the first content ID. It removes only
its own named fixture resources. This exercises real local Docker image changes
and rollback; it does not publish images, test the remote registry, or deploy the
application.
