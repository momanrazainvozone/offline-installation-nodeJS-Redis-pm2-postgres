/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { serveWebpackBrowser } from '../../index';
import { executeOnceAndFetch } from '../execute-fetch';
import {
  BASE_OPTIONS,
  DEV_SERVER_BUILDER_INFO,
  describeBuilder,
  setupBrowserTarget,
} from '../setup';

const FETCH_HEADERS = Object.freeze({ host: 'example.com' });

describeBuilder(serveWebpackBrowser, DEV_SERVER_BUILDER_INFO, (harness) => {
  describe('option: "allowedHosts"', () => {
    beforeEach(async () => {
      setupBrowserTarget(harness);

      // Application code is not needed for these tests
      await harness.writeFile('src/main.ts', '');
    });

    it('does not allow an invalid host when option is not present', async () => {
      harness.useTarget('serve', {
        ...BASE_OPTIONS,
      });

      const { result, response } = await executeOnceAndFetch(harness, '/', {
        request: { headers: FETCH_HEADERS },
      });

      expect(result?.success).toBeTrue();
      expect(await response?.text()).toBe('Invalid Host header');
    });

    it('does not allow an invalid host when option is an empty array', async () => {
      harness.useTarget('serve', {
        ...BASE_OPTIONS,
        allowedHosts: [],
      });

      const { result, response } = await executeOnceAndFetch(harness, '/', {
        request: { headers: FETCH_HEADERS },
      });

      expect(result?.success).toBeTrue();
      expect(await response?.text()).toBe('Invalid Host header');
    });

    it('allows a host when specified in the option', async () => {
      harness.useTarget('serve', {
        ...BASE_OPTIONS,
        allowedHosts: ['example.com'],
      });

      const { result, response } = await executeOnceAndFetch(harness, '/', {
        request: { headers: FETCH_HEADERS },
      });

      expect(result?.success).toBeTrue();
      expect(await response?.text()).toContain('<title>');
    });
  });
});
