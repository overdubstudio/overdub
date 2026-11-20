"""Pin the build/publish boundary as well as the data validators.

Adapted from maul's scaffold (maul init app) for a repository that publishes
only the agent image: the runtime image's build and publisher, and the tests
of them, are left out.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRANCH = "main"
# The workflows the build/publish boundary is made of; any others in the
# repository are its own business.
PUBLISHING_WORKFLOWS = ["agent-image.yml", "publish-images.yml", "publish-agent.yml"]


def workflow(name):
    return (ROOT / "workflows" / name).read_text()


def job_block(text, job):
    """The text of one top-level job in a workflow (jobs are indented two spaces)."""
    match = re.search(rf"^  {job}:\n(.*?)(?=^  [a-z][a-z0-9_-]*:\n|\Z)", text, re.M | re.S)
    if not match:
        raise AssertionError(f"job {job} not found")
    return match.group(1)


class WorkflowBoundaryTest(unittest.TestCase):
    def test_the_build_has_no_oidc_credentials_or_publisher_configuration(self):
        text = workflow("agent-image.yml")
        for forbidden in ["id-token:", "secrets.", "vars.", "role-to-assume:", "docker login", "--push"]:
            self.assertNotIn(forbidden, text, forbidden)
        self.assertIn('test -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}"', text)
        self.assertIn("persist-credentials: false", text)

    def test_the_build_is_reproducible(self):
        # A re-run rebuilds the same digest, which the publisher then finds
        # already published instead of refusing a different image at an
        # immutable tag.
        text = workflow("agent-image.yml")
        self.assertIn("SOURCE_DATE_EPOCH", text)
        self.assertIn("rewrite-timestamp=true", text)

    def test_the_image_is_built_from_the_default_branch_only(self):
        # A pull request runs the publishers' tests and nothing else: the
        # build waits for them and never runs on a pull request's ref.
        build = job_block(workflow("agent-image.yml"), "build")
        self.assertIn(f"    if: github.ref == 'refs/heads/{BRANCH}'\n", build)
        self.assertIn("    needs: test\n", build)
        self.assertNotIn("docker", job_block(workflow("agent-image.yml"), "test"))

    def test_the_publisher_is_a_separate_trusted_workflow(self):
        text = workflow("publish-agent.yml")
        self.assertIn("ref: ${{ github.workflow_sha }}", text)
        self.assertIn("sparse-checkout: .github/actions/publish\n", text)
        self.assertIn(f"github.ref == 'refs/heads/{BRANCH}'", text)
        self.assertIn("role-to-assume: ${{ vars.AGENT_ROLE_ARN }}", text)
        self.assertIn("IMAGE_REPOSITORY: ${{ vars.AGENT_IMAGE_REPOSITORY }}", text)
        self.assertIn("IMAGE_KIND: agent\n", text)
        # It never names a runtime (preview) role or repository.
        self.assertNotIn("vars.RUNTIME_", text)
        self.assertNotIn("inputs.kind", text)
        self.assertNotIn("secrets.", text)
        self.assertNotIn("secrets:", text)
        for forbidden in ["docker run", "docker build", "head.sha", "npm install", "npm ci"]:
            self.assertNotIn(forbidden, text)
        # The configuration check runs before any credential is requested.
        self.assertLess(text.index("check-config.sh"), text.index("configure-aws-credentials"))
        self.assertLess(text.index("validate_oci.py"), text.index("configure-aws-credentials"))
        self.assertLess(text.index("guard.cjs"), text.index("configure-aws-credentials"))

    def test_the_agent_tag_comes_from_the_declaration(self):
        text = workflow("publish-agent.yml")
        self.assertIn("AGENT_TAG: ${{ steps.guard.outputs.tag }}", text)
        # A change to the declaration alone (a tag bump) rebuilds the image.
        self.assertIn("'.maul/**'", workflow("agent-image.yml"))

    def test_agent_publishing_is_gated_and_nothing_else_is_dispatched(self):
        text = workflow("publish-images.yml")
        agent = job_block(text, "agent")
        self.assertEqual(text.count("vars.AGENT_PUBLISH_ENABLED == 'true'"), 1)
        self.assertIn("vars.AGENT_PUBLISH_ENABLED == 'true'", agent)
        self.assertIn("uses: ./.github/workflows/publish-agent.yml", agent)
        self.assertIn("github.event.workflow_run.event != 'pull_request'", agent)
        self.assertIn("workflows: [agent image]\n", text)
        self.assertEqual(text.count("uses:"), 1)
        self.assertIn("name: agent image\n", workflow("agent-image.yml"))
        self.assertNotIn("secrets: inherit", text)

    def test_only_the_publisher_assumes_a_role(self):
        # The dispatcher calls the publisher and holds no role itself: the
        # role trusts exactly one publisher workflow (job_workflow_ref).
        dispatcher = workflow("publish-images.yml")
        for forbidden in ["role-to-assume", "configure-aws-credentials", "_ROLE_ARN", "steps:"]:
            self.assertNotIn(forbidden, dispatcher)
        for name in PUBLISHING_WORKFLOWS:
            text = workflow(name)
            expected = {"publish-agent.yml": 1}.get(name, 0)
            self.assertEqual(text.count("role-to-assume:"), expected, name)
            self.assertEqual(text.count("configure-aws-credentials@"), expected, name)

    def test_only_the_agent_publisher_signs_and_only_with_a_key(self):
        text = workflow("publish-agent.yml")
        self.assertIn("AGENT_SIGNING_KEY: ${{ vars.AGENT_SIGNING_KEY }}\n", text)
        # Installing cosign and signing are both skipped while the variable is unset.
        self.assertEqual(text.count("if: env.AGENT_SIGNING_KEY != ''"), 2)
        self.assertEqual(text.count("sigstore/cosign-installer@"), 1)
        self.assertIn("cosign-release: v3.1.3\n", text)
        # The signing step comes after the copy, so an already-published
        # image is signed too, and signs the validated digest, never a tag.
        sign = text.index("run: bash .github/actions/publish/sign-image.sh")
        self.assertLess(text.index("copy-image.sh"), sign)
        self.assertLess(text.index("configure-aws-credentials"), sign)
        self.assertIn("IMAGE_DIGEST: ${{ steps.image.outputs.digest }}", text[text.index("copy-image.sh"):])
        for name in PUBLISHING_WORKFLOWS:
            if name != "publish-agent.yml":
                self.assertNotIn("cosign", workflow(name), name)
                self.assertNotIn("SIGNING_KEY", workflow(name), name)

    def test_the_agent_publisher_never_reads_pull_requests(self):
        # Agent images come from the default branch only.
        self.assertNotIn("pull-requests:", workflow("publish-agent.yml"))
        self.assertNotIn("pull-requests:", job_block(workflow("publish-images.yml"), "agent"))

    def test_no_workflow_runs_untrusted_code_with_a_privileged_trigger(self):
        for name in PUBLISHING_WORKFLOWS:
            self.assertNotIn("pull_request_target", workflow(name), name)


if __name__ == "__main__":
    unittest.main()
