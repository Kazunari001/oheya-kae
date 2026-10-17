import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeApprovedPullRequest} from '../scripts/merge-approved-pr.js';

const SHA = 'a'.repeat(40);

function fixture() {
  const comment = {
    id: 10,
    user: {id: 130190029},
    body: `/merge ${SHA}`,
    updated_at: '2026-10-17T00:00:00Z',
  };
  const event = {
    action: 'created',
    repository: {full_name: 'Kazunari001/oheya-kae'},
    issue: {number: 5, pull_request: {}},
    comment: structuredClone(comment),
    sender: {id: 130190029},
  };
  const pull = {
    state: 'open',
    merged: false,
    draft: false,
    base: {ref: 'main', repo: {full_name: 'Kazunari001/oheya-kae'}},
    head: {sha: SHA},
    mergeable: true,
    mergeable_state: 'clean',
  };
  const writes = [];
  const request = async (path, options) => {
    if (options) {
      writes.push({path, ...options});
      return {merged: true};
    }
    return path.includes('/comments/') ? comment : pull;
  };
  return {event, comment, pull, writes, request};
}

test('owner approval merges only its exact SHA using squash', async () => {
  const context = fixture();
  await mergeApprovedPullRequest(context.event, context.request);
  assert.deepEqual(context.writes, [{
    path: '/pulls/5/merge',
    method: 'PUT',
    body: {sha: SHA, merge_method: 'squash'},
  }]);
});

test('untrusted and malformed events never access the API', async () => {
  const mutations = [
    (event) => {
      event.comment.user.id = 123;
    },
    (event) => {
      event.sender.id = 123;
    },
    (event) => {
      event.repository.full_name = 'other/repo';
    },
    (event) => {
      delete event.issue.pull_request;
    },
    (event) => {
      event.action = 'edited';
    },
    (event) => {
      event.comment.body = '/merge';
    },
    (event) => {
      event.comment.body = '/merge abc1234';
    },
    (event) => {
      event.comment.body += '\nextra command';
    },
  ];
  for (const mutate of mutations) {
    const {event} = fixture();
    mutate(event);
    await mergeApprovedPullRequest(event, () => assert.fail('Unexpected API'));
  }
});

test('changed approvals and unmergeable PRs never write', async () => {
  const mutations = [
    ({comment}) => {
      comment.body = 'cancel';
    },
    ({comment}) => {
      comment.updated_at = '2026-10-17T01:00:00Z';
    },
    ({comment}) => {
      comment.user.id = 123;
    },
    ({pull}) => {
      pull.head.sha = 'b'.repeat(40);
    },
    ({pull}) => {
      pull.draft = true;
    },
    ({pull}) => {
      pull.state = 'closed';
    },
    ({pull}) => {
      pull.merged = true;
    },
    ({pull}) => {
      pull.base.ref = 'other';
    },
    ({pull}) => {
      pull.base.repo.full_name = 'other/repo';
    },
    ({pull}) => {
      pull.mergeable = null;
    },
    ({pull}) => {
      pull.mergeable = false;
    },
    ({pull}) => {
      pull.mergeable_state = 'unstable';
    },
    ({pull}) => {
      pull.mergeable_state = 'blocked';
    },
  ];
  for (const mutate of mutations) {
    const context = fixture();
    mutate(context);
    await assert.rejects(
        mergeApprovedPullRequest(context.event, context.request));
    assert.deepEqual(context.writes, []);
  }
});

test('conflicts and unsuccessful merges are reported as failures', async () => {
  for (const throwsConflict of [true, false]) {
    const context = fixture();
    const request = async (path, options) => {
      if (options) {
        if (throwsConflict) {
          throw new Error('409: head changed during merge');
        }
        return {merged: false, message: 'blocked'};
      }
      return context.request(path);
    };
    await assert.rejects(mergeApprovedPullRequest(context.event, request));
  }
});
