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

async function prepareReport(t) {
    const { page } = await openPage(t, 'index.html', [asset(1, 'Adyar Bridge')]);
    page.on('dialog', dialog => dialog.dismiss());
    await page.locator('#reportBtn').click();
    await page.selectOption('#incidentType', 'crack');
    await page.selectOption('#assetSelect', '1');
    await page.locator('#description').fill('Crack near the east railing');
    await page.locator('#fileInput').setInputFiles({
        name: 'bridge.png', mimeType: 'image/png', buffer: Buffer.from('test image'),
    });
    return page;
}

test('pending reports cannot show success or submit a second request', async t => {
    const page = await prepareReport(t);
    await page.clock.install();
    const pending = [];
    await page.route('**/reports/upload-ai', route => { pending.push(route); });
    const firstRequest = page.waitForRequest('**/reports/upload-ai');
    await page.locator('#reportForm button[type="submit"]').click();
    await firstRequest;
    await page.clock.fastForward(4000);
    assert.equal(await page.locator('#reportModal').isVisible(), true);
    assert.equal(await page.locator('#reportForm button[type="submit"]').isDisabled(), true);
    assert.equal(await page.locator('#description').inputValue(), 'Crack near the east railing');
    assert.ok(!(await page.locator('#reportForm').textContent()).includes('REPORT LOGGED'));
    await page.evaluate(() => document.getElementById('reportForm').requestSubmit());
    // Flush the browser's network work without relying on wall-clock sleeps.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(pending.length, 1);
    await pending[0].fulfill({ json: { report_id: 7, analysis: 'Significant Surface', severity: 10 } });
    await page.waitForFunction(() => !document.querySelector('#reportForm button[type="submit"]').disabled);
});

test('successful reports reset the form and allow the modal to reopen', async t => {
    const page = await prepareReport(t);
    await page.route('**/reports/upload-ai', route => route.fulfill({
        json: { report_id: 7, analysis: 'Significant Surface', severity: 10 },
    }));
    await page.locator('#reportForm button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('#reportModal').classList.contains('active'));
    assert.equal(await page.locator('#description').inputValue(), '');
    assert.equal(await page.locator('#fileInput').inputValue(), '');
    assert.equal(await page.locator('#uploadText').textContent(), 'Drop Photo or Click to Browse');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await page.locator('#reportBtn').click();
    assert.equal(await page.locator('#reportModal').isVisible(), true);
    assert.equal(await page.locator('#reportForm button[type="submit"]').isEnabled(), true);
});

for (const failure of ['http', 'network']) {
    test(`${failure} failures preserve the report and allow retry`, async t => {
        const page = await prepareReport(t);
        let attempts = 0;
        await page.route('**/reports/upload-ai', route => {
            attempts++;
            if (attempts > 1) return route.fulfill({
                json: { report_id: 8, analysis: 'Minor Hairline', severity: 5 },
            });
            return failure === 'network' ? route.abort('failed') : route.fulfill({
                status: 400, json: { detail: '<b>Image source is not original.</b>' },
            });
        });
        await page.locator('#reportForm button[type="submit"]').click();
        await page.locator('#reportStatus').waitFor({ state: 'visible', timeout: 3000 });
        await page.waitForFunction(() => !document.querySelector('#reportForm button[type="submit"]').disabled);
        assert.equal(await page.locator('#reportModal').isVisible(), true);
        assert.equal(await page.locator('#description').inputValue(), 'Crack near the east railing');
        assert.equal(await page.locator('#fileInput').evaluate(input => input.files[0].name), 'bridge.png');
        if (failure === 'http') {
            assert.ok((await page.locator('#reportStatus').textContent()).includes('<b>Image source is not original.</b>'));
            assert.equal(await page.locator('#reportStatus b').count(), 0);
        } else {
            assert.ok((await page.locator('#reportStatus').textContent()).includes('connection'));
        }
        await page.locator('#reportForm button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('#reportModal').classList.contains('active'));
        assert.equal(attempts, 2);
    });
}
