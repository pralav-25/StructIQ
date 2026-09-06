const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
let browser;

before(async () => {
    browser = await chromium.launch();
});

after(async () => {
    await browser?.close();
});

function asset(id, name) {
    return {
        id, name, asset_type: 'Bridge', health_score: 80,
        latitude: 13.08, longitude: 80.27,
    };
}

async function openPage(t, filename, assets = [], reports = []) {
    const page = await browser.newPage();
    t.after(() => page.close());
    const requests = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://structiq.test') {
            return route.fulfill({
                contentType: 'text/html',
                body: await readFile(path.join(ROOT, filename), 'utf8'),
            });
        }
        if (url.origin === 'http://127.0.0.1:8000') {
            requests.push({ path: url.pathname, method: route.request().method() });
            const data = url.pathname === '/assets' ? assets :
                url.pathname === '/reports' ? reports : {};
            return route.fulfill({ json: data });
        }
        // Third-party styling, map tiles, and analytics are outside these tests.
        return route.fulfill({ body: '', contentType: 'text/plain' });
    });
    await page.addInitScript(() => {
        // Stop polling so every refresh is explicit and deterministic.
        window.setInterval = () => 0;
        window.renderedPopups = [];
        // Model Leaflet's string-vs-DOM popup contract without external requests.
        window.L = {
            tileLayer: () => ({}),
            map: () => ({ removeLayer() {} }),
            control: { layers: () => ({ addTo() {} }) },
            circleMarker: () => ({
                addTo() { return this; },
                bindPopup(content) {
                    const popup = document.createElement('div');
                    if (typeof content === 'string') popup.innerHTML = content;
                    else popup.append(content);
                    document.body.append(popup);
                    window.renderedPopups.push(popup);
                    return this;
                },
                getElement() { return null; },
            }),
        };
    });
    await page.goto('http://structiq.test/' + filename);
    return { page, requests };
}

test('asset cards and map popups display markup as literal text', async t => {
    const name = '<img src=x onerror="window.injected=true">';
    const { page } = await openPage(t, 'auth.html', [asset(1, name)]);
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 1);
    assert.equal(await page.locator('.asset-card .text-info').textContent(), name);
    assert.equal(await page.locator('.asset-card img').count(), 0);
    assert.equal(await page.evaluate(() => window.renderedPopups[0].textContent),
        name + 'Health: 80.0%');
    assert.equal(await page.evaluate(() => window.renderedPopups[0].querySelector('img')), null);
    assert.equal(await page.evaluate(() => window.injected), undefined);
});

test('quoted asset names keep chart and repair controls working after refresh', async t => {
    const name = 'O\'Brien "East" Bridge';
    const { page, requests } = await openPage(t, 'auth.html', [asset(1, name), asset(2, 'Second Bridge')]);
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 2);
    await page.evaluate(() => {
        window.showGraph = name => { window.openedGraph = name; };
    });
    for (let refresh = 0; refresh < 2; refresh++) {
        await page.locator('.asset-card .text-info').first().click();
        assert.equal(await page.evaluate(() => window.openedGraph), name);
        await page.evaluate(() => loadAssets());
        assert.equal(await page.locator('.asset-card').count(), 2);
    }
    const repairRequest = page.waitForRequest(request =>
        request.url().endsWith('/assets/2/maintenance') && request.method() === 'POST');
    await page.locator('.asset-card').nth(1).getByRole('button', { name: 'INITIATE REPAIR' }).click();
    await repairRequest;
    assert.ok(requests.some(request => request.path === '/assets/2/maintenance' && request.method === 'POST'));
});

test('citizen descriptions cannot create elements in the incident feed', async t => {
    const description = '<img src=x onerror="window.injected=true"> <b>Crack & damage</b>';
    const { page } = await openPage(t, 'auth.html', [], [
        { id: 7, asset_id: 1, severity: 10, description },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.ticket-log').length === 1);
    assert.ok((await page.locator('.ticket-log').textContent()).includes(description));
    assert.equal(await page.locator('#incident-feed img, #incident-feed b').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
});

test('the incident feed clears resolved reports on its next refresh', async t => {
    const reports = [{ id: 7, asset_id: 1, severity: 10, description: 'Surface crack' }];
    const { page } = await openPage(t, 'auth.html', [], reports);
    await page.waitForFunction(() => document.querySelectorAll('.ticket-log').length === 1);
    reports.length = 0;
    await page.evaluate(() => fetchIncidents());
    assert.equal(await page.locator('.ticket-log').count(), 0);
    assert.ok((await page.locator('#incident-feed').textContent()).includes('No open reports'));
});

test('the incident feed keeps the eight most recent reports in reverse order', async t => {
    const reports = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, asset_id: 1, severity: 5, description: 'Report ' + (i + 1),
    }));
    const { page } = await openPage(t, 'auth.html', [], reports);
    await page.waitForFunction(() => document.querySelectorAll('.ticket-log').length === 8);
    const entries = await page.locator('.ticket-log').allTextContents();
    assert.ok(entries[0].includes('REPORT #10'));
    assert.ok(entries[7].includes('REPORT #3'));
});

test('the citizen selector preserves names and IDs without parsing options from names', async t => {
    const name = '</option><option value="999">Forged & "quoted"';
    const { page } = await openPage(t, 'index.html', [asset(1, name)]);
    await page.waitForFunction(() => document.querySelector('#assetSelect').options.length > 1);
    await page.locator('#reportBtn').click();
    for (let refresh = 0; refresh < 2; refresh++) {
        const options = await page.locator('#assetSelect option').evaluateAll(options =>
            options.map(option => ({ text: option.textContent, value: option.value })));
        assert.deepEqual(options, [
            { text: 'Select Bridge or Road...', value: '' },
            { text: name, value: '1' },
        ]);
        await page.selectOption('#assetSelect', '1');
        assert.equal(await page.locator('#assetSelect').inputValue(), '1');
        await page.evaluate(() => loadAssetsForCitizen());
    }
});
