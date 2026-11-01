import { expect, test } from './recall-fixture';

const id = ['draft-fixture.md'];
const revision = 'a'.repeat(64);

async function installEditingFixture(page: import('@playwright/test').Page) {
  await page.route('**/api/vault/tree', route => route.fulfill({ json: {
    entries: [{ kind: 'note', name: id[0], id }],
  } }));
  await page.route('**/api/vault/note?*', route => route.fulfill({ json: {
    name: id[0], markdown: '# Original fixture\n', revision, editable: true,
  } }));
}

test('a dirty app navigation holds its destination until discard or keep editing', async ({ page, recallOrigin }) => {
  await installEditingFixture(page);
  await page.goto(`${recallOrigin}/recall?${new URLSearchParams({ file: JSON.stringify(id) })}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('textbox', { name: /markdown/i });
  await editor.fill('Draft belongs to this note');
  const originalURL = page.url();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
  await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  await expect(page).toHaveURL(originalURL);
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(editor).toHaveValue('Draft belongs to this note');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Capture' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/\/capture$/);
  await expect(page.getByRole('heading', { name: 'Capture', level: 1 })).toBeVisible();
});

test('Back holds a dirty draft and dismissal does not add a history entry', async ({ page, recallOrigin }) => {
  await installEditingFixture(page);
  await page.goto(`${recallOrigin}/ground`);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Recall' }).click();
  await page.getByRole('navigation', { name: 'Vault files' }).getByRole('link', { name: id[0] }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('textbox', { name: /markdown/i });
  await editor.fill('Keep this traversal draft');
  const originalURL = page.url();
  await page.evaluate(() => history.back());
  await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  await expect(page).toHaveURL(originalURL);
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(editor).toHaveValue('Keep this traversal draft');
  await page.evaluate(() => history.back());
  await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(`${recallOrigin}/recall`);
});
