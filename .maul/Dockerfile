# The image maul's coding agent builds and tests in for this repository (maul: github.com/devthenet-labs/maul; the
# publisher: .github/actions/publish/README.md). It is maul's agent base plus Node.js 24, the two checkers a code
# change must pass (Biome and tsc, at mise.toml's versions), python3 for the one deploy script the unit tests run,
# and playwright-core with Chrome's headless shell, so the agent can run the unit tests, `biome ci .`,
# `tsc -p jsconfig.json` and the tools/*-test.js checks with no network. No application source is baked in: the
# studio has no dependencies. agent-image.yml builds it from main and the agent publisher pushes it as the tag
# .maul/agent.yaml declares.
#
# Tags are immutable: when you change this file, bump the toolchain-v<N> tag in .maul/agent.yaml in the same commit.
# Every input below is pinned (the base by digest, each download by checksum, each apk package by version), so an
# unchanged file rebuilds to the same digest and the publisher finds the tag already published instead of refusing a
# changed image.
#
# The pod runs this image as uid 65532 with a read-only root filesystem, no network, HOME=/workspace and /tmp the
# only writable paths. tools/pw.js finds the browser through PLAYWRIGHT_CORE and CHROMIUM (below); Playwright puts
# each browser profile under TMPDIR=/tmp, Chrome's font cache goes to XDG_CACHE_HOME=/tmp/.cache, and npm's cache to
# /tmp/.cache/npm.
#
# What the image does not carry:
#   - WebKit and Firefox. tools/compat-test.js and tools/phone-test.js also drive them; here, run those two as
#     `node tools/compat-test.js chromium chromium-phone` and `node tools/phone-test.js chromium`.
#   - The sampled kits (app/kits/, fetched by tools/fetch-kits.js) and anything else a check downloads.
#   - ShellCheck, actionlint, zizmor, Terraform, tflint and trivy, the rest of `npm run check`: they cover the
#     deploy scripts, .github/ and infra/, and CI runs them.

# The downloads, each checked against a pinned checksum before it is used.
FROM ghcr.io/devthenet-labs/maul/agent-base:v0.14.13@sha256:75e7bb6faff899aa7a6f418ef18a4f5816e41449e36f8f9afc0007b3a7e9cc90 AS fetch
USER 0:0
# Node.js 24 LTS, the official linux-x64 build (what mise installs for `node = "24"` in CI). The checksum is the one in
# the release's SHASUMS256.txt, whose signature is a Node.js releaser's.
ADD --checksum=sha256:061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2 \
    https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.gz /tmp/node.tar.gz
# Biome 2.5.15 (mise.toml), the release's linux-x64 binary; the checksum is the digest GitHub records for the asset.
ADD --checksum=sha256:5d867a0b2ccea1755b7e508b01d836a8c64e31a1e4d11ec24b43b6b4eec8b3b6 \
    https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%402.5.15/biome-linux-x64 /tmp/biome
# TypeScript 5.9.3 (mise.toml; no dependencies of its own), the npm registry's tarball; the checksum is its sha256,
# matching npm's sha512 integrity.
ADD --checksum=sha256:10e108c9cf7d5f2879053dff18515fb405abf2ccef63eaaf017d9c571687a1d3 \
    https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz /tmp/typescript.tgz
# playwright-core 1.62.0, the version suites.yml and deploy-live.yml install (no dependencies of its own), the npm
# registry's tarball, checked the same way.
ADD --checksum=sha256:257b0e29fb807039d3d67fe7c9188a2b9696403c57821b10cb6c8d635e39789a \
    https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.0.tgz /tmp/playwright-core.tgz
# The chrome-headless-shell playwright-core 1.62.0 drives (browsers.json: revision 1234, 151.0.7922.34), from
# Playwright's CDN, the URL its own installer uses on linux-x64.
ADD --checksum=sha256:3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14 \
    https://cdn.playwright.dev/builds/cft/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip /tmp/chrome-headless-shell.zip
RUN mkdir -p /opt/node /opt/typescript /opt/playwright-core /opt/tools/bin \
  && tar -xzf /tmp/node.tar.gz -C /opt/node --strip-components=1 --no-same-owner \
  && tar -xzf /tmp/typescript.tgz -C /opt/typescript --strip-components=1 --no-same-owner \
  && tar -xzf /tmp/playwright-core.tgz -C /opt/playwright-core --strip-components=1 --no-same-owner \
  && unzip -q /tmp/chrome-headless-shell.zip -d /opt \
  && mv /opt/chrome-headless-shell-linux64 /opt/chrome-headless-shell \
  && install -m 0755 /tmp/biome /opt/tools/bin/biome \
  && ln -s /opt/typescript/bin/tsc /opt/tools/bin/tsc \
  && chmod -R a+rX,go-w /opt/node /opt/typescript /opt/playwright-core /opt/chrome-headless-shell /opt/tools

FROM ghcr.io/devthenet-labs/maul/agent-base:v0.14.13@sha256:75e7bb6faff899aa7a6f418ef18a4f5816e41449e36f8f9afc0007b3a7e9cc90

# apk needs root; the image drops back to 65532 at the end (the pod runs as 65532 whatever the image says).
USER 0:0

COPY --from=fetch /opt/node /opt/node
COPY --from=fetch /opt/typescript /opt/typescript
COPY --from=fetch /opt/playwright-core /opt/playwright-core
COPY --from=fetch /opt/chrome-headless-shell /opt/chrome-headless-shell
COPY --from=fetch /opt/tools /opt/tools

