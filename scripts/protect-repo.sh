#!/usr/bin/env bash
#
# One-time repo hardening for narrowananth/rtcforge.
# Requires the GitHub CLI, authenticated as a repo admin:
#   gh auth login
#
# Idempotent-ish: re-running the ruleset step fails if a ruleset named
# "protect-master" already exists — delete it first (see bottom) or edit in the UI.
set -euo pipefail

OWNER="${OWNER:-narrowananth}"
REPO="${REPO:-rtcforge}"

echo "==> 1/2  Allow GitHub Actions to create PRs (fixes changesets Version-PR error)"
gh api -X PUT "/repos/$OWNER/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true

echo "==> 2/2  Create branch ruleset 'protect-master' on the default branch"
# - repo admins (actor_id 5) bypass the PR gate -> only the owner pushes to master
# - everyone else: PR + code-owner review + green CI required
# - no force-push, no deletion
gh api -X POST "/repos/$OWNER/$REPO/rulesets" --input - <<'JSON'
{
  "name": "protect-master",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
    }},
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "build-test" },
          { "context": "e2e" }
        ]
    }}
  ]
}
JSON

echo
echo "Done. Verify: https://github.com/$OWNER/$REPO/settings/rules"
echo
echo "Still manual (no clean REST endpoint):"
echo "  Settings > Actions > General > Fork pull request workflows"
echo "    -> Require approval for all outside collaborators"
echo
echo "If the status-check names differ, open any PR > Checks, copy the exact"
echo "names, and edit the 'context' values in the ruleset."
echo
echo "To remove the ruleset later:"
echo "  gh api /repos/$OWNER/$REPO/rulesets --jq '.[] | select(.name==\"protect-master\") | .id'"
echo "  gh api -X DELETE /repos/$OWNER/$REPO/rulesets/<ID>"
