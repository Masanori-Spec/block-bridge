import { mkdirSync, writeFileSync } from 'node:fs';

// Retain concise first-party observations, without traces, browser profiles,
// request bodies, imported input content, or raw third-party log messages.
export default class SafeReporter {
  results = [];
  onTestEnd(test, result) {
    this.results.push({
      title: test.titlePath().filter(Boolean).join(' / '),
      status: result.status,
      expectedStatus: test.expectedStatus,
      retry: result.retry,
      durationMs: result.duration,
    });
  }
  onEnd(result) {
    mkdirSync('artifacts/browser', { recursive: true });
    writeFileSync('artifacts/browser/summary.json', `${JSON.stringify({
      schema: 'blockbridge.browser-suite.v1',
      status: this.results.length ? result.status : 'not-run',
      commit: process.env.GITHUB_SHA || null,
      consumer: 'Playwright Chromium',
      runner: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub-hosted Ubuntu 22.04' : 'local / unverified runner',
      sandboxRequested: true,
      coverageBoundary: 'Synthetic ASCII AC1015 LINE/CIRCLE/INSERT, matching units, positive uniform scales, quarter-turn rotations',
      visualReviewRequired: true,
      visualReviewPerformedByRunner: false,
      fullProductReadinessAsserted: false,
      tests: this.results,
    }, null, 2)}\n`);
  }
}
