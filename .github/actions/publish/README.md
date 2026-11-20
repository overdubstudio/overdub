# The agent image's build and trusted publisher

[maul](https://github.com/devthenet-labs/maul) runs coding agents on issues and opens their work as pull requests.
Each change is built and tested in a container with no network, from an image this repository declares in
`.maul/agent.yaml`. This directory and three workflows build that image and publish it:

- **The agent toolchain image** is `.maul/Dockerfile`: Node.js, Biome, tsc and a headless Chrome, everything pinned,
  no application source. `agent-image.yml` (`agent image`) builds it from `main` only; `publish-images.yml` hands the
  finished build to `publish-agent.yml`, which pushes it to `AGENT_IMAGE_REPOSITORY` as the tag `.maul/agent.yaml`
  declares.
- The registry is the maul operator's ECR (AWS account `377946145366`), not this project's own AWS account
  (`infra/`): nothing here reads or changes the studio's infrastructure, deploys or secrets.

The scripts and their tests are maul's scaffold (`maul init app --existing`, v0.14.13), kept as generated except
where noted: `guard.cjs`, `validate_oci.py` and `copy-image.sh` also know a second image kind, `runtime`, which maul
previews pull requests from. This repository has no runtime image, so the scaffold's `runtime-image.yml` and
`publish-runtime.yml` are left out, and `test_workflows.py` and `publish-images.yml` are cut down to the agent image.
To add previews later, run the scaffold again.

## The boundary

Build jobs have only `contents: read`: no OIDC permission, no repository variables, no cloud or model credentials and no
persisted checkout credential. Fork pull requests may test and build but never publish. The uploaded artifact is
untrusted data, not authority.

`publish images` (`publish-images.yml`) runs on `workflow_run`, from the default branch's trusted copy of the workflows,
and holds no role itself: it calls the publisher for the image kind. A publisher never checks out, builds or runs pull
request source and never unpacks image layers. (The guard's pull request rules are the runtime kind's; an agent image
is only ever a `main` build.) Before it asks for AWS credentials, it:

1. checks its repository variables (`check-config.sh`): an unset or malformed one fails closed;
2. re-reads the repository, run, workflow, pull request and artifact metadata from GitHub's API (`guard.cjs`). The
   repository's identity is its immutable numeric ID and owner ID; a pull request must still be open, in this exact
   repository, targeting `main`, at the successful run's exact head. A `main` build's commit must be
   the branch's head or an ancestor of it, compared by SHA with the head the branches API names: a run's `head_branch`
   is only a name, and a run of a tag named `main` carries it too. The artifact is selected by ID from that
   specific run. For the agent image it also reads `.maul/agent.yaml` at the built commit, which must name
   `ECR_REGISTRY/AGENT_IMAGE_REPOSITORY` with a `toolchain-v<N>` tag;
3. validates a bounded, single-image linux/amd64 OCI archive (`validate_oci.py`): blob hashes and descriptor sizes, no
   links, traversal, duplicates, foreign URLs or unreferenced blobs.

Only then does it assume its own role and copy the opaque blobs with the distribution's
`skopeo copy --preserve-digests` (`copy-image.sh`). Tags are immutable: a re-run with the same digest is a no-op, and a
different digest at an existing tag is a hard failure, never an overwrite. The build is reproducible (a fixed
`SOURCE_DATE_EPOCH`, with every layer's timestamps rewritten to it): the image keeps its digest until its recipe or
its pinned inputs change.

The role is the boundary. AWS binds it to this repository's OIDC subject, its numeric repository and owner IDs, the
`main` ref, audience `sts.amazonaws.com` and the publisher workflow, the only workflow here that assumes it (the
studio's own deploy roles, `ci.yml` and `deploy-live.yml`, are separate and in another account):

| Trusted workflow (`job_workflow_ref`)                                       | Assumes          | Publishes                                                               |
| --------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `overdubstudio/overdub/.github/workflows/publish-agent.yml@refs/heads/main` | `AGENT_ROLE_ARN` | the agent image as the `toolchain-v<N>` tag `.maul/agent.yaml` declares |

The `job_workflow_ref` is compared exactly, case included. The role can write one ECR repository and sign with one
key, nothing else. A wrong repository variable can only make a publish fail.

Changes to `.github/` and `.maul/` need human review; maul's intent changesets refuse both paths. These protections
assume the default branch's maintainers stay trusted. As defence in depth, protect `main` with a branch ruleset
and add a tag ruleset that restricts creating tags named `main`, so no ref can pass for the branch by name.

## Repository variables

None of them is secret. Set them on this repository, never on the organization: an organization variable reaches every
repository with these workflows. The maul operator's terraform creates the role and outputs the configuration as
dotenv, which sets it in one command:

```sh
terraform output -raw overdubstudio_overdub_github_variables_dotenv | gh variable set -f - --repo overdubstudio/overdub
```

Set the configuration first and the `AGENT_PUBLISH_ENABLED` gate last:

| Variable                   | Value                                               | What it is                                                          |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `PUBLISH_REPOSITORY_ID`    | `gh api repos/overdubstudio/overdub --jq .id`       | this repository's immutable numeric ID, which the guard checks      |
| `PUBLISH_OWNER_ID`         | `gh api repos/overdubstudio/overdub --jq .owner.id` | its owner's immutable numeric ID                                    |
| `AWS_REGION`               | `us-east-1`                                         | the registry's AWS region                                           |
| `ECR_REGISTRY`             | `377946145366.dkr.ecr.us-east-1.amazonaws.com`      | the ECR registry host                                               |
| `AGENT_IMAGE_REPOSITORY`   | `maul/app-envs/overdub`                             | the agent image's ECR repository, which `.maul/agent.yaml` names    |
| `AGENT_ROLE_ARN`           | the agent publisher role ARN                        | assumed only by `publish-agent.yml`                                 |
| `AGENT_SIGNING_KEY`        | the signing key's `awskms:///` URI, or unset        | optional: the KMS key the agent image is signed with                |
| `AGENT_PUBLISH_ENABLED`    | `true`                                              | publishes the agent image; anything else skips it                   |

A skipped publisher is not a successful publication. To stop publishing, set `AGENT_PUBLISH_ENABLED` to anything but
`true`; to revoke publishing, remove the role's trust policy.

## Signing the agent image

Signing is optional. With `AGENT_SIGNING_KEY` set, `publish-agent.yml` signs the agent image after it copies it
(`sign-image.sh`), with cosign and the AWS KMS key the variable names, under the same short-lived agent role. It signs
exactly the digest it validated, never a tag. The signature is cosign's legacy form, a `sha256-<hex>.sig` tag beside the
image, so an ECR rule that expires untagged images keeps it. Nothing goes to the public transparency log, so the
repository's name stays private.

1. Create an AWS KMS key with key spec `ECC_NIST_P256` and key usage `SIGN_VERIFY`.
2. Let the agent publisher role use it: pass the key's ARN to the reference terraform module as
   `agent_signing_key_arn`. The module grants `kms:Sign`, `kms:GetPublicKey` and `kms:DescribeKey` on that key, plus `ecr:GetDownloadUrlForLayer` on the agent repository (cosign verify reads the signature back), to the
   agent role only, and adds `AGENT_SIGNING_KEY` to its output.
3. Set `AGENT_SIGNING_KEY` to the key as cosign names it: `awskms:///<key ARN>`, or `awskms:///alias/<name>` for an
   alias in `AWS_REGION`.
4. Give maul the public key. `cosign public-key --key "$AGENT_SIGNING_KEY"` prints the PEM for the chart's
   `repositoryImages.cosignPublicKey`.
5. Once the published image is signed, set `repositoryImages.allowUnsigned: false`.

The signing step runs on every agent publish, including one that finds the image already published. An image that
already verifies is not signed again: its signature tag is immutable too. So an image published before
`AGENT_SIGNING_KEY` was set is signed on the publisher's next run; to sign it now, re-run `agent image` on
`main`. The build is reproducible, so the publisher finds the same digest already published and only signs it.
To sign by hand instead, with the agent role's credentials and the image's digest:

```sh
cosign sign --key "$AGENT_SIGNING_KEY" --tlog-upload=false --new-bundle-format=false --use-signing-config=false \
  --yes 377946145366.dkr.ecr.us-east-1.amazonaws.com/maul/app-envs/overdub@sha256:<digest>
```

## Changing the agent toolchain

Edit `.maul/Dockerfile` and bump the tag in `.maul/agent.yaml` (`toolchain-v1` to `toolchain-v2`, and so on) in the
same commit. When it merges, `agent image` builds and the publisher pushes the new tag; the repository then declares an
image that exists. The agent has no network, so a tool a check needs and the image lacks fails there: add it to the
Dockerfile, pinned, with a bump. If the agent image rebuilds to a different digest without a bump, the publish fails
and says so; nothing is overwritten. (`toolchain-v1` of this registry repository was published from a private mirror of
this repository, which is why the first tag here is `toolchain-v2`.)

If the registry moves, change `ECR_REGISTRY` and `AGENT_IMAGE_REPOSITORY` and the image in `.maul/agent.yaml`
together: maul reads the image from the file, and the publisher refuses a declaration that names another repository.

## Tests

`agent-image.yml`'s `test` job runs them on a pull request that touches the image or the publishers, and before every
build on `main`:

```sh
node --test .github/actions/publish/guard.test.cjs
python3 -B -m unittest discover -s .github/actions/publish -p 'test_*.py'
```
