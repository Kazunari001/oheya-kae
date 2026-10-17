import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const REPOSITORY = 'Kazunari001/oheya-kae';
const APPROVER_ID = 130190029;

/**
 * Merges only the exact commit approved by the repository owner.
 * @param {object} event GitHub issue_comment event payload.
 * @param {Function} request Authenticated, repository-scoped API request.
 * @return {Promise<string>} Result for the Actions log.
 */
export async function mergeApprovedPullRequest(event, request) {
  if (event.action !== 'created' || !event.issue?.pull_request ||
      event.repository?.full_name !== REPOSITORY ||
      event.comment?.user?.id !== APPROVER_ID ||
      event.sender?.id !== APPROVER_ID) {
    return 'Ignored: not an owner approval on a pull request.';
  }

  const match = /^\/merge ([0-9a-f]{40})$/i.exec(event.comment.body.trim());
  if (!match) {
    return 'Ignored: expected /merge followed by the full 40-character SHA.';
  }
  const approvedSha = match[1].toLowerCase();
  const comment = await request(`/issues/comments/${event.comment.id}`);
  if (comment.user.id !== APPROVER_ID ||
      comment.body !== event.comment.body ||
      comment.updated_at !== event.comment.updated_at) {
    throw new Error('Approval changed after submission. Post a new comment.');
  }

  const pullPath = `/pulls/${event.issue.number}`;
  const pull = await request(pullPath);
  if (pull.state !== 'open' || pull.merged || pull.draft ||
      pull.base.ref !== 'main' ||
      pull.base.repo.full_name !== REPOSITORY) {
    throw new Error('Only open, non-draft pull requests into main can merge.');
  }
  if (pull.head.sha !== approvedSha) {
    throw new Error('The approved SHA is not the current pull request head.');
  }
  if (pull.mergeable !== true || pull.mergeable_state !== 'clean') {
    throw new Error(
        'PR is not ready. Resolve conflicts/checks and comment again.');
  }

  // GitHub checks this SHA again atomically when performing the merge.
  const result = await request(`${pullPath}/merge`, {
    method: 'PUT',
    body: {sha: approvedSha, merge_method: 'squash'},
  });
  if (!result.merged) {
    throw new Error(`GitHub did not merge the PR: ${result.message}`);
  }
  return `Merged PR #${event.issue.number} at approved SHA ${approvedSha}.`;
}

/** Runs the handler using the workflow event and its short-lived token. */
async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token || process.env.GITHUB_REPOSITORY !== REPOSITORY) {
    throw new Error('Missing workflow token or unexpected repository.');
  }
  const eventText = await readFile(process.env.GITHUB_EVENT_PATH, 'utf8');
  const event = JSON.parse(eventText);
  const request = async (path, {method = 'GET', body} = {}) => {
    const response = await fetch(
        `https://api.github.com/repos/${REPOSITORY}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} failed: ${response.status}`);
    }
    return response.json();
  };
  console.log(await mergeApprovedPullRequest(event, request));
}

// stdin execution works even before package.json is published to GitHub.
if (!process.argv[1] ||
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
