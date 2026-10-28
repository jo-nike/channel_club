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

`deployment.json` and `verified-compose.yaml` record the last verified release.
`previous-compose.yaml` and `previous-deployment.json` retain the verified
release before it; they rotate only when a deployment verifies, so failed
attempts never replace them. On a failure the helper restores
`verified-compose.yaml` while still holding the lock. If the pull failed, the old
container is still running and nothing is restarted. Otherwise it runs
`docker compose up -d` and checks the restored release's health, printing
`Rolled back to <build id or version>` or that the rollback failed. Either way
the deployment returns the original error, so CI stays red. The first run on a
host without `verified-compose.yaml` seeds it from the installed Compose file
only if that file names the image in `deployment.json`; otherwise it prints that
rollback is unavailable for that attempt. An operator performing an intentional rollback must
hold `.deploy.lock` through compose restoration and verification, then explicitly
update `.accepted-source` to the chosen revision. Never delete that watermark to
make a stale queued job pass. Optional upstream services are not release liveness
requirements; the application health endpoint remains the check.

Regression tests run independent local processes against temporary deployment
directories and replace Docker/health actions with controlled functions. They do
not connect to the deployment host or claim a production rollout.

Each build receives a fresh random build identifier in `APP_BUILD_ID`, even for
same-day reruns of the same commit. CI resolves the digest after pushing the
scanned image and installs `repository@sha256:...` in Compose. The host explicitly
pulls it, checks both the semantic application version and exact build ID, then verifies the container's
actual image ID and configured digest against that exact local image. Both are
recorded alongside `version` and `build_id` in `deployment.json`; previous records and compose manifests make the
prior artifact addressable without relying on a mutable tag. Rollback restores
that recorded digest, not a newly resolved tag with an old version label.

## Channel Club versioned publishing

`backend/pyproject.toml` is the authoritative application version. To cut a
release, set it everywhere, then push an annotated tag at the tested commit:

```bash
python3 scripts/version.py --set 1.3.2
python3 scripts/version.py
git tag -a v1.3.2 -m "Channel Club 1.3.2"
git push origin v1.3.2
```

`python3 scripts/version.py` checks the canonical Python project version against
frontend metadata and both lockfiles. `--set X.Y.Z` synchronizes those application
records without upgrading dependencies. The Python runtime reads the shipped
`pyproject.toml`; Vite injects the validated frontend package version.

`python3 -m scripts.release` supplies the CI metadata, existing-release check and
publication operations. Master builds publish unique version/build tags and deploy
by digest. A `vX.Y.Z` Git tag must match package metadata, and publishes the fixed
`gitea.example.com/jons-org/channel-club:X.Y.Z` image without running deployment. The
release job serializes matching refs; existing matching releases are reused and
conflicting version/source labels are rejected. Registry lookup failures abort;
only Docker's explicit missing-manifest response permits creating a release tag.

The host helper accepts `--build-id` for new releases. `/api/health` now returns
`status`, `version`, `buildId` and `revision`; two builds of version 1.0.0 cannot
satisfy one another's deployment checks. Legacy records without `build_id` retain
the old health-version check for an explicit rollback; image digest verification
still applies. Restore the recorded previous Compose file to recover its old
container name and repository. Keep the same Compose project directory: the
project name, and so the named volumes, come from it. The service key changed from
`iptv-viewer` to `channel-club` after 1.3.2. The helper runs `down --remove-orphans`
before `up -d` and finds the container without naming the service, so releases and
rollbacks on either side of the rename replace the container cleanly. (Compose v5's
`up --remove-orphans` alone races the old container for its name.)

Do not move published Git release tags. Bump the application version and create a
new tag for a new release. Existing registry/SSH secrets are reused; the workflow
does not create Git tags or require a repository-write credential.
