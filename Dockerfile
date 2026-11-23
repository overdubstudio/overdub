# The runtime image a maul preview runs (maul: github.com/devthenet-labs/maul; the publisher:
# .github/actions/publish/README.md): what `npm start` serves, the landing page at / and the studio at /app/, for one
# commit, so a pull request maul opened can be looked at before it is merged. runtime-image.yml builds it for every
# pull request head and every main commit; nothing here is the live site's (deploy/, infra/).
#
# A preview runs it as uid 65532 with a read-only root filesystem, no writable /tmp, every capability dropped and no
# network of its own. server/serve.js fits as it is: no dependencies, no build, and it writes nothing to disk. The
# image holds what deploy/deploy.sh ships (site/, app/ and the public docs) plus server/serve.js and package.json
# (.dockerignore is the list), and none of the rest of the checkout:
#   - no agent bridge and no Claude Code behind the panel (server/bridge.js, server/local-claude.js: both are for the
#     machine the studio runs on, and serve.js loads them only when they are there), as on the live site;
#   - no sampled kits (app/kits/, built by tools/fetch-kits.js, 0.7 GB: the publisher takes 128 MiB), so a device that
#     plays one is silent in a preview; no community shelf and no stems runner either (app/site-config.json is {}).
#
# Node is distroless's 24, mise.toml's major, pinned by digest: no shell, no package manager.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a
WORKDIR /overdub
COPY . .
# The commit this image was built from (runtime-image.yml passes the head it checked out).
ARG BUILD_SHA=dev
LABEL org.opencontainers.image.revision=$BUILD_SHA
# The one port a preview asks for, on every address of the container, and any name: a preview is asked for as
# <project>-<issue>.<the operator's suffix>, which serve.js would refuse as a name that isn't localhost
# (docs/SECURITY.md, "Local"; test/unit/serve-host.test.js).
ENV PORT=8080 \
    OVERDUB_HOST=0.0.0.0 \
    OVERDUB_ANY_HOST=1
USER 65532:65532
EXPOSE 8080
# distroless's entrypoint is node
CMD ["server/serve.js"]
