const { test, expect } = require('@playwright/test');

test.describe('통합 세금 플랫폼 기본 흐름', () => {
  test('테마 토글, 요약/플로우, 차트 표시', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('연말정산 · 법인세 · 종합소득세를 한 화면에서')).toBeVisible();

    const body = page.locator('body');
    await expect(body).toHaveAttribute('data-theme', /light|dark/);
    await page.getByRole('button', { name: '테마' }).click();
    await expect(body).toHaveAttribute('data-theme', /light|dark/);

    await page.getByRole('button', { name: '접기' }).click();
    await expect(page.locator('.summary-sidebar')).toHaveClass(/collapsed/);
    await page.getByRole('button', { name: '펼치기' }).click();

    await expect(page.locator('[data-step="input"]')).toBeVisible();
    await expect(page.locator('.chart-bar')).toHaveCount(3);
  });

  test('고급 입력 및 저장/불러오기 동작', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '고급 입력 열기' }).click();
    await page.getByPlaceholder('2,000,000').fill('2000000');
    await page.getByRole('button', { name: '계산 저장' }).click();
    await page.getByRole('button', { name: '불러오기' }).click();
    await expect(page.getByPlaceholder('2,000,000')).toHaveValue('2000000');
  });
});