# The shared libraries chrome-headless-shell links (its ELF NEEDED entries: glib, nss, nspr, atk, at-spi, dbus,
# X11/xcb, xkbcommon, gbm, udev, alsa), libstdc++ for Node, fontconfig's configuration with the Liberation fonts,
# which Chrome's bundled fontconfig reads, and python3, which deploy/analytics/setup.sh runs (a unit test runs it
# dry). This is the full set apk resolves for them, each pinned to its version so the build is reproducible. To
# refresh it (with a toolchain tag bump), run the base as root,
#   apk add alsa-lib at-spi2-core dbus-libs glib libatk-1.0 libatk-bridge-2.0 libnspr libnss libstdc++ libudev libx11
#     libxcb libxcomposite libxdamage libxext libxfixes libxkbcommon libxrandr mesa-gbm fontconfig-config
#     font-liberation python-3.13
# and pin what it added, as listed by
#   awk -F: '/^P:/{p=$2} /^V:/{print p"="$2}' /lib/apk/db/installed
# The checks after it fail the build if Node, Biome, tsc, python3 or the browser cannot start, and write nothing (tsc would
# leave Node's compile cache in /tmp, which differs on every build, so it runs without one). ldconfig's aux-cache
# records each library's inode and change time, so it would differ too: it is only a cache, and goes.
# hadolint ignore=DL3018
RUN apk add --no-cache \
      alsa-lib=1.2.16.1-r6 \
      at-spi2-core=2.62.1-r1 \
      dbus-libs=1.16.4-r0 \
      font-liberation=2.1.5-r7 \
      fontconfig-config=2.18.4-r0 \
      glib=2.90.1-r2 \
      libLLVM-23=23.1.6-r1 \
      libatk-1.0=2.62.1-r1 \
      libatk-bridge-2.0=2.62.1-r1 \
      libblkid=2.42.4-r3 \
      libbz2-1=1.0.8-r31 \
      libdrm=2.4.134-r0 \
      libelf=0.197-r1 \
      libffi=3.8.1-r0 \
      libglvnd=1.7.0-r13 \
      libmount=2.42.4-r3 \
      libnspr=4.41-r0 \
      libnss=3.134-r0 \
      libpciaccess=0.19-r5 \
      libstdc++=16.2.0-r5 \
      libsystemd-compression-libs=262.2-r2 \
      libsystemd=262.2-r2 \
      libudev=262.2-r2 \
      libuuid=2.42.4-r3 \
      libx11-6=1.8.14-r5 \
      libx11-data=1.8.14-r5 \
      libx11-xcb1=1.8.14-r5 \
      libx11=1.8.14-r5 \
      libxau=1.0.12-r12 \
      libxcb=1.17.0-r20 \
      libxcomposite=0.4.7-r6 \
      libxdamage=1.1.7-r6 \
      libxdmcp=1.1.5-r15 \
      libxext6=1.3.7-r6 \
      libxext=1.3.7-r6 \
      libxfixes=6.0.2-r5 \
      libxi=1.8.4-r0 \
      libxkbcommon=1.13.2-r5 \
      libxml2=2.15.0-r0 \
      libxrandr=1.5.5-r8 \
      libxrender=0.9.13-r0 \
      libxshmfence=1.3.3-r8 \
      libxtst=1.2.6-r0 \
      libzstd1=1.5.7-r15 \
      lz4=1.11.1-r0 \
      mesa-gbm=26.3.1-r0 \
      mesa-libgallium=26.3.1-r0 \
      mpdecimal=4.0.1-r7 \
      py3-pip-wheel=26.2.2-r3 \
      python-3.13-base=3.13.18_git20261115-r1 \
      python-3.13=3.13.18_git20261115-r1 \
      wayland-libs-client=1.26.0-r4 \
      xkeyboard-config=2.49-r1 \
      xz=5.8.4-r2 \
      zstd=1.5.7-r15 \
  && /opt/node/bin/node --version \
  && /opt/tools/bin/biome --version \
  && python3 -B --version \
  && PATH=/opt/node/bin:$PATH NODE_DISABLE_COMPILE_CACHE=1 /opt/tools/bin/tsc --version \
  && /lib64/ld-linux-x86-64.so.2 --list /opt/chrome-headless-shell/chrome-headless-shell >/dev/null \
  && rm -f /var/cache/ldconfig/aux-cache

# node, npm, npx, biome and tsc on PATH; tools/pw.js reads PLAYWRIGHT_CORE and CHROMIUM. npm (for `npm test`,
# `npm run lint`) stays offline: it uses its cache only, in the writable /tmp, and makes no audit, funding or
# update-check calls.
ENV PATH=/opt/node/bin:/opt/tools/bin:${PATH} \
    PLAYWRIGHT_CORE=/opt/playwright-core \
    CHROMIUM=/opt/chrome-headless-shell/chrome-headless-shell \
    npm_config_offline=true \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    npm_config_cache=/tmp/.cache/npm

LABEL org.opencontainers.image.source="https://github.com/overdubstudio/overdub" \
      org.opencontainers.image.title="overdub agent toolchain" \
      org.opencontainers.image.description="maul agent image for overdub: Node.js 24.22.3, Biome 2.5.15, TypeScript 5.9.3, Python 3.13, playwright-core 1.62.0 and chrome-headless-shell 151.0.7922.34, offline"
WORKDIR /workspace
USER 65532:65532
