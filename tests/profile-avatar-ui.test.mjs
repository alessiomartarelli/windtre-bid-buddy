import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  jsonReq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2WQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function authedJson(session, path, body) {
  return jsonReq(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { Cookie: session.cookieHeader },
    body: JSON.stringify(body),
  });
}

test('avatar API: accepts only a small PNG/JPEG data URL and updates only the current session profile', async () => {
  const pool = await newPool();
  const first = await signup({ prefix: 'avatar_api_one', fullName: 'Avatar One' });
  const second = await signup({ prefix: 'avatar_api_two', fullName: 'Avatar Two' });
  try {
    const saved = await authedJson(first, '/api/auth/profile', { profileImageUrl: PNG_DATA_URL });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profileImageUrl, PNG_DATA_URL);

    const firstRow = await pool.query('SELECT profile_image_url FROM profiles WHERE id = $1', [first.profileId]);
    const secondRow = await pool.query('SELECT profile_image_url FROM profiles WHERE id = $1', [second.profileId]);
    assert.equal(firstRow.rows[0].profile_image_url, PNG_DATA_URL);
    assert.equal(secondRow.rows[0].profile_image_url, null, 'a session must not affect a different user profile');

    const invalidMime = await authedJson(first, '/api/auth/profile', {
      profileImageUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    });
    assert.equal(invalidMime.status, 400);

    const mismatchedContent = await authedJson(first, '/api/auth/profile', {
      profileImageUrl: `data:image/jpeg;base64,${PNG_BASE64}`,
    });
    assert.equal(mismatchedContent.status, 400);

    const overLimitBytes = Buffer.alloc(1024 * 1024 + 1);
    Buffer.from(PNG_BASE64, 'base64').copy(overLimitBytes);
    const tooLarge = await authedJson(first, '/api/auth/profile', {
      profileImageUrl: `data:image/png;base64,${overLimitBytes.toString('base64')}`,
    });
    assert.equal(tooLarge.status, 413);

    const updatedInfo = await authedJson(first, '/api/auth/profile', {
      fullName: 'Avatar One Updated',
      email: `avatar_updated_${first.profileId}@example.com`,
    });
    assert.equal(updatedInfo.status, 200, 'the existing name/email profile update must remain available');
    assert.equal(updatedInfo.body.fullName, 'Avatar One Updated');
    assert.equal(updatedInfo.body.email, `avatar_updated_${first.profileId}@example.com`);

    const removed = await authedJson(first, '/api/auth/profile', { profileImageUrl: null });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.profileImageUrl, null);
  } finally {
    await cleanupOrg(pool, first);
    await cleanupOrg(pool, second);
    await pool.end().catch(() => {});
  }
});

test('avatar UI: preview, save, immediate navbar update, reload persistence and fallback after removal', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'avatar_ui', fullName: 'Avatar UI' });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });

    await page.getByTestId('avatar-profile-fallback').waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId('input-avatar-file').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64'),
    });
    await page.getByTestId('avatar-profile-image').waitFor({ state: 'visible' });
    await page.getByTestId('button-save-avatar').click();

    await page.getByTestId('avatar-user-image').waitFor({ state: 'visible', timeout: 10000 });
    const saved = await pool.query('SELECT profile_image_url FROM profiles WHERE id = $1', [session.profileId]);
    assert.equal(saved.rows[0].profile_image_url, PNG_DATA_URL);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('avatar-profile-image').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('avatar-user-image').waitFor({ state: 'visible', timeout: 10000 });

    await page.getByTestId('button-remove-avatar').click();
    await page.getByTestId('avatar-profile-fallback').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('avatar-user-fallback').waitFor({ state: 'visible', timeout: 10000 });
    const removed = await pool.query('SELECT profile_image_url FROM profiles WHERE id = $1', [session.profileId]);
    assert.equal(removed.rows[0].profile_image_url, null);

    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});