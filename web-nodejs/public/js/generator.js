/* =========================================================================
   Agent Generator (Phase 1: panel + preview + bundle CRUD)
   Build artifacts not yet produced; /api/d/.../download returns 503.
   ========================================================================= */

(function () {
    'use strict';

    const t = (k, def) => {
        const tr = window.t ? window.t(k) : k;
        return (tr && tr !== k) ? tr : (def != null ? def : k);
    };
    const notify = window.Notifications || { success: console.log, error: console.error, warning: console.warn, info: console.info };
    const csrf = () => (window.BetterDesk && window.BetterDesk.csrfToken) || '';

    async function api(method, url, body) {
        const headers = { 'Accept': 'application/json' };
        const writeMethods = method === 'POST' || method === 'PUT' || method === 'PATCH';
        if (writeMethods) headers['Content-Type'] = 'application/json';
        if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf();
        const opts = { method, headers, credentials: 'same-origin' };
        if (body !== undefined) {
            opts.body = JSON.stringify(body);
        } else if (writeMethods) {
            opts.body = '{}';
        }
        const res = await fetch(url, opts);
        const ct = (res.headers.get('content-type') || '');
        const data = ct.includes('application/json') ? await res.json() : null;
        if (!res.ok || (data && data.success === false)) {
            const err = new Error((data && data.error) || `HTTP ${res.status}`);
            err.data = data;
            err.status = res.status;
            throw err;
        }
        return data;
    }

    const state = {
        bundles: [],
        currentId: null,
        currentBundle: null,
        currentBuilds: [],
        platformLabels: {},
        dirty: false,
        slugManual: false,
        previewTimer: null,
        buildsPollTimer: null,
        productType: 'agent-client',
    };

    const $ = (id) => document.getElementById(id);
    const els = {};

    function cacheEls() {
        ['gen-new-bundle', 'gen-bundle-list', 'gen-editor-title', 'gen-revoke-btn', 'gen-delete-btn', 'gen-save-btn',
         'gen-rebuild-btn', 'gen-builds-list', 'gen-builds-summary',
         'gen-empty-state', 'gen-editor-form',
         'gen-name', 'gen-slug', 'gen-company', 'gen-short-text', 'gen-email', 'gen-phone', 'gen-url',
         'gen-server-host', 'gen-use-https', 'gen-token-mask',
         'gen-logo', 'gen-logo-clear', 'gen-primary', 'gen-accent', 'gen-bg', 'gen-surface', 'gen-text', 'gen-text-muted', 'gen-status-ready', 'gen-header-text', 'gen-lang', 'gen-unattended',
         'gen-download-info', 'gen-download-url', 'gen-copy-link', 'gen-open-link',
         'gen-preview', 'gen-prev-body-logo', 'gen-prev-name', 'gen-prev-text', 'gen-prev-pw-row', 'gen-prev-contact',
         'gen-validation-errors',
         'gen-new-rdgen', 'gen-rdgen-form', 'rdgen-platform', 'rdgen-hidecm', 'rdgen-passwordRequirement', 'rdgen-passApproveMode', 'rdgen-permanentPassword', 'rdgen-generate-btn', 'rdgen-success-msg'
        ].forEach(id => { els[id] = $(id); });
    }

    const DEFAULT_BRANDING = {
        company_name: '',
        short_text: '',
        contact_email: '',
        contact_phone: '',
        contact_url: '',
        logo_data_url: '',
        primary_color: '#2563eb',
        accent_color:  '#1e293b',
        background_color: '#0f172a',
        surface_color: '#1e293b',
        text_color: '#e2e8f0',
        text_muted_color: '#94a3b8',
        status_ready_color: '#22c55e',
        header_text_color: '#ffffff',
        allow_unattended: false,
        default_lang: 'en',
        server_host: '',
        use_https: true,
    };

    let logoDataUrl = '';
    let connectionDefaults = { server_host: '', use_https: true };

    const SLUG_TRANSLIT = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
        'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 'ss', 'æ': 'ae', 'ø': 'o', 'å': 'a',
        'č': 'c', 'ď': 'd', 'ě': 'e', 'ň': 'n', 'ř': 'r', 'š': 's', 'ť': 't', 'ů': 'u', 'ý': 'y', 'ž': 'z',
    };

    function slugifyName(name) {
        let slug = String(name || '').trim().toLowerCase().split('').map(ch => SLUG_TRANSLIT[ch] ?? ch).join('');
        slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (slug.length > 32) slug = slug.slice(0, 32).replace(/-$/, '');
        return slug;
    }

    function readSlugInput() {
        return (els['gen-slug'] && els['gen-slug'].value || '').trim().toLowerCase();
    }

    function updateDownloadLinkPreview() {
        const slug = readSlugInput();
        if (!els['gen-download-url']) return;
        if (state.currentId === 'new') {
            const url = slug ? `${window.location.origin}/d/${slug}` : '';
            els['gen-download-url'].value = url;
            if (els['gen-open-link']) {
                els['gen-open-link'].href = url || '#';
                els['gen-open-link'].classList.toggle('disabled', !url);
            }
            return;
        }
        if (state.currentBundle) {
            const publicId = slug || state.currentBundle.public_id || state.currentBundle.slug || state.currentBundle.bundle_id;
            const url = `${window.location.origin}/d/${publicId}`;
            els['gen-download-url'].value = url;
            if (els['gen-open-link']) {
                els['gen-open-link'].href = url;
                els['gen-open-link'].classList.remove('disabled');
            }
        }
    }

    function syncSlugFromName() {
        if (state.slugManual || !els['gen-slug']) return;
        els['gen-slug'].value = slugifyName(els['gen-name'].value);
        updateDownloadLinkPreview();
    }

    function readBranding() {
        return {
            company_name: els['gen-company'].value.trim(),
            short_text:   els['gen-short-text'].value.trim(),
            contact_email: els['gen-email'].value.trim(),
            contact_phone: els['gen-phone'].value.trim(),
            contact_url:   els['gen-url'].value.trim(),
            logo_data_url: logoDataUrl,
            primary_color: els['gen-primary'].value,
            accent_color:  els['gen-accent'].value,
            background_color: els['gen-bg'].value,
            surface_color: els['gen-surface'].value,
            text_color: els['gen-text'].value,
            text_muted_color: els['gen-text-muted'].value,
            status_ready_color: els['gen-status-ready'].value,
            header_text_color: els['gen-header-text'].value,
            allow_unattended: !!els['gen-unattended'].checked,
            default_lang: els['gen-lang'].value,
            server_host: els['gen-server-host'].value.trim(),
            use_https: !!els['gen-use-https'].checked,
        };
    }

    function writeBranding(b) {
        b = Object.assign({}, DEFAULT_BRANDING, connectionDefaults, b || {});
        els['gen-server-host'].value = b.server_host || b.server?.address?.replace(/^https?:\/\//, '').split(':')[0] || '';
        els['gen-use-https'].checked = b.use_https ?? (b.server?.address?.startsWith('https://') ?? true);
        if (els['gen-token-mask']) {
            els['gen-token-mask'].value = t('generator.enrollment_per_device', 'Per device — approve in Registrations');
        }
        els['gen-company'].value = b.company_name || '';
        els['gen-short-text'].value = b.short_text || '';
        els['gen-email'].value = b.contact_email || '';
        els['gen-phone'].value = b.contact_phone || '';
        els['gen-url'].value   = b.contact_url || '';
        els['gen-primary'].value = b.primary_color || '#2563eb';
        els['gen-accent'].value  = b.accent_color  || '#1e293b';
        els['gen-bg'].value = b.background_color || '#0f172a';
        els['gen-surface'].value = b.surface_color || '#1e293b';
        els['gen-text'].value = b.text_color || '#e2e8f0';
        els['gen-text-muted'].value = b.text_muted_color || '#94a3b8';
        els['gen-status-ready'].value = b.status_ready_color || '#22c55e';
        els['gen-header-text'].value = b.header_text_color || '#ffffff';
        els['gen-unattended'].checked = !!b.allow_unattended;
        els['gen-lang'].value = b.default_lang || 'en';
        logoDataUrl = b.logo_data_url || '';
        els['gen-logo'].value = '';
        els['gen-logo-clear'].classList.toggle('hidden', !logoDataUrl);
    }

    function escapeText(s) {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }

    function renderPreview() {
        const b = readBranding();
        const frame = els['gen-preview'].querySelector('.agent-preview-frame');
        if (frame) {
            frame.style.setProperty('--brand-primary', b.primary_color);
            frame.style.setProperty('--brand-accent',  b.accent_color);
            frame.style.setProperty('--brand-bg', b.background_color || '#0f172a');
            frame.style.setProperty('--brand-surface', b.surface_color || '#1e293b');
            frame.style.setProperty('--brand-text', b.text_color || '#e2e8f0');
            frame.style.setProperty('--brand-text-muted', b.text_muted_color || '#94a3b8');
            frame.style.setProperty('--brand-status-ready', b.status_ready_color || '#22c55e');
            frame.style.setProperty('--brand-header-text', b.header_text_color || '#ffffff');
        }
        const logoEl = els['gen-prev-body-logo'];
        if (b.logo_data_url) {
            logoEl.innerHTML = `<img src="${escapeText(b.logo_data_url)}" alt="">`;
        } else {
            logoEl.innerHTML = '<span class="material-icons">support_agent</span>';
        }
        els['gen-prev-name'].textContent = b.company_name || t('generator.preview_default_name', 'BetterDesk Support');
        els['gen-prev-text'].textContent = b.short_text || '';
        els['gen-prev-pw-row'].classList.remove('hidden');
        const parts = [];
        if (b.contact_email) parts.push(b.contact_email);
        if (b.contact_phone) parts.push(b.contact_phone);
        if (b.contact_url)   parts.push(b.contact_url);
        els['gen-prev-contact'].textContent = parts.join(' • ');
    }

    function schedulePreview() {
        if (state.previewTimer) clearTimeout(state.previewTimer);
        state.previewTimer = setTimeout(renderPreview, 60);
    }

    function markDirty() {
        state.dirty = true;
        els['gen-save-btn'].disabled = false;
        schedulePreview();
    }

    function fmtDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString();
    }

    function platformKey(p, a, f) {
        return `${p}/${a}/${f}`;
    }

    function platformLabel(p, a, f) {
        return state.platformLabels[platformKey(p, a, f)]
            || `${p} ${a} ${f}`;
    }

    function statusLabel(status) {
        const map = {
            ready: t('generator.build_status_ready', 'Ready'),
            pending: t('generator.build_status_pending', 'Queued'),
            queued: t('generator.build_status_pending', 'Queued'),
            building: t('generator.build_status_building', 'Building'),
            failed: t('generator.build_status_failed', 'Failed'),
        };
        return map[status] || status;
    }

    function summarizeBuilds(builds) {
        const counts = { ready: 0, pending: 0, building: 0, failed: 0 };
        for (const b of builds || []) {
            const status = b.status === 'queued' ? 'pending' : b.status;
            if (counts[status] != null) counts[status]++;
        }
        return counts;
    }

    function buildsNeedPoll(builds) {
        return (builds || []).some(
            (b) => b.status === 'queued' || b.status === 'pending' || b.status === 'building'
        );
    }

    function stopBuildsPoll() {
        if (state.buildsPollTimer) {
            clearInterval(state.buildsPollTimer);
            state.buildsPollTimer = null;
        }
    }

    function scheduleBuildsPoll() {
        stopBuildsPoll();
        if (!state.currentId || state.currentId === 'new') return;
        if (!buildsNeedPoll(state.currentBuilds)) return;
        state.buildsPollTimer = setInterval(() => {
            refreshBuilds().catch(() => {});
        }, 5000);
    }

    function classifyBuildErrorClient(msg) {
        const s = String(msg || '');
        if (/not in std|Go toolchain|stdlib verification|go:|cannot find package/i.test(s)) {
            return t('generator.toolchain_go', 'Go toolchain missing or unhealthy');
        }
        if (/wixl|msitools|\.wxs/i.test(s)) {
            return t('generator.toolchain_wixl', 'wixl (msitools) required for Windows .msi builds');
        }
        if (/appimagetool|AppImage/i.test(s)) {
            return t('generator.toolchain_appimage', 'appimagetool required for Linux AppImage builds');
        }
        if (/dpkg-deb|fakeroot|\.deb/i.test(s)) {
            return t('generator.toolchain_deb', 'dpkg-deb / fakeroot required for .deb packages');
        }
        if (/rpmbuild|\.rpm/i.test(s)) {
            return t('generator.toolchain_rpm', 'rpmbuild required for .rpm packages');
        }
        if (/mesa|opengl|libGL|WGL/i.test(s)) {
            return t('generator.toolchain_mesa', 'Mesa/OpenGL support needed for Windows GUI builds');
        }
        if (/mingw|x86_64-w64-mingw|gcc|cgo/i.test(s)) {
            return t('generator.toolchain_cgo', 'CGO / mingw cross-compiler required for Windows Fyne builds');
        }
        return t('generator.build_error_hint', 'Build error');
    }

    function renderBuilds(builds) {
        state.currentBuilds = builds || [];
        const listEl = els['gen-builds-list'];
        const summaryEl = els['gen-builds-summary'];
        if (!listEl) return;

        if (!builds || !builds.length) {
            listEl.innerHTML = `<p class="text-muted">${escapeText(t('generator.builds_empty', 'No builds queued yet'))}</p>`;
            summaryEl.classList.add('hidden');
            stopBuildsPoll();
            return;
        }

        const counts = summarizeBuilds(builds);
        summaryEl.textContent = t('generator.builds_summary', '{{ready}} ready · {{pending}} queued · {{building}} building · {{failed}} failed')
            .replace('{{ready}}', counts.ready)
            .replace('{{pending}}', counts.pending)
            .replace('{{building}}', counts.building)
            .replace('{{failed}}', counts.failed);
        summaryEl.classList.remove('hidden');

        const rows = [...builds].sort((a, b) => {
            const la = platformLabel(a.platform, a.arch, a.format);
            const lb = platformLabel(b.platform, b.arch, b.format);
            return la.localeCompare(lb);
        });

        listEl.innerHTML = `
            <table class="builds-table">
                <thead>
                    <tr>
                        <th>${escapeText(t('generator.builds_title', 'Client builds'))}</th>
                        <th>${escapeText(t('common.status', 'Status'))}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(b => {
                        const hint = b.error_message
                            ? `<div class="build-error-hint">${escapeText(classifyBuildErrorClient(b.error_message))}</div>`
                            : '';
                        const err = b.error_message
                            ? `<div class="build-error" title="${escapeText(b.error_message)}">${escapeText(b.error_message)}</div>`
                            : '';
                        const retry = b.status === 'failed'
                            ? `<button type="button" class="btn btn-ghost btn-xs gen-retry-build"
                                data-platform="${escapeText(b.platform)}"
                                data-arch="${escapeText(b.arch)}"
                                data-format="${escapeText(b.format)}">
                                <span class="material-icons">replay</span>
                                ${escapeText(t('generator.retry_build', 'Retry'))}
                               </button>`
                            : '';
                        return `
                            <tr class="build-row build-row--${escapeText(b.status)}">
                                <td>${escapeText(platformLabel(b.platform, b.arch, b.format))}${hint}${err}</td>
                                <td><span class="build-badge build-badge--${escapeText(b.status)}">${escapeText(statusLabel(b.status))}</span></td>
                                <td class="build-actions">${retry}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        listEl.querySelectorAll('.gen-retry-build').forEach((btn) => {
            btn.addEventListener('click', () => retryPlatformBuild(
                btn.dataset.platform,
                btn.dataset.arch,
                btn.dataset.format
            ));
        });

        scheduleBuildsPoll();
    }

    async function retryPlatformBuild(platform, arch, format) {
        if (!state.currentId || state.currentId === 'new') return;
        try {
            const res = await api(
                'POST',
                `/api/generator/bundles/${encodeURIComponent(state.currentId)}/rebuild/`
                    + `${encodeURIComponent(platform)}/${encodeURIComponent(arch)}/${encodeURIComponent(format)}`
            );
            notify.success(t('generator.retry_queued', 'Platform build queued'));
            renderBuilds((res && res.data && res.data.builds) || []);
        } catch (e) {
            notify.error(e.message);
        }
    }

    async function loadToolchainStatus() {
        const banner = els['gen-toolchain-banner'];
        if (!banner) return;
        try {
            const res = await api('GET', '/api/generator/build-status');
            const d = (res && res.data) || {};
            const issues = [];
            if (!d.workerEnabled) {
                issues.push(t('generator.toolchain_worker_off', 'Agent build worker is disabled'));
            }
            if (!d.goHealthy) {
                issues.push(t('generator.toolchain_go_missing', 'Go is not available'));
            }
            if (!d.msiBuilder) {
                issues.push(t('generator.toolchain_msi_missing', 'MSI builder (wixl) not found'));
            }
            if (d.rebuildPending) {
                issues.push(
                    t('generator.rebuild_pending_banner', 'A generator rebuild is pending')
                        .replace('{{reason}}', d.rebuildPending.reason || 'update')
                );
            }
            if (issues.length) {
                banner.className = 'toolchain-banner toolchain-banner--warn';
                banner.textContent = issues.join(' · ');
                banner.classList.remove('hidden');
            } else {
                banner.className = 'toolchain-banner toolchain-banner--ok';
                banner.textContent = t('generator.toolchain_banner_ok', 'Build toolchain ready (Go {{go}}).')
                    .replace('{{go}}', d.goBin || 'go');
                banner.classList.remove('hidden');
            }
        } catch (_) {
            banner.classList.add('hidden');
        }
    }

    async function refreshBuilds() {
        if (!state.currentId || state.currentId === 'new') return;
        const res = await api('GET', `/api/generator/bundles/${encodeURIComponent(state.currentId)}`);
        if (res && res.data && res.data.bundle) {
            state.currentBundle = res.data.bundle;
            renderBuilds(res.data.bundle.builds || []);
        }
    }

    async function rebuildAllBuilds() {
        if (!state.currentBundle || state.currentId === 'new') return;
        if (!confirm(t('generator.rebuild_confirm', 'Rebuild all platform installers for this bundle?'))) return;
        const btn = els['gen-rebuild-btn'];
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="material-icons spinning">sync</span> ${escapeText(t('generator.rebuilding_all', 'Queuing rebuilds…'))}`;
        }
        try {
            const res = await api('POST', `/api/generator/bundles/${encodeURIComponent(state.currentId)}/rebuild`);
            notify.success(t('generator.rebuild_queued', 'All platform builds queued'));
            renderBuilds((res && res.data && res.data.builds) || []);
        } catch (e) {
            notify.error(e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span class="material-icons">sync</span> ${escapeText(t('generator.rebuild_all', 'Rebuild all'))}`;
            }
        }
    }

    function renderBundleList() {
        const root = els['gen-bundle-list'];
        if (!state.bundles.length) {
            root.innerHTML = `<p class="text-muted">${escapeText(t('generator.no_bundles', 'No bundles yet'))}</p>`;
            return;
        }
        root.innerHTML = '';
        state.bundles.forEach(bundle => {
            const item = document.createElement('div');
            item.className = 'bundle-item';
            if (bundle.bundle_id === state.currentId) item.classList.add('active');
            item.dataset.bundleId = bundle.bundle_id;
            const revokedBadge = bundle.revoked
                ? `<span class="badge-revoked">${escapeText(t('generator.revoked', 'Revoked'))}</span>`
                : '';
            const pt = bundle.product_type || 'support-agent';
            const productBadge = pt === 'rdclient'
                ? `<span class="badge-product">${escapeText(t('generator.product_rdclient', 'RdClient'))}</span>`
                : pt === 'support-agent' || pt === 'agent'
                    ? `<span class="badge-product">${escapeText(t('generator.product_support_agent', 'Support'))}</span>`
                    : `<span class="badge-product">${escapeText(t('generator.product_agent_client', 'Agent Client'))}</span>`;
            item.innerHTML = `
                <div class="bundle-item-title">
                    ${escapeText(bundle.name || bundle.bundle_id)}
                    ${productBadge}
                    ${revokedBadge}
                </div>
                <div class="bundle-item-meta">
                    <span>${escapeText(fmtDate(bundle.created_at))}</span>
                    <span>↓ ${bundle.download_count || 0}</span>
                </div>
            `;
            item.addEventListener('click', () => selectBundle(bundle.bundle_id));
            root.appendChild(item);
        });
    }

    async function loadBundles() {
        try {
            const res = await api('GET', '/api/generator/bundles');
            state.bundles = (res && res.data && res.data.bundles) || [];
            renderBundleList();
        } catch (e) {
            notify.error(e.message, t('generator.title', 'Generator'));
        }
    }

    function showEditor() {
        els['gen-empty-state'].classList.add('hidden');
        if (els['gen-rdgen-form']) els['gen-rdgen-form'].classList.add('hidden');
        els['gen-editor-form'].classList.remove('hidden');
        els['gen-save-btn'].classList.remove('hidden');
    }

    function hideEditor() {
        els['gen-empty-state'].classList.remove('hidden');
        els['gen-editor-form'].classList.add('hidden');
        if (els['gen-rdgen-form']) els['gen-rdgen-form'].classList.add('hidden');
        els['gen-revoke-btn'].classList.add('hidden');
        els['gen-delete-btn'].classList.add('hidden');
        els['gen-download-info'].classList.add('hidden');
        els['gen-save-btn'].classList.remove('hidden');
        els['gen-save-btn'].disabled = true;
    }

    function showRdgenForm() {
        state.currentId = 'rdgen';
        state.currentBundle = null;
        state.productType = 'rdgen';
        stopBuildsPoll();
        
        els['gen-editor-title'].innerHTML = `<span class="material-icons">handyman</span> ${escapeText(t('generator.rdgen_form_title', 'RustDesk Custom Client Builder'))}`;
        
        els['gen-empty-state'].classList.add('hidden');
        els['gen-editor-form'].classList.add('hidden');
        els['gen-revoke-btn'].classList.add('hidden');
        els['gen-delete-btn'].classList.add('hidden');
        els['gen-save-btn'].classList.add('hidden');
        
        if (els['gen-rdgen-form']) els['gen-rdgen-form'].classList.remove('hidden');
        loadRdgenPresets();
        loadRdgenHistory(true);
        
        if (connectionDefaults) {
            const serverIPInput = document.getElementById('rdgen-serverIP');
            const keyInput = document.getElementById('rdgen-key');
            const apiServerInput = document.getElementById('rdgen-apiServer');

            if (serverIPInput && (!serverIPInput.value || serverIPInput.value === 'localhost')) {
                serverIPInput.value = connectionDefaults.server_host || '';
            }
            if (keyInput && (!keyInput.value || keyInput.value.includes('localhost'))) {
                keyInput.value = connectionDefaults.public_key || '';
            }
            if (apiServerInput && (!apiServerInput.value || apiServerInput.value.includes('localhost'))) {
                apiServerInput.value = connectionDefaults.api_server || (connectionDefaults.server_host ? `https://${connectionDefaults.server_host}` : '');
            }
        }

        document.querySelectorAll('.bundle-item').forEach(el => el.classList.remove('active'));
    }

    function setEditorForNew(productType) {
        state.currentId = 'new';
        state.currentBundle = null;
        state.currentBuilds = [];
        state.dirty = false;
        state.slugManual = false;
        state.productType = productType || 'agent-client';
        stopBuildsPoll();
        const titleKey = state.productType === 'rdclient'
            ? 'generator.rdclient_new_bundle'
            : state.productType === 'support-agent'
                ? 'generator.support_agent_new_bundle'
                : 'generator.agent_client_new_bundle';
        els['gen-editor-title'].innerHTML = `<span class="material-icons">add_circle</span> ${escapeText(t(titleKey, 'New bundle'))}`;
        els['gen-name'].value = '';
        if (els['gen-slug']) els['gen-slug'].value = '';
        writeBranding(DEFAULT_BRANDING);
        els['gen-revoke-btn'].classList.add('hidden');
        els['gen-delete-btn'].classList.add('hidden');
        els['gen-download-info'].classList.remove('hidden');
        const buildsSection = $('gen-builds-section');
        if (buildsSection) buildsSection.classList.add('hidden');
        els['gen-download-url'].value = '';
        if (els['gen-open-link']) {
            els['gen-open-link'].href = '#';
            els['gen-open-link'].classList.add('disabled');
        }
        els['gen-save-btn'].disabled = false;
        clearErrors();
        showEditor();
        renderBundleList();
        renderPreview();
        els['gen-name'].focus();
    }

    function setEditorForBundle(bundle) {
        state.currentId = bundle.bundle_id;
        state.currentBundle = bundle;
        state.productType = bundle.product_type || 'support-agent';
        state.dirty = false;
        state.slugManual = true;
        stopBuildsPoll();
        els['gen-editor-title'].innerHTML = `<span class="material-icons">edit</span> ${escapeText(bundle.name || bundle.bundle_id)}`;
        els['gen-name'].value = bundle.name || '';
        if (els['gen-slug']) els['gen-slug'].value = bundle.slug || bundle.public_id || '';
        writeBranding(bundle.branding);
        els['gen-revoke-btn'].classList.remove('hidden');
        els['gen-revoke-btn'].innerHTML = bundle.revoked
            ? `<span class="material-icons">undo</span> ${escapeText(t('generator.unrevoke', 'Unrevoke'))}`
            : `<span class="material-icons">block</span> ${escapeText(t('generator.revoke', 'Revoke'))}`;
        els['gen-delete-btn'].classList.remove('hidden');
        els['gen-save-btn'].disabled = true;
        updateDownloadLinkPreview();
        els['gen-download-info'].classList.remove('hidden');
        const buildsSection = $('gen-builds-section');
        if (buildsSection) buildsSection.classList.remove('hidden');
        renderBuilds(bundle.builds || []);
        clearErrors();
        showEditor();
        renderBundleList();
        renderPreview();
    }

    async function selectBundle(bundleId) {
        if (state.dirty && !confirm(t('generator.unsaved_confirm', 'Discard unsaved changes?'))) return;
        try {
            const res = await api('GET', `/api/generator/bundles/${encodeURIComponent(bundleId)}`);
            setEditorForBundle(res.data.bundle);
        } catch (e) {
            notify.error(e.message);
        }
    }

    function clearErrors() {
        els['gen-validation-errors'].classList.add('hidden');
        els['gen-validation-errors'].innerHTML = '';
    }

    function fmtError(key) {
        if (!key) return '';
        const translated = t(`generator.errors.${key}`, null);
        return translated || key;
    }

    function showErrors(errors) {
        if (!errors || !errors.length) { clearErrors(); return; }
        const items = errors.map(e => `<li>${escapeText(fmtError(e))}</li>`).join('');
        els['gen-validation-errors'].innerHTML = `
            <strong>${escapeText(t('generator.errors.validation_failed', 'Validation failed'))}</strong>
            <ul>${items}</ul>
        `;
        els['gen-validation-errors'].classList.remove('hidden');
    }

    async function saveBundle() {
        clearErrors();
        const payload = {
            name: els['gen-name'].value.trim(),
            slug: readSlugInput(),
            branding: readBranding(),
            product_type: state.productType || 'agent',
        };
        if (!payload.name) {
            showErrors([t('generator.errors.name_required', 'Bundle name is required')]);
            return;
        }
        els['gen-save-btn'].disabled = true;
        try {
            let res;
            if (state.currentId === 'new') {
                res = await api('POST', '/api/generator/bundles', payload);
                notify.success(t('generator.created', 'Bundle created'));
            } else {
                res = await api('PUT', `/api/generator/bundles/${encodeURIComponent(state.currentId)}`, payload);
                notify.success(t('generator.saved', 'Bundle saved'));
            }
            await loadBundles();
            if (res && res.data && res.data.bundle) {
                setEditorForBundle(res.data.bundle);
                refreshBuilds().catch(() => {});
            }
        } catch (e) {
            const errs = (e.data && e.data.errors) || [e.message];
            showErrors(errs);
            els['gen-save-btn'].disabled = false;
        }
    }

    async function toggleRevoke() {
        if (!state.currentBundle) return;
        const newState = !state.currentBundle.revoked;
        const confirmMsg = newState
            ? t('generator.confirm_revoke', 'Revoke this bundle? The download link will stop working.')
            : t('generator.confirm_unrevoke', 'Re-enable this bundle?');
        if (!confirm(confirmMsg)) return;
        try {
            const res = await api('POST', `/api/generator/bundles/${encodeURIComponent(state.currentId)}/revoke`, { revoked: newState });
            notify.success(newState ? t('generator.revoked_ok', 'Bundle revoked') : t('generator.unrevoked_ok', 'Bundle re-enabled'));
            await loadBundles();
            if (res && res.data && res.data.bundle) setEditorForBundle(res.data.bundle);
        } catch (e) {
            notify.error(e.message);
        }
    }

    async function deleteBundle() {
        if (!state.currentBundle) return;
        if (!confirm(t('generator.confirm_delete', 'Delete this bundle permanently? This cannot be undone.'))) return;
        try {
            await api('DELETE', `/api/generator/bundles/${encodeURIComponent(state.currentId)}`);
            notify.success(t('generator.deleted', 'Bundle deleted'));
            state.currentId = null;
            state.currentBundle = null;
            state.dirty = false;
            hideEditor();
            await loadBundles();
        } catch (e) {
            notify.error(e.message);
        }
    }

    function onLogoChange(ev) {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            notify.error(t('generator.errors.logo_invalid', 'Logo must be an image file'));
            els['gen-logo'].value = '';
            return;
        }
        if (file.size > 256 * 1024) {
            notify.error(t('generator.errors.logo_too_large', 'Logo must be 256KB or smaller'));
            els['gen-logo'].value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            logoDataUrl = reader.result;
            els['gen-logo-clear'].classList.remove('hidden');
            markDirty();
        };
        reader.onerror = () => notify.error(t('generator.errors.logo_read_failed', 'Failed to read logo file'));
        reader.readAsDataURL(file);
    }

    function clearLogo() {
        logoDataUrl = '';
        els['gen-logo'].value = '';
        els['gen-logo-clear'].classList.add('hidden');
        markDirty();
    }

    function copyDownloadLink() {
        const url = els['gen-download-url'].value;
        if (!url) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(
                () => notify.success(t('generator.link_copied', 'Link copied')),
                () => fallbackCopy(url)
            );
        } else {
            fallbackCopy(url);
        }
    }

    function fallbackCopy(text) {
        els['gen-download-url'].select();
        try {
            document.execCommand('copy');
            notify.success(t('generator.link_copied', 'Link copied'));
        } catch (_) {
            notify.warning(t('generator.copy_failed', 'Could not copy automatically; please copy manually'));
        }
    }

    async function loadConnectionDefaults() {
        try {
            const res = await api('GET', '/api/generator/defaults');
            const d = (res && res.data) || {};
            connectionDefaults = {
                server_host: d.server_host || '',
                use_https: d.use_https !== false,
                public_key: d.public_key || '',
                api_server: d.api_server || '',
            };
        } catch (_) {
            connectionDefaults = { server_host: '', use_https: true, public_key: '', api_server: '' };
        }
    }

    async function loadPlatformLabels() {
        try {
            const res = await api('GET', '/api/generator/platforms');
            const platforms = (res && res.data && res.data.platforms) || [];
            state.platformLabels = {};
            platforms.forEach(p => {
                state.platformLabels[platformKey(p.platform, p.arch, p.format)] = p.label;
            });
        } catch (_) {
            state.platformLabels = {};
        }
    }

    function bindEvents() {
        els['gen-new-bundle'].addEventListener('click', () => setEditorForNew('agent-client'));
        const supportBtn = $('gen-new-support');
        if (supportBtn) supportBtn.addEventListener('click', () => setEditorForNew('support-agent'));
        const rdBtn = $('gen-new-rdclient');
        if (rdBtn) rdBtn.addEventListener('click', () => setEditorForNew('rdclient'));
        const rdgenBtn = $('gen-new-rdgen');
        if (rdgenBtn) rdgenBtn.addEventListener('click', showRdgenForm);
        els['gen-save-btn'].addEventListener('click', saveBundle);
        els['gen-rebuild-btn'].addEventListener('click', rebuildAllBuilds);
        els['gen-revoke-btn'].addEventListener('click', toggleRevoke);
        els['gen-delete-btn'].addEventListener('click', deleteBundle);
        els['gen-logo'].addEventListener('change', onLogoChange);
        els['gen-logo-clear'].addEventListener('click', clearLogo);
        els['gen-copy-link'].addEventListener('click', copyDownloadLink);

        if (els['gen-name']) {
            els['gen-name'].addEventListener('input', () => {
                syncSlugFromName();
                markDirty();
            });
        }
        if (els['gen-slug']) {
            els['gen-slug'].addEventListener('input', () => {
                state.slugManual = true;
                els['gen-slug'].value = els['gen-slug'].value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                updateDownloadLinkPreview();
                markDirty();
            });
        }

        [         'gen-company', 'gen-short-text', 'gen-email', 'gen-phone', 'gen-url',
         'gen-server-host', 'gen-use-https',
         'gen-primary', 'gen-accent', 'gen-bg', 'gen-surface', 'gen-text', 'gen-text-muted', 'gen-status-ready', 'gen-header-text', 'gen-lang', 'gen-unattended'
        ].forEach(id => {
            const el = els[id];
            if (!el) return;
            const evt = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'color') ? 'change' : 'input';
            el.addEventListener(evt, markDirty);
        });
    }

    // Collect all rdgen form fields into a plain object
    function collectRdgenConfig() {
        const config = {};
        const inputs = (els['gen-rdgen-form'] || document).querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const id = input.id || '';
            if (id === 'rdgen-preset-name' || id === 'rdgen-preset-select') return;
            const key = input.name || (id.startsWith('rdgen-') ? id : null);
            if (!key || input.type === 'file') return;
            if (input.type === 'checkbox') config[key] = input.checked;
            else if (input.type === 'radio') { if (input.checked) config[key] = input.value; }
            else config[key] = input.value;
        });
        return config;
    }

    // Restore form fields from a saved config object
    function applyRdgenConfig(config) {
        if (!config) return;
        Object.entries(config).forEach(([key, value]) => {
            const el = document.getElementById(key) || document.querySelector(`[name="${key}"]`);
            if (!el) return;
            if (el.type === 'checkbox') el.checked = !!value;
            else if (el.type === 'radio') el.checked = (el.value === value);
            else el.value = value;
        });
        // Re-sync platform button active state
        const platform = config['rdgen-platform'] || config.platform;
        if (platform) {
            document.querySelectorAll('.platform-icon-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.platform === platform);
            });
        }
    }

    async function loadRdgenPresets() {
        const sel = document.getElementById('rdgen-preset-select');
        if (!sel) return;
        try {
            const res = await fetch('/api/generator/rdgen/presets');
            const data = await res.json();
            if (!data.success) return;
            sel.innerHTML = '<option value="">— Load a preset —</option>';
            (data.presets || []).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                opt.dataset.config = p.config_json;
                sel.appendChild(opt);
            });
        } catch (_) {}
    }

    function bindRdgenEvents() {
        // Load presets list on form open
        loadRdgenPresets();

        // Preset: Load
        const btnLoad = document.getElementById('btn-load-preset');
        if (btnLoad) {
            btnLoad.addEventListener('click', () => {
                const sel = document.getElementById('rdgen-preset-select');
                const opt = sel && sel.selectedOptions[0];
                if (!opt || !opt.dataset.config) return;
                try {
                    applyRdgenConfig(JSON.parse(opt.dataset.config));
                    notify.success('Preset loaded');
                } catch (_) {}
            });
        }

        // Preset: Save
        const btnSave = document.getElementById('btn-save-preset');
        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const nameInput = document.getElementById('rdgen-preset-name');
                const name = nameInput && nameInput.value.trim();
                if (!name) { if (nameInput) nameInput.focus(); return; }
                try {
                    const res = await fetch('/api/generator/rdgen/presets', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                        body: JSON.stringify({ name, config: collectRdgenConfig() })
                    });
                    const data = await res.json();
                    if (data.success) {
                        if (nameInput) nameInput.value = '';
                        notify.success('Preset saved');
                        await loadRdgenPresets();
                        loadRdgenSidebarPresets();
                    } else {
                        notify.error(data.error || 'Failed to save preset');
                    }
                } catch (err) {
                    notify.error(err.message || 'Failed to save preset');
                }
            });
        }

        // Preset: Delete
        const btnDel = document.getElementById('btn-delete-preset');
        if (btnDel) {
            btnDel.addEventListener('click', async () => {
                const sel = document.getElementById('rdgen-preset-select');
                const id = sel && sel.value;
                if (!id) return;
                try {
                    const res = await fetch(`/api/generator/rdgen/presets/${id}`, {
                        method: 'DELETE',
                        headers: { 'X-CSRF-Token': csrf() }
                    });
                    const data = await res.json();
                    if (data.success) {
                        notify.success('Preset deleted');
                        await loadRdgenPresets();
                        loadRdgenSidebarPresets();
                    }
                } catch (err) {
                    notify.error(err.message || 'Failed to delete preset');
                }
            });
        }

        const platformBtns = document.querySelectorAll('.platform-icon-btn');
        platformBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                platformBtns.forEach(b => b.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                if (els['rdgen-platform']) {
                    els['rdgen-platform'].value = target.dataset.platform;
                }
            });
        });

        if (els['rdgen-hidecm']) {
            els['rdgen-hidecm'].addEventListener('change', function() {
                if (this.checked) {
                    els['rdgen-passwordRequirement'].style.display = 'block';
                    if (els['rdgen-permanentPassword']) els['rdgen-permanentPassword'].focus();
                    if (els['rdgen-passApproveMode']) els['rdgen-passApproveMode'].value = 'password';
                } else {
                    els['rdgen-passwordRequirement'].style.display = 'none';
                    if (els['rdgen-passApproveMode']) els['rdgen-passApproveMode'].value = 'password-click';
                }
            });
        }
        
        if (els['rdgen-generate-btn']) {
            els['rdgen-generate-btn'].addEventListener('click', async () => {
                const btn = els['rdgen-generate-btn'];
                btn.disabled = true;
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="material-icons rotating">sync</span> Generating...';

                try {
                    const fd = new FormData();
                    const inputs = els['gen-rdgen-form'].querySelectorAll('input, select, textarea');
                    inputs.forEach(input => {
                        let name = input.name;
                        if (!name && input.id && input.id.startsWith('rdgen-')) {
                            name = input.id.replace('rdgen-', '');
                        }
                        if (!name) return;

                        if (input.type === 'file') {
                            if (input.files[0]) fd.append(input.id, input.files[0]); // name must match exactly (e.g. rdgen-iconfile)
                        } else if (input.type === 'checkbox') {
                            fd.append(name, input.checked);
                        } else if (input.type === 'radio') {
                            if (input.checked) fd.append(name, input.value);
                        } else {
                            fd.append(name, input.value);
                        }
                    });

                    const res = await fetch('/api/generator/rdgen/generate', {
                        method: 'POST',
                        headers: { 'X-CSRF-Token': csrf() },
                        body: fd
                    });
                    const data = await res.json();
                    if (!data.success) {
                        throw new Error(data.error || 'Failed to start generator');
                    }

                    if (els['rdgen-success-msg']) {
                        const uuid = data.uuid;
                        const portalUrl = `/rdgen/${uuid}`;

                        // Show brief "dispatching" message, then transition to portal link
                        els['rdgen-success-msg'].style.display = 'block';
                        els['rdgen-success-msg'].style.color = '';
                        els['rdgen-success-msg'].innerHTML =
                            `<span style="display:flex;align-items:center;gap:10px;">` +
                            `<span class="material-icons rotating" style="font-size:18px;color:var(--color-accent)">sync</span>` +
                            `Build dispatched to GitHub Actions…</span>`;

                        btn.disabled = false;
                        btn.innerHTML = originalText;

                        // After 2 seconds, show the portal link prominently
                        setTimeout(() => {
                            els['rdgen-success-msg'].innerHTML =
                                `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:10px;">` +
                                `<span style="color:var(--color-success);font-weight:600;">✓ Build started!</span>` +
                                `<a href="${portalUrl}" target="_blank" rel="noopener"` +
                                ` style="display:inline-flex;align-items:center;gap:8px;background:var(--color-primary,#3b82f6);` +
                                `color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;` +
                                `box-shadow:0 4px 14px rgba(59,130,246,.35);transition:transform .15s">` +
                                `<span class="material-icons" style="font-size:18px">open_in_new</span>` +
                                `View Build Status &amp; Download</a>` +
                                `<span style="color:var(--color-text-muted);font-size:13px;">` +
                                `The build page updates live when GitHub Actions completes.</span></div>`;
                        }, 2000);

                        // Load history immediately & start polling
                        setTimeout(() => loadRdgenHistory(true), 500);
                        if (!rdgenHistoryPollTimer) {
                            rdgenHistoryPollTimer = setInterval(() => loadRdgenHistory(true), 15000);
                        }
                    }


                } catch (e) {
                    alert(e.message);
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            });
        }
    }


    function bindAutoProvisionEvents() {
        const btnBanner = document.getElementById('btn-auto-provision-banner');
        const modal = document.getElementById('github-provision-modal');
        const btnSubmitModal = document.getElementById('btn-submit-github-provision');
        const patInput = document.getElementById('github-pat-input');
        const repoInput = document.getElementById('github-repo-name');
        const statusDiv = document.getElementById('github-provision-status');
        const statusText = document.getElementById('github-provision-status-text');
        const labelStatus = document.getElementById('github-provision-status-label');

        if (btnBanner) {
            btnBanner.addEventListener('click', async () => {
                try {
                    const res = await fetch('/api/generator/rdgen/settings');
                    const settings = await res.json();

                    if (settings.success && settings.GHBEARER && settings.GHBEARER === '********') {
                        btnBanner.disabled = true;
                        btnBanner.innerHTML = '<span class="material-icons rotating">sync</span> Provisioning...';
                        if (labelStatus) labelStatus.textContent = '⚡ Provisioning repo & GitHub Actions secrets...';

                        const pRes = await fetch('/api/generator/rdgen/provision', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                            body: JSON.stringify({})
                        });
                        const pData = await pRes.json();
                        btnBanner.disabled = false;
                        btnBanner.innerHTML = '<span class="material-icons">check_circle</span> Re-provision / Sync';

                        if (pData.success) {
                            if (labelStatus) labelStatus.textContent = `✓ Repository configured: ${pData.ghUser}/${pData.repoName} (${pData.branch}). Actions & Secrets active.`;
                        } else {
                            if (labelStatus) labelStatus.textContent = `✗ Provisioning failed: ${pData.error}`;
                            alert('Provisioning failed: ' + pData.error);
                        }
                    } else {
                        if (modal) modal.classList.remove('hidden');
                    }
                } catch (e) {
                    alert('Provisioning error: ' + e.message);
                }
            });
        }

        if (btnSubmitModal) {
            btnSubmitModal.addEventListener('click', async () => {
                const pat = patInput ? patInput.value.trim() : '';
                const repoName = repoInput ? repoInput.value.trim() : 'rdgen';

                if (!pat) {
                    alert('Please enter a GitHub Personal Access Token (PAT)');
                    return;
                }

                if (statusDiv) statusDiv.style.display = 'block';
                if (statusText) statusText.textContent = 'Provisioning repository & configuring secrets...';
                btnSubmitModal.disabled = true;

                try {
                    const pRes = await fetch('/api/generator/rdgen/provision', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                        body: JSON.stringify({ pat, repoName })
                    });
                    const pData = await pRes.json();
                    btnSubmitModal.disabled = false;

                    if (pData.success) {
                        if (modal) modal.classList.add('hidden');
                        if (statusDiv) statusDiv.style.display = 'none';
                        if (labelStatus) labelStatus.textContent = `✓ Repository configured: ${pData.ghUser}/${pData.repoName} (${pData.branch}). Actions & Secrets active.`;
                        if (btnBanner) btnBanner.innerHTML = '<span class="material-icons">check_circle</span> Re-provision / Sync';
                        alert(`GitHub Repository successfully provisioned as ${pData.ghUser}/${pData.repoName}!`);
                    } else {
                        if (statusText) statusText.textContent = 'Failed: ' + pData.error;
                    }
                } catch (e) {
                    btnSubmitModal.disabled = false;
                    if (statusText) statusText.textContent = 'Error: ' + e.message;
                }
            });
        }
    }

    // ── Build History & Progress ───────────────────────────────────────────────

    let rdgenHistoryPollTimer = null;

    function platformLabel(p) {
        return { windows: 'Windows 64-bit', 'windows-x86': 'Windows 32-bit', linux: 'Linux', android: 'Android', macos: 'macOS' }[p] || p || 'Unknown';
    }

    function statusColor(s) {
        if (!s) return '#888';
        if (s === 'success') return '#22c55e';
        if (['failure', 'cancelled', 'timed_out'].includes(s)) return '#ef4444';
        return '#3b82f6'; // in progress / queued
    }

    function statusIcon(s) {
        if (s === 'success') return 'check_circle';
        if (['failure', 'cancelled', 'timed_out'].includes(s)) return 'error';
        return 'pending';
    }

    const TERMINAL_STATUSES = new Set(['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'action_required']);

    function buildDownloadLinks(run) {
        const fn = run.filename || 'rustdesk';
        const uuid = run.uuid;
        const p = (run.platform || '').toLowerCase();
        const base = `/api/generator/rdgen/download/${uuid}/`;
        const files = {
            windows: [`${fn}.exe`, `${fn}.msi`],
            'windows-x86': [`${fn}.exe`],
            linux: [`${fn}-x86_64.deb`, `${fn}-x86_64.rpm`, `${fn}-x86_64.AppImage`, `${fn}-aarch64.deb`, `${fn}-aarch64.rpm`, `${fn}-aarch64.AppImage`],
            android: [`${fn}-aarch64.apk`, `${fn}-x86_64.apk`, `${fn}-armv7.apk`],
            macos: [`${fn}-x86_64.dmg`, `${fn}-aarch64.dmg`],
        };
        const list = files[p] || [];
        if (!list.length) return '';
        return `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
            ${list.map(f => `<a href="${escapeText(base + encodeURIComponent(f))}" class="btn btn-primary btn-sm" style="font-size:0.75rem;padding:4px 8px;" download>
                <span class="material-icons" style="font-size:14px;">download</span> ${escapeText(f)}
            </a>`).join('')}
        </div>`;
    }

    function renderRdgenHistory(runs) {
        const list = document.getElementById('rdgen-history-list');
        if (!list) return;
        if (!runs || !runs.length) {
            list.innerHTML = '<p class="text-muted" style="text-align:center;margin:20px 0;">No builds yet. Click Generate to start a build.</p>';
            return;
        }
        list.innerHTML = runs.map(run => {
            const isTerminal = TERMINAL_STATUSES.has(run.status);
            const isFailed = ['failure', 'cancelled', 'timed_out'].includes(run.status);
            const isSuccess = run.status === 'success';
            const color = statusColor(run.status);
            const icon = statusIcon(run.status);
            const spinnerHtml = !isTerminal ? `<span class="material-icons rdgen-spin" style="color:${color};font-size:20px;animation:rdgen-rotate 1s linear infinite;">sync</span>` : '';
            const logLink = run.log_url ? `<a href="${escapeText(run.log_url)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:4px 8px;">
                <span class="material-icons" style="font-size:14px;">open_in_new</span> GitHub Logs
            </a>` : '';
            const portalLink = `<a href="/rdgen/${escapeText(run.uuid)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:0.75rem;padding:4px 8px;">
                <span class="material-icons" style="font-size:14px;">launch</span> Build Portal
            </a>`;
            const downloads = isSuccess ? buildDownloadLinks(run) : '';
            const progressBar = !isTerminal ? `<div style="width:100%;height:4px;background:#2a2a3a;border-radius:2px;margin-top:8px;overflow:hidden;">
                <div style="height:4px;background:#3b82f6;border-radius:2px;width:60%;animation:rdgen-progress 2s ease-in-out infinite alternate;"></div>
            </div>` : '';
            return `<div class="rdgen-history-item" data-uuid="${escapeText(run.uuid)}" style="padding:14px;border-radius:8px;border:1px solid rgba(255,255,255,0.07);margin-bottom:10px;background:var(--color-bg,#111120);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                        ${!isTerminal ? spinnerHtml : `<span class="material-icons" style="color:${color};font-size:20px;">${icon}</span>`}
                        <div style="min-width:0;">
                            <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeText(run.filename || 'Build')} <span style="color:var(--color-text-muted,#888);font-weight:400;font-size:0.8rem;">${escapeText(platformLabel(run.platform))}</span></div>
                            <div style="font-size:0.75rem;color:${color};margin-top:2px;">${escapeText(run.status || 'queued')}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        ${logLink}
                        ${portalLink}
                    </div>
                </div>
                ${progressBar}
                ${downloads}
                <div style="font-size:0.7rem;color:var(--color-text-muted,#888);margin-top:6px;">${escapeText(run.uuid)} · ${escapeText(run.created_at || '')}</div>
            </div>`;
        }).join('');
    }

    async function loadRdgenHistory(silent = false) {
        if (!document.getElementById('rdgen-history-list')) return;
        try {
            const res = await fetch('/api/generator/rdgen/runs');
            const data = await res.json();
            if (!data.success) { if (!silent) notify.error(data.error || 'Failed to load history'); return; }
            renderRdgenHistory(data.runs || []);
            // If any active builds, keep polling
            const hasActive = (data.runs || []).some(r => !TERMINAL_STATUSES.has(r.status));
            if (hasActive && !rdgenHistoryPollTimer) {
                rdgenHistoryPollTimer = setInterval(() => loadRdgenHistory(true), 15000);
            } else if (!hasActive && rdgenHistoryPollTimer) {
                clearInterval(rdgenHistoryPollTimer);
                rdgenHistoryPollTimer = null;
            }
        } catch (e) {
            if (!silent) notify.error(e.message);
        }
    }

    // ── Sidebar: rdgen presets as list items ───────────────────────────────────

    function renderRdgenSidebarItems(presets) {
        const root = els['gen-bundle-list'];
        if (!root) return;
        // Remove existing rdgen sidebar items
        root.querySelectorAll('.bundle-item[data-rdgen-preset]').forEach(el => el.remove());

        (presets || []).forEach(p => {
            const item = document.createElement('div');
            item.className = 'bundle-item';
            item.dataset.rdgenPreset = p.id;
            const isActive = state.productType === 'rdgen' && state.rdgenActivePresetId === String(p.id);
            if (isActive) item.classList.add('active');
            item.innerHTML = `
                <div class="bundle-item-title">
                    ${escapeText(p.name)}
                    <span class="badge-product">RustDesk Generator</span>
                </div>
                <div class="bundle-item-meta">
                    <span>${escapeText(p.created_at ? p.created_at.substring(0, 10) : '')}</span>
                </div>
            `;
            item.addEventListener('click', () => {
                // Switch to rdgen form and apply preset
                document.querySelectorAll('.bundle-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                state.rdgenActivePresetId = String(p.id);
                showRdgenForm();
                try { applyRdgenConfig(JSON.parse(p.config_json)); } catch (_) {}
                notify.info(`Loaded: ${p.name}`);
            });
            root.appendChild(item);
        });
    }

    async function loadRdgenSidebarPresets() {
        try {
            const res = await fetch('/api/generator/rdgen/presets');
            const data = await res.json();
            if (data.success) renderRdgenSidebarItems(data.presets || []);
        } catch (_) {}
    }

    async function init() {
        cacheEls();
        if (!els['gen-bundle-list']) return;
        bindEvents();
        bindRdgenEvents();
        bindAutoProvisionEvents();
        await loadConnectionDefaults();
        await loadPlatformLabels();
        loadToolchainStatus().catch(() => {});
        await loadBundles();
        await loadRdgenSidebarPresets();

        // Refresh sidebar presets whenever rdgen form opens or preset is saved
        const origLoadRdgenPresets = loadRdgenPresets;
        // Refresh history button
        const btnRefresh = document.getElementById('btn-refresh-rdgen-history');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => loadRdgenHistory(false));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
