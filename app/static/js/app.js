const API_BASE = '/api';

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
}

function getBootTime(uptimeSeconds) {
    if (!uptimeSeconds || uptimeSeconds <= 0) return 'N/A';
    const bootTime = Date.now() - (uptimeSeconds * 1000);
    const d = new Date(bootTime);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
}

let vmData = [];
let servers = [];
let selectedVMs = new Set();
let favorites = [];
let currentDelay = 30;
let naturalSort = false;
let currentFavoriteIndex = -1;
let isProcessing = false;
let serverDetailCache = null;
let serverDetailCacheTime = 0;
const SERVER_DETAIL_CACHE_DURATION = 30000;

function naturalSortCompare(a, b) {
    const numPattern = /(\d+)/g;
    const partsA = a.split(numPattern);
    const partsB = b.split(numPattern);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const partA = partsA[i] || '';
        const partB = partsB[i] || '';

        const numA = parseInt(partA, 10);
        const numB = parseInt(partB, 10);

        if (!isNaN(numA) && !isNaN(numB)) {
            if (numA !== numB) return numA - numB;
        } else if (partA !== partB) {
            return partA.localeCompare(partB);
        }
    }
    return 0;
}

function setBatchButtonsDisabled(disabled) {
    const btns = document.querySelectorAll('.batch-section .btn');
    btns.forEach(btn => {
        if (disabled) {
            btn.dataset.originalText = btn.textContent;
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    });
}

async function loadSettings() {
    try {
        const result = await apiRequest('/config');
        if (result.success && result.config) {
            const config = result.config;
            window.appConfig = config;
            currentDelay = config.default_delay || 30;
            naturalSort = config.natural_sort || false;
            updateDelayDisplay();
            updateNaturalSortDisplay();
            startAutoRefresh(config.auto_refresh || 0);
        }
    } catch (e) {
        console.warn('加载设置失败:', e);
    }
}

let autoRefreshTimer = null;
let autoRefreshInterval = 0;

function startAutoRefresh(intervalSeconds) {
    stopAutoRefresh();
    autoRefreshInterval = intervalSeconds;
    if (intervalSeconds > 0) {
        autoRefreshTimer = setInterval(() => {
            refreshStatus();
        }, intervalSeconds * 1000);
    }
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

function updateDelayDisplay() {
    const delaySlider = document.getElementById('delay-slider');
    const delayValue = document.getElementById('delay-value');
    const currentDelayDisplay = document.getElementById('current-delay-value');
    if (delaySlider) delaySlider.value = currentDelay;
    if (delayValue) delayValue.textContent = currentDelay;
    if (currentDelayDisplay) currentDelayDisplay.textContent = currentDelay;
    const estimatedTimeEl = document.getElementById('estimated-time-value');
    if (estimatedTimeEl) {
        const selectedList = getSelectedVMList();
        estimatedTimeEl.textContent = selectedList.length > 0 ? (selectedList.length - 1) * currentDelay : 0;
    }
}

function updateNaturalSortDisplay() {
    const checkbox = document.getElementById('setting-natural-sort');
    if (checkbox) checkbox.checked = naturalSort;
}

function switchSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.settings-tab-panel').forEach(panel => panel.classList.remove('active'));
    document.querySelector(`.settings-tab[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`settings-tab-${tabName}`).classList.add('active');
}

async function loadSettingsForPage() {
    const result = await apiRequest('/config');
    if (result.success && result.config) {
        const config = result.config;
        window.appConfig = config;
        document.getElementById('setting-auto-refresh').value = config.auto_refresh || 0;
        document.getElementById('setting-default-delay').value = config.default_delay || 0;
        document.getElementById('setting-show-stopped').checked = config.show_stopped !== false;
        document.getElementById('setting-confirm-batch').checked = config.confirm_batch !== false;
        document.getElementById('setting-natural-sort').checked = config.natural_sort || false;
        document.getElementById('setting-auth-username').value = config.basic_auth_username || '';
        document.getElementById('setting-auth-password').value = '';
        document.getElementById('setting-auth-enabled').checked = !!(config.basic_auth_username || config.basic_auth_password);
        document.getElementById('setting-ip-whitelist').checked = config.ip_whitelist_enabled || false;
        document.getElementById('setting-allowed-ips').value = (config.allowed_ips || []).join('\n');
        document.getElementById('setting-api-timeout').value = config.api_timeout || 30;
        document.getElementById('setting-scheduler-enabled').checked = config.scheduler_enabled !== false;
        document.getElementById('setting-task-timeout').value = config.task_timeout || 10;
        document.getElementById('setting-log-enabled').checked = config.log_enabled !== false;
        document.getElementById('setting-filter-hosts').value = (config.filter_hosts || []).join('\n');
    }
    hideSettingsMessage();
}

async function openSettingsModal() {
    document.querySelector('[data-tab="settings"]').click();
}

function showSettingsMessage(message, isError = false) {
    const msgEl = document.getElementById('settings-message');
    msgEl.textContent = message;
    msgEl.className = 'settings-message ' + (isError ? 'error' : 'success');
    msgEl.style.display = 'block';
}

function hideSettingsMessage() {
    document.getElementById('settings-message').style.display = 'none';
}

function validateSettings() {
    const timeout = parseInt(document.getElementById('setting-api-timeout').value);
    if (isNaN(timeout) || timeout < 5 || timeout > 120) {
        showSettingsMessage('API请求超时必须在5-120秒之间', true);
        return false;
    }
    const taskTimeout = parseInt(document.getElementById('setting-task-timeout').value);
    if (isNaN(taskTimeout) || taskTimeout < 1 || taskTimeout > 60) {
        showSettingsMessage('任务执行超时必须在1-60分钟之间', true);
        return false;
    }
    const delay = parseInt(document.getElementById('setting-default-delay').value);
    if (isNaN(delay) || delay < 0 || delay > 300) {
        showSettingsMessage('批量操作间隔必须在0-300秒之间', true);
        return false;
    }
    const autoRefresh = parseInt(document.getElementById('setting-auto-refresh').value);
    if (isNaN(autoRefresh) || autoRefresh < 0 || autoRefresh > 300) {
        showSettingsMessage('自动刷新间隔必须在0-300秒之间', true);
        return false;
    }
    return true;
}

async function saveAllSettings() {
    console.log('saveAllSettings called');
    if (!validateSettings()) {
        console.log('Validation failed');
        return;
    }
    console.log('Validation passed');

    const settings = {
        auto_refresh: parseInt(document.getElementById('setting-auto-refresh').value) || 0,
        default_delay: parseInt(document.getElementById('setting-default-delay').value) || 0,
        show_stopped: document.getElementById('setting-show-stopped').checked,
        confirm_batch: document.getElementById('setting-confirm-batch').checked,
        natural_sort: document.getElementById('setting-natural-sort').checked,
        basic_auth_username: document.getElementById('setting-auth-username').value.trim(),
        basic_auth_enabled: document.getElementById('setting-auth-enabled').checked,
        ip_whitelist_enabled: document.getElementById('setting-ip-whitelist').checked,
        allowed_ips: document.getElementById('setting-allowed-ips').value.split('\n').map(ip => ip.trim()).filter(ip => ip),
        api_timeout: parseInt(document.getElementById('setting-api-timeout').value) || 30,
        scheduler_enabled: document.getElementById('setting-scheduler-enabled').checked,
        task_timeout: parseInt(document.getElementById('setting-task-timeout').value) || 10,
        log_enabled: document.getElementById('setting-log-enabled').checked,
        filter_hosts: document.getElementById('setting-filter-hosts').value.split('\n').map(h => h.trim()).filter(h => h)
    };

    const password = document.getElementById('setting-auth-password').value;
    if (password) {
        settings.basic_auth_password = password;
    }

    const result = await apiRequest('/config', {
        method: 'POST',
        body: JSON.stringify(settings)
    });
    console.log('Save result:', result);

    if (result.success) {
        showSettingsMessage('设置已保存成功！');
        naturalSort = settings.natural_sort;
        currentDelay = settings.default_delay;
        window.appConfig = settings;
        startAutoRefresh(settings.auto_refresh);
        loadServers();
        loadVMs();
    } else {
        showSettingsMessage('保存失败: ' + (result.error || '未知错误'), true);
    }
}

function resetSettingsToDefaults() {
    if (!confirm('确定要恢复所有设置为默认值吗？')) return;
    document.getElementById('setting-auto-refresh').value = 0;
    document.getElementById('setting-default-delay').value = 0;
    document.getElementById('setting-show-stopped').checked = true;
    document.getElementById('setting-confirm-batch').checked = true;
    document.getElementById('setting-natural-sort').checked = false;
    document.getElementById('setting-auth-username').value = '';
    document.getElementById('setting-auth-password').value = '';
    document.getElementById('setting-auth-enabled').checked = false;
    document.getElementById('setting-ip-whitelist').checked = false;
    document.getElementById('setting-allowed-ips').value = '';
    document.getElementById('setting-api-timeout').value = 30;
    document.getElementById('setting-scheduler-enabled').checked = true;
    document.getElementById('setting-task-timeout').value = 10;
    document.getElementById('setting-log-enabled').checked = true;
    document.getElementById('setting-filter-hosts').value = '';
    showSettingsMessage('已恢复默认值，请点击"保存设置"以应用');
}

async function apiRequest(endpoint, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(API_BASE + endpoint, {
            headers: {
                'Content-Type': 'application/json',
            },
            signal: controller.signal,
            ...options
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const text = await response.text().catch(() => 'Request failed');
            if (text.startsWith('<') && text.includes('Unexpected token')) {
                return { success: false, error: '服务器错误，请检查网络连接' };
            }
            if (response.status === 429) {
                try {
                    const errJson = JSON.parse(text);
                    return { success: false, error: errJson.error || '请求过于频繁，请稍后再试' };
                } catch {
                    return { success: false, error: '请求过于频繁，请稍后再试' };
                }
            }
            return { success: false, error: `HTTP ${response.status}: ${text}` };
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        const text = await response.text();
        if (text.startsWith('<') && text.includes('Unexpected token')) {
            return { success: false, error: '服务器错误，请检查网络连接' };
        }
        return { success: false, error: text };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, error: '请求超时，请检查网络连接' };
        }
        return { success: false, error: error.message };
    }
}

let loadingCount = 0;
let loadingTimer = null;
let loadingStartTime = 0;
const LOADING_MIN_DELAY = 300;

function showLoading(text = '加载中...') {
    if (loadingCount === 0) {
        loadingStartTime = Date.now();
    }
    loadingCount++;
    if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
    }
    loadingTimer = setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        const textEl = overlay?.querySelector('.loading-text');
        if (textEl) textEl.textContent = text;
        if (overlay) overlay.classList.add('active');
    }, LOADING_MIN_DELAY);
}

function hideLoading() {
    if (loadingCount > 0) {
        loadingCount--;
    }
    if (loadingCount === 0) {
        if (loadingTimer) {
            clearTimeout(loadingTimer);
            loadingTimer = null;
        }
        const elapsed = Date.now() - loadingStartTime;
        if (elapsed < 1000) {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.classList.remove('active');
        } else {
            setTimeout(() => {
                const overlay = document.getElementById('loading-overlay');
                if (overlay) overlay.classList.remove('active');
            }, 200);
        }
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

async function checkConnection() {
    try {
        const result = await apiRequest('/status');
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');

        if (result.connected) {
            indicator.className = 'status-dot connected';
            const serverCount = result.servers ? result.servers.length : 0;
            text.textContent = `已连接 ${serverCount} 台服务器`;
        } else {
            indicator.className = 'status-dot disconnected';
            text.textContent = '未连接';
        }
        return result.connected;
    } catch (e) {
        console.error('检查连接失败:', e);
        return false;
    }
}

async function refreshStatus() {
    showLoading('正在刷新...');
    try {
        const [connectionResult] = await Promise.all([
            checkConnection(),
            loadServers(),
            loadVMs(),
            loadFavorites()
        ]);
        updateVMCards();
        filterVMs();
    } finally {
        setTimeout(hideLoading, 100);
    }
}

async function loadServers() {
    try {
        const result = await apiRequest('/servers');
        if (result.success) {
            const sortFunc = naturalSort
                ? (a, b) => naturalSortCompare(a.host, b.host)
                : (a, b) => a.host.localeCompare(b.host);
            servers = (result.servers || []).sort(sortFunc);
        }
    } catch (e) {
        console.error('加载服务器失败:', e);
    }
}

async function loadServerDetail(forceRefresh = false) {
    if (!forceRefresh && serverDetailCache && (Date.now() - serverDetailCacheTime) < SERVER_DETAIL_CACHE_DURATION) {
        renderServerDetail(serverDetailCache);
        return;
    }

    showLoading('加载服务器详情...');
    try {
        const result = await apiRequest('/servers/detail');
        const serverListDiv = document.getElementById('server-list');
        if (!serverListDiv) return;

        if (!result.success || !result.servers || result.servers.length === 0) {
            serverListDiv.innerHTML = '<p class="text-muted">暂无服务器信息</p>';
            return;
        }

        serverDetailCache = result;
        serverDetailCacheTime = Date.now();
        renderServerDetail(result);
    } catch (e) {
        console.error('加载服务器详情失败:', e);
        const serverListDiv = document.getElementById('server-list');
        if (serverListDiv) {
            serverListDiv.innerHTML = '<p class="text-muted">加载失败</p>';
        }
    } finally {
        setTimeout(hideLoading, 100);
    }
}

function renderServerDetail(result) {
    const serverListDiv = document.getElementById('server-list');
    if (!serverListDiv) return;

    if (!result.success || !result.servers || result.servers.length === 0) {
        serverListDiv.innerHTML = '<p class="text-muted">暂无服务器信息</p>';
        return;
    }

    try {
        const servers = result.servers;

        if (servers.length === 0) {
            serverListDiv.innerHTML = '<p class="text-muted">暂无服务器信息</p>';
            return;
        }

        const serverCards = servers.map(server => {
            if (!server.connected) {
                return `
                    <div class="server-card error">
                        <div class="server-header">
                            <span class="server-name">${escapeHtml(server.name) || server.host}</span>
                            <span class="server-status disconnected">离线</span>
                        </div>
                        <div class="server-info">
                            <p class="error-text">${escapeHtml(server.error) || '连接失败'}</p>
                        </div>
                    </div>
                `;
            }

            const cpuBar = createProgressBar(server.cpu.usage_percent, 'CPU');
            const memBar = createProgressBar(server.memory.usage_percent, '内存');

            const diskRows = server.disks.map(disk => `
                <tr>
                    <td>${disk.name}</td>
                    <td>${formatSize(disk.capacity)}</td>
                    <td>${formatSize(disk.free)}</td>
                    <td>${disk.usage_percent.toFixed(1)}%</td>
                </tr>
            `).join('');

            const remark = escapeHtml(server.remark || '');
            const remarkDisplay = `<div class="server-remark-row" id="remark-row-${server.host}">
                <strong>备注:</strong>
                <span class="server-remark-text" id="remark-text-${server.host}" onclick="startEditRemark('${server.host}')">${remark || '暂无备注'}</span>
                <input type="text" class="server-remark-input" id="remark-input-${server.host}" value="${remark || ''}" style="display:none;" onblur="saveRemarkBlur('${server.host}')" onkeydown="handleRemarkKeydown(event, '${server.host}')">
                <button class="btn btn-xs btn-secondary" id="remark-btn-${server.host}" onclick="startEditRemark('${server.host}')">✏️</button>
            </div>`;

            const uptimeInfo = server.uptime_seconds ? `<p><strong>运行时长:</strong> ${formatUptime(server.uptime_seconds)}</p>` : '';

            return `
                <div class="server-card">
                    <div class="server-header">
                        <span class="server-name">${escapeHtml(server.name) || server.host}</span>
                        <span class="server-status connected">在线</span>
                    </div>
                    <div class="server-info">
                        <p><strong>型号:</strong> ${escapeHtml(server.model) || 'N/A'}</p>
                        <p><strong>厂商:</strong> ${escapeHtml(server.server_vendor) || 'N/A'}</p>
                        <p><strong>地址:</strong> ${server.host}</p>
                        <p><strong>版本:</strong> ${server.version} (Build ${server.build})</p>
                        <p><strong>虚拟机:</strong> ${server.vm_count} 台</p>
                        ${uptimeInfo}
                        ${remarkDisplay}
                    </div>
                    <div class="server-stats">
                        <div class="stat-item">
                            <span class="progress-label">CPU (${server.cpu.usage_ghz || 0} / ${server.cpu.total_ghz || 0} GHz, ${server.cpu.usage_percent}%)</span>
                            ${cpuBar}
                        </div>
                        <div class="stat-item">
                            <span class="progress-label">内存 ${formatSize(server.memory.usage)} / ${formatSize(server.memory.total)} (${server.memory.usage_percent}%)</span>
                            ${memBar}
                        </div>
                    </div>
                    <div class="server-disks">
                        <p class="disk-title"><strong>存储</strong></p>
                        <table class="disk-table">
                            <tr><th>名称</th><th>总容量</th><th>剩余</th><th>使用率</th></tr>
                            ${diskRows}
                        </table>
                    </div>
                </div>
            `;
        }).join('');

        serverListDiv.innerHTML = `<div class="server-grid">${serverCards}</div>`;
    } catch (e) {
        console.error('渲染服务器详情失败:', e);
        serverListDiv.innerHTML = '<p class="text-muted">渲染失败</p>';
    }
}

function formatSize(gb) {
    if (gb >= 1024) {
        return (gb / 1024).toFixed(2) + ' TB';
    }
    return gb.toFixed(1) + ' GB';
}

function startEditRemark(host) {
    const textEl = document.getElementById(`remark-text-${host}`);
    const inputEl = document.getElementById(`remark-input-${host}`);
    const btnEl = document.getElementById(`remark-btn-${host}`);

    if (!textEl || !inputEl) return;

    textEl.style.display = 'none';
    btnEl.style.display = 'none';
    inputEl.style.display = 'inline-block';
    inputEl.focus();
    inputEl.select();
}

function handleRemarkKeydown(event, host) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveRemarkBlur(host);
    } else if (event.key === 'Escape') {
        cancelEditRemark(host);
    }
}

function cancelEditRemark(host) {
    const textEl = document.getElementById(`remark-text-${host}`);
    const inputEl = document.getElementById(`remark-input-${host}`);
    const btnEl = document.getElementById(`remark-btn-${host}`);
    const originalText = textEl ? textEl.textContent : '';

    if (!textEl || !inputEl) return;

    if (inputEl.value !== originalText && originalText !== '暂无备注') {
        inputEl.value = originalText;
    } else if (originalText === '暂无备注') {
        inputEl.value = '';
    }

    textEl.style.display = '';
    btnEl.style.display = '';
    inputEl.style.display = 'none';
}

async function saveRemarkBlur(host) {
    const textEl = document.getElementById(`remark-text-${host}`);
    const inputEl = document.getElementById(`remark-input-${host}`);
    const btnEl = document.getElementById(`remark-btn-${host}`);
    const newRemark = inputEl.value.trim();

    textEl.style.display = '';
    btnEl.style.display = '';
    inputEl.style.display = 'none';

    if (newRemark === textEl.textContent) return;

    const result = await apiRequest(`/servers/${host}/remark`, {
        method: 'POST',
        body: JSON.stringify({ remark: newRemark })
    });

    if (result.success) {
        textEl.textContent = newRemark || '暂无备注';
        showToast('备注已保存', 'success');
    } else {
        textEl.textContent = textEl.textContent || '暂无备注';
        showToast('保存失败', 'error');
    }
}

function createProgressBar(percent, label) {
    const color = percent > 80 ? 'danger' : percent > 60 ? 'warning' : 'success';
    return `
        <div class="progress-bar">
            <div class="progress-fill ${color}" style="width: ${percent}%"></div>
        </div>
    `;
}

async function loadVMs(retryCount = 0, maxRetries = 3) {
    const vmListDiv = document.getElementById('vm-list');
    const vmOverviewDiv = document.getElementById('vm-overview');

    if (vmListDiv) vmListDiv.innerHTML = '<p class="text-muted">正在加载虚拟机...</p>';
    if (vmOverviewDiv) vmOverviewDiv.innerHTML = '<p class="text-muted">正在加载...</p>';

    try {
        const result = await apiRequest('/vms');

        if (result.success && result.vms) {
            const sortFunc = naturalSort
                ? (a, b) => naturalSortCompare(a.name, b.name)
                : (a, b) => a.name.localeCompare(b.name);
            vmData = result.vms.sort(sortFunc);

            const filterHosts = (window.appConfig && window.appConfig.filter_hosts) || [];
            if (filterHosts.length > 0) {
                vmData = vmData.filter(vm => {
                    const vmHost = (vm.server_host || '').toLowerCase();
                    const vmServer = (vm.server || '').toLowerCase();
                    const vmName = (vm.name || '').toLowerCase();
                    return !filterHosts.some(filter =>
                        vmHost.includes(filter.toLowerCase()) ||
                        vmServer.includes(filter.toLowerCase()) ||
                        vmName.includes(filter.toLowerCase())
                    );
                });
            }

            if (vmData.length === 0) {
                if (vmListDiv) vmListDiv.innerHTML = '<p class="text-muted">未找到虚拟机</p>';
                if (vmOverviewDiv) vmOverviewDiv.innerHTML = '<p class="text-muted">未找到虚拟机</p>';
                return;
            }

            const vmCards = vmData.map(vm => createVMCard(vm)).join('');
            if (vmOverviewDiv) vmOverviewDiv.innerHTML = `<div class="vm-grid">${vmCards}</div>`;

            const serversGrouped = {};
            vmData.forEach(vm => {
                const serverKey = vm.server_host;
                if (!serversGrouped[serverKey]) {
                    serversGrouped[serverKey] = {
                        server: vm.server || vm.server_host,
                        vms: []
                    };
                }
                serversGrouped[serverKey].vms.push(vm);
            });

            let groupedHtml = '';
            Object.entries(serversGrouped).forEach(([serverHost, group]) => {
                const serverVmCards = group.vms.map(vm => createVMCard(vm)).join('');
                groupedHtml += `
                    <div class="server-group">
                        <h3 class="server-group-title">🖧 ${group.server}</h3>
                        <div class="vm-grid">${serverVmCards}</div>
                    </div>
                `;
            });
            if (vmListDiv) vmListDiv.innerHTML = groupedHtml;
        } else {
            const msg = result.error || (result.errors ? result.errors.join('; ') : '加载虚拟机失败');
            if (vmListDiv) vmListDiv.innerHTML = `<p class="text-muted">${msg}</p>`;
            if (vmOverviewDiv) vmOverviewDiv.innerHTML = '<p class="text-muted">加载失败</p>';
        }
    } catch (e) {
        console.error('加载虚拟机失败:', e);
        if (retryCount < maxRetries) {
            write_log(`loadVMs retry ${retryCount + 1}/${maxRetries}: ${e.message}`);
            await new Promise(r => setTimeout(r, 1000));
            return loadVMs(retryCount + 1, maxRetries);
        }
        if (vmListDiv) vmListDiv.innerHTML = '<p class="text-muted">加载失败，请刷新重试</p>';
        if (vmOverviewDiv) vmOverviewDiv.innerHTML = '<p class="text-muted">加载失败</p>';
    }
}

function createVMCard(vm) {
    const stateClass = vm.state ? vm.state.toLowerCase().replace(' ', '-') : 'unknown';
    const isPoweredOff = vm.state === 'poweredOff';
    const isRunning = vm.state === 'poweredOn';
    const canSuspend = vm.state === 'poweredOn';
    const canStart = vm.state === 'poweredOff' || vm.state === 'suspended';
    const key = vm.name + '|' + vm.server_host;
    const isSelected = selectedVMs.has(key);
    const stateText = {
        'poweredOn': '运行中',
        'poweredOff': '已停止',
        'suspended': '已挂起'
    }[vm.state] || '未知';
    const safeName = escapeHtml(vm.name);
    const safeServer = escapeHtml(vm.server || vm.server_host);
    const safeServerHost = escapeHtml(vm.server_host);
    const showUptime = (isRunning || vm.state === 'suspended') && vm.uptime_seconds;
    const uptimeDisplay = showUptime ? `<p>运行时长: ${formatUptime(vm.uptime_seconds)}</p>` : '';
    const bootTimeDisplay = showUptime ? `<p>启动时间: ${getBootTime(vm.uptime_seconds)}</p>` : '';

    return `
        <div class="vm-card ${isSelected ? 'selected' : ''} ${isPoweredOff ? 'vm-powered-off' : ''}" data-vm-name="${safeName}" data-server-host="${safeServerHost}" data-vm-state="${vm.state || ''}">
            <div class="vm-card-header" onclick="handleVMCardClick(event, '${safeName}', '${safeServerHost}')">
                <input type="checkbox" class="vm-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleVMSelection('${safeName}', '${safeServerHost}')">
                <span class="vm-name" title="${safeServer}">${safeName}</span>
                <span class="vm-state ${stateClass}">${stateText}</span>
            </div>
            <div class="vm-card-body">
                <p>服务器: ${safeServer}</p>
                <p>状态: ${stateText}</p>
                <p>CPU: ${vm.cpu || 0} 核 | 内存: ${vm.memory || 0} GB</p>
                ${bootTimeDisplay}
                ${uptimeDisplay}
            </div>
            <div class="vm-card-footer btn-group" data-vm-name="${safeName}" data-server-host="${safeServerHost}">
                <button class="btn btn-info btn-sm" onclick="openVmDetail('${safeName}', '${safeServerHost}', event)">详情</button>
                ${canSuspend ? `<button class="btn btn-warning btn-sm" onclick="suspendVM('${safeName}', '${safeServerHost}', event)">挂起</button>` : ''}
                ${canStart ? `<button class="btn btn-success btn-sm" onclick="startVM('${safeName}', '${safeServerHost}', event)">启动</button>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="refreshStatus()">刷新</button>
            </div>
        </div>
    `;
}

function handleVMCardClick(event, vmName, serverHost) {
    if (event.target.type === 'checkbox') return;
    event.stopPropagation();
    toggleVMSelection(vmName, serverHost);
}

function toggleVMSelection(vmName, serverHost) {
    const key = vmName + '|' + serverHost;
    if (selectedVMs.has(key)) {
        selectedVMs.delete(key);
    } else {
        selectedVMs.add(key);
    }
    updateVMCards();
}

function selectAllVMs() {
    selectedVMs.clear();
    vmData.forEach(vm => selectedVMs.add(vm.name + '|' + vm.server_host));
    updateVMCards();
    showToast(`已选中 ${vmData.length} 台虚拟机`, 'info');
}

function deselectAllVMs() {
    selectedVMs.clear();
    updateVMCards();
    showToast('已取消所有选择', 'info');
}

function updateVMCards() {
    document.querySelectorAll('.vm-card').forEach(card => {
        const vmName = card.getAttribute('data-vm-name');
        const serverHost = card.getAttribute('data-server-host');
        const key = vmName + '|' + serverHost;
        const checkbox = card.querySelector('.vm-checkbox');
        if (selectedVMs.has(key)) {
            card.classList.add('selected');
            if (checkbox) checkbox.checked = true;
        } else {
            card.classList.remove('selected');
            if (checkbox) checkbox.checked = false;
        }
    });
    updateSelectedVMPreview();
}

async function updateSingleVMCard(vmName, serverHost) {
    const result = await apiRequest(`/vm/${encodeURIComponent(vmName)}/detail?server_host=${encodeURIComponent(serverHost)}`);
    if (result.success && result.vm) {
        const vm = result.vm;
        const card = document.querySelector(`.vm-card[data-vm-name="${CSS.escape(vmName)}"][data-server-host="${CSS.escape(serverHost)}"]`);
        if (card) {
            const stateClass = vm.state === 'poweredOn' ? 'state-on' : (vm.state === 'poweredOff' ? 'state-off' : 'state-other');
            const stateText = {
                'poweredOn': '运行中',
                'poweredOff': '已停止',
                'suspended': '已挂起'
            }[vm.state] || '未知';
            const canSuspend = vm.state === 'poweredOn';
            const canStart = vm.state === 'poweredOff' || vm.state === 'suspended';
            card.setAttribute('data-vm-state', vm.state || '');
            card.querySelector('.vm-state').className = `vm-state ${stateClass}`;
            card.querySelector('.vm-state').textContent = stateText;
            card.querySelector('.vm-card-body').innerHTML = `
                <p>服务器: ${escapeHtml(vm.server || vm.server_host)}</p>
                <p>状态: ${stateText}</p>
                <p>CPU: ${vm.cpu || 0} 核 | 内存: ${vm.memory || 0} GB</p>
            `;
            const footer = card.querySelector('.vm-card-footer');
            footer.innerHTML = `
                <button class="btn btn-info btn-sm" onclick="openVmDetail('${escapeHtml(vmName)}', '${escapeHtml(serverHost)}', event)">详情</button>
                ${canSuspend ? `<button class="btn btn-warning btn-sm" onclick="suspendVM('${escapeHtml(vmName)}', '${escapeHtml(serverHost)}', event)">挂起</button>` : ''}
                ${canStart ? `<button class="btn btn-success btn-sm" onclick="startVM('${escapeHtml(vmName)}', '${escapeHtml(serverHost)}', event)">启动</button>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="refreshStatus()">刷新</button>
            `;
        }
    }
}

function filterVMs() {
    const searchInput = document.getElementById('vm-search');
    const searchTerm = searchInput.value.toLowerCase();
    const stateSelect = document.getElementById('vm-state-select');
    const selectedState = stateSelect ? stateSelect.value : 'all';
    const vmCards = document.querySelectorAll('.vm-card');

    vmCards.forEach(card => {
        const vmName = card.getAttribute('data-vm-name').toLowerCase();
        const serverHost = card.getAttribute('data-server-host').toLowerCase();
        const vmState = card.getAttribute('data-vm-state') || '';

        const matchesSearch = vmName.includes(searchTerm) || serverHost.includes(searchTerm);
        const matchesState = selectedState === 'all' || vmState === selectedState;

        if (matchesSearch && matchesState) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

function resetSearch() {
    const searchInput = document.getElementById('vm-search');
    if (searchInput) searchInput.value = '';
    filterVMs();
}

function updateSelectedVMPreview() {
    const previewSection = document.getElementById('selected-vms-preview');
    const previewList = document.getElementById('selected-vms-list');
    const countBadge = document.getElementById('selected-count-badge');

    if (!previewSection || !previewList) return;

    if (selectedVMs.size === 0) {
        previewSection.style.display = 'none';
        return;
    }

    previewSection.style.display = 'block';
    previewSection.classList.remove('collapsed');
    if (countBadge) countBadge.textContent = selectedVMs.size;

    const selectedList = getSelectedVMList();
    const estimatedTimeEl = document.getElementById('estimated-time-value');
    const currentDelayEl = document.getElementById('current-delay-value');
    if (currentDelayEl) currentDelayEl.textContent = currentDelay;
    if (estimatedTimeEl) {
        estimatedTimeEl.textContent = selectedList.length > 0 ? (selectedList.length - 1) * currentDelay : 0;
    }
    const vmItems = selectedList.map(vm => {
        const safeName = escapeHtml(vm.name);
        const safeServer = escapeHtml(vm.server || vm.server_host);
        const stateClass = vm.state ? vm.state.toLowerCase().replace(' ', '-') : 'unknown';
        const stateIcon = vm.state === 'poweredOn' ? '🟢' : vm.state === 'poweredOff' ? '🔴' : '🟡';
        return `
            <div class="selected-vm-item">
                <span class="state-dot ${stateClass}"></span>
                <span class="selected-vm-name">${safeName}</span>
                <span class="selected-vm-server">${safeServer}</span>
            </div>
        `;
    }).join('');

    previewList.innerHTML = `<div class="selected-vms-grid">${vmItems}</div>`;

    const h2 = previewSection.querySelector('h2');
    if (h2 && !h2.onclick) {
        h2.onclick = () => previewSection.classList.toggle('collapsed');
    }
}

async function suspendSelectedVMs(event) {
    if (isProcessing) return;
    isProcessing = true;
    const startTime = Date.now();
    const vmList = getSelectedVMList();

    if (vmList.length === 0) {
        showToast('请先选择虚拟机', 'error');
        isProcessing = false;
        return;
    }

    const runningVMs = vmList.filter(vm => vm.state === 'poweredOn');
    const nonRunningVMs = vmList.filter(vm => vm.state !== 'poweredOn');

    if (runningVMs.length === 0) {
        showToast('没有可挂起的运行中虚拟机', 'warning');
        isProcessing = false;
        return;
    }

    if (nonRunningVMs.length > 0) {
        showToast(`已跳过 ${nonRunningVMs.length} 台非运行状态虚拟机`, 'info');
    }

    if (runningVMs.length >= 5 && !confirm(`确定要挂起这 ${runningVMs.length} 台虚拟机吗？`)) {
        isProcessing = false;
        return;
    }

    setBatchButtonsDisabled(true);
    setVmsButtonsDisabled(true);
    vmList.forEach(vm => setVMButtonsDisabled(vm.name, vm.server_host, true));
    showBatchProgress(runningVMs.length);
    showVmsProgress(runningVMs.length);
    startExecutionTimer(startTime);

    startProgressCountdown(() => {
        updateBatchProgress(currentProcessedVMs);
        updateVmsProgress(currentProcessedVMs);
    });

    const result = await apiRequest('/batch-vm-action', {
        method: 'POST',
        body: JSON.stringify({
            vms: runningVMs.map(vm => ({ name: vm.name, server_host: vm.server_host, action: 'suspend' })),
            delay: currentDelay
        })
    });

    isProcessing = false;
    stopProgressCountdown();
    hideBatchProgress();
    hideVmsProgress();
    setBatchButtonsDisabled(false);
    setVmsButtonsDisabled(false);
    vmList.forEach(vm => setVMButtonsDisabled(vm.name, vm.server_host, false));
    stopExecutionTimer();

    if (result.success) {
        const msg = `挂起完成: ${result.summary.success} 成功, ${result.summary.failed} 失败`;
        showToast(msg, result.summary.failed > 0 ? 'warning' : 'success');
        await refreshStatus();
    } else {
        showToast(`挂起失败: ${result.error}`, 'error');
    }
}

async function startSelectedVMs(event) {
    if (isProcessing) return;
    isProcessing = true;
    const startTime = Date.now();
    const vmList = getSelectedVMList();

    if (vmList.length === 0) {
        showToast('请先选择虚拟机', 'error');
        isProcessing = false;
        return;
    }

    const startableVMs = vmList.filter(vm => vm.state === 'poweredOff' || vm.state === 'suspended');
    const nonStartableVMs = vmList.filter(vm => vm.state !== 'poweredOff' && vm.state !== 'suspended');

    if (startableVMs.length === 0) {
        showToast('没有可启动的已关机或挂起的虚拟机', 'warning');
        isProcessing = false;
        return;
    }

    if (nonStartableVMs.length > 0) {
        showToast(`已跳过 ${nonStartableVMs.length} 台无法启动的虚拟机`, 'info');
    }

    if (startableVMs.length >= 5 && !confirm(`确定要启动这 ${startableVMs.length} 台虚拟机吗？`)) {
        isProcessing = false;
        return;
    }

    setBatchButtonsDisabled(true);
    setVmsButtonsDisabled(true);
    vmList.forEach(vm => setVMButtonsDisabled(vm.name, vm.server_host, true));
    showBatchProgress(startableVMs.length);
    showVmsProgress(startableVMs.length);
    startExecutionTimer(startTime);

    startProgressCountdown(() => {
        updateBatchProgress(currentProcessedVMs);
        updateVmsProgress(currentProcessedVMs);
    });

    const result = await apiRequest('/batch-vm-action', {
        method: 'POST',
        body: JSON.stringify({
            vms: startableVMs.map(vm => ({ name: vm.name, server_host: vm.server_host, action: 'start' })),
            delay: currentDelay
        })
    });

    isProcessing = false;
    stopProgressCountdown();
    hideBatchProgress();
    hideVmsProgress();
    setBatchButtonsDisabled(false);
    setVmsButtonsDisabled(false);
    vmList.forEach(vm => setVMButtonsDisabled(vm.name, vm.server_host, false));
    stopExecutionTimer();

    if (result.success) {
        const msg = `启动完成: ${result.summary.success} 成功, ${result.summary.failed} 失败`;
        showToast(msg, result.summary.failed > 0 ? 'warning' : 'success');
        await refreshStatus();
    } else {
        showToast(`启动失败: ${result.error}`, 'error');
    }
}

function getSelectedVMList() {
    return vmData.filter(vm => selectedVMs.has(vm.name + '|' + vm.server_host));
}

function setVMButtonsDisabled(vmName, serverHost, disabled) {
    const footer = document.querySelector(`.vm-card-footer[data-vm-name="${vmName}"][data-server-host="${serverHost}"]`);
    if (footer) {
        footer.querySelectorAll('button').forEach(btn => btn.disabled = disabled);
    }
}

let executionTimer = null;
let progressTimer = null;
let currentCountdown = 0;
let currentTotalVMs = 0;
let currentProcessedVMs = 0;

function startExecutionTimer(startTime, target = 'batch') {
    if (target === 'single') {
        return;
    }

    const batchH2 = document.querySelector('.batch-section h2');
    const vmsH2 = document.getElementById('vms-tab-title');

    const createBadge = (h2) => {
        if (!h2) return;
        let badge = h2.querySelector('.execution-time-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'execution-time-badge';
            badge.textContent = '⏱ 0秒';
            h2.appendChild(badge);
        }
    };

    createBadge(batchH2);
    createBadge(vmsH2);

    if (executionTimer) clearInterval(executionTimer);
    executionTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const timeStr = elapsed < 60 ? `${elapsed}秒` : `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;
        document.querySelectorAll('.execution-time-badge').forEach(badge => {
            badge.textContent = `⏱ ${timeStr}`;
        });
    }, 1000);
}

function startSingleVMExecutionTimer(vmName, serverHost, startTime) {
    const vmCard = document.querySelector(`.vm-card[data-vm-name="${vmName}"][data-server-host="${serverHost}"]`);
    if (!vmCard) return;

    const header = vmCard.querySelector('.vm-card-header');
    if (!header) return;

    let badge = header.querySelector('.execution-time-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'execution-time-badge';
        badge.textContent = '⏱ 0秒';
        header.appendChild(badge);
    }

    const timerKey = `singleTimer_${vmName}_${serverHost}`;
    if (window[timerKey]) clearInterval(window[timerKey]);

    window[timerKey] = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const timeStr = elapsed < 60 ? `${elapsed}秒` : `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;
        if (badge) badge.textContent = `⏱ ${timeStr}`;
    }, 1000);
}

function stopExecutionTimer(target = 'batch') {
    if (executionTimer) {
        clearInterval(executionTimer);
        executionTimer = null;
    }

    if (target === 'single') {
        document.querySelectorAll('.vm-card .execution-time-badge').forEach(badge => {
            setTimeout(() => badge.remove(), 2000);
        });
    } else {
        document.querySelectorAll('.execution-time-badge').forEach(badge => {
            setTimeout(() => badge.remove(), 2000);
        });
    }
}

function stopSingleVMExecutionTimer(vmName, serverHost) {
    const timerKey = `singleTimer_${vmName}_${serverHost}`;
    if (window[timerKey]) {
        clearInterval(window[timerKey]);
        window[timerKey] = null;
    }

    const vmCard = document.querySelector(`.vm-card[data-vm-name="${vmName}"][data-server-host="${serverHost}"]`);
    if (vmCard) {
        const badge = vmCard.querySelector('.execution-time-badge');
        if (badge) {
            setTimeout(() => badge.remove(), 2000);
        }
    }
}

function showBatchProgress(totalVMs) {
    currentTotalVMs = totalVMs;
    currentProcessedVMs = 0;
    currentCountdown = currentDelay;

    const progressDiv = document.getElementById('batch-progress');
    const progressFill = document.getElementById('batch-progress-fill');
    const progressText = document.getElementById('batch-progress-text');
    const countdownSpan = document.getElementById('countdown-seconds');

    if (progressDiv) progressDiv.style.display = 'block';
    if (progressFill) progressFill.style.width = '0%';
    if (countdownSpan) countdownSpan.textContent = currentCountdown;
    if (progressText) progressText.textContent = `正在处理... 剩余 ${currentCountdown} 秒`;
}

function updateBatchProgress(processed) {
    currentProcessedVMs = processed;
    const progressFill = document.getElementById('batch-progress-fill');
    const progressText = document.getElementById('batch-progress-text');
    const countdownSpan = document.getElementById('countdown-seconds');

    if (currentTotalVMs > 0) {
        const percent = Math.round((currentProcessedVMs / currentTotalVMs) * 100);
        if (progressFill) progressFill.style.width = `${percent}%`;
    }

    if (countdownSpan) countdownSpan.textContent = currentCountdown;
    if (progressText) progressText.textContent = `正在处理 (${currentProcessedVMs}/${currentTotalVMs})... 剩余 ${currentCountdown} 秒`;
}

function hideBatchProgress() {
    const progressDiv = document.getElementById('batch-progress');
    if (progressDiv) progressDiv.style.display = 'none';
    currentTotalVMs = 0;
    currentProcessedVMs = 0;
    currentCountdown = 0;
}

function showVmsProgress(totalVMs) {
    currentTotalVMs = totalVMs;
    currentProcessedVMs = 0;
    currentCountdown = currentDelay;

    const progressDiv = document.getElementById('vms-progress');
    const progressFill = document.getElementById('vms-progress-fill');
    const progressText = document.getElementById('vms-progress-text');
    const countdownSpan = document.getElementById('vms-countdown-seconds');

    if (progressDiv) progressDiv.style.display = 'block';
    if (progressFill) progressFill.style.width = '0%';
    if (countdownSpan) countdownSpan.textContent = currentCountdown;
    if (progressText) progressText.textContent = `正在处理... 剩余 ${currentCountdown} 秒`;
}

function updateVmsProgress(processed) {
    currentProcessedVMs = processed;
    const progressFill = document.getElementById('vms-progress-fill');
    const progressText = document.getElementById('vms-progress-text');
    const countdownSpan = document.getElementById('vms-countdown-seconds');

    if (currentTotalVMs > 0) {
        const percent = Math.round((currentProcessedVMs / currentTotalVMs) * 100);
        if (progressFill) progressFill.style.width = `${percent}%`;
    }

    if (countdownSpan) countdownSpan.textContent = currentCountdown;
    if (progressText) progressText.textContent = `正在处理 (${currentProcessedVMs}/${currentTotalVMs})... 剩余 ${currentCountdown} 秒`;
}

function hideVmsProgress() {
    const progressDiv = document.getElementById('vms-progress');
    if (progressDiv) progressDiv.style.display = 'none';
}

function setVmsButtonsDisabled(disabled) {
    const suspendBtn = document.getElementById('vms-suspend-btn');
    const startBtn = document.getElementById('vms-start-btn');
    if (suspendBtn) suspendBtn.disabled = disabled;
    if (startBtn) startBtn.disabled = disabled;
}

function startProgressCountdown(onTick) {
    stopProgressCountdown();
    currentCountdown = currentDelay;
    progressTimer = setInterval(() => {
        currentCountdown--;
        if (onTick) onTick();
        if (currentCountdown <= 0) {
            stopProgressCountdown();
        }
    }, 1000);
}

function stopProgressCountdown() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
}

async function suspendVM(vmName, serverHost, event) {
    if (isProcessing) return;
    isProcessing = true;
    const startTime = Date.now();
    setVmsButtonsDisabled(true);
    setVMButtonsDisabled(vmName, serverHost, true);
    startSingleVMExecutionTimer(vmName, serverHost, startTime);

    const result = await apiRequest('/vm/suspend', {
        method: 'POST',
        body: JSON.stringify({ name: vmName, server_host: serverHost })
    });

    isProcessing = false;
    setVmsButtonsDisabled(false);
    setVMButtonsDisabled(vmName, serverHost, false);
    stopSingleVMExecutionTimer(vmName, serverHost);

    if (result.success) {
        showToast(`虚拟机 ${vmName} 挂起成功`, 'success');
        await updateSingleVMCard(vmName, serverHost);
    } else {
        showToast(`挂起失败: ${result.error}`, 'error');
    }
}

async function startVM(vmName, serverHost, event) {
    if (isProcessing) return;
    isProcessing = true;
    const startTime = Date.now();
    setVmsButtonsDisabled(true);
    setVMButtonsDisabled(vmName, serverHost, true);
    startSingleVMExecutionTimer(vmName, serverHost, startTime);

    const result = await apiRequest('/vm/start', {
        method: 'POST',
        body: JSON.stringify({ name: vmName, server_host: serverHost })
    });

    isProcessing = false;
    setVmsButtonsDisabled(false);
    setVMButtonsDisabled(vmName, serverHost, false);
    stopSingleVMExecutionTimer(vmName, serverHost);

    if (result.success) {
        showToast(`虚拟机 ${vmName} 启动成功`, 'success');
        await updateSingleVMCard(vmName, serverHost);
    } else {
        showToast(`启动失败: ${result.error}`, 'error');
    }
}

async function refreshVMs() {
    await refreshStatus();
    showToast('虚拟机列表已刷新', 'info');
}

async function loadFavorites() {
    try {
        const result = await apiRequest('/favorites');
        if (result.success) {
            favorites = result.favorites || [];
            renderFavorites();
        }
    } catch (e) {
        console.error('加载收藏失败:', e);
    }
}

function renderFavorites() {
    const quickDiv = document.getElementById('favorites-quick');

    if (!quickDiv) return;

    if (favorites.length === 0) {
        currentFavoriteIndex = -1;
        quickDiv.innerHTML = '<p class="text-muted">暂无收藏</p>';
        return;
    }

    const favCards = favorites.map((fav, index) => {
        const isActive = index === currentFavoriteIndex;
        const safeName = escapeHtml(fav.name);
        return `
        <div class="favorite-item ${isActive ? 'active' : ''}" data-index="${index}" onclick="toggleFavoriteSelection(${index})">
            <div class="favorite-info">
                <span class="favorite-name">${safeName}</span>
                <span class="favorite-count">${fav.vms.length}台</span>
            </div>
            <div class="favorite-actions">
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteFavorite(${index})">删除</button>
            </div>
        </div>
    `}).join('');

    quickDiv.innerHTML = `<div class="favorites-grid">${favCards}</div>`;
}

function toggleFavoriteSelection(index) {
    if (currentFavoriteIndex === index) {
        currentFavoriteIndex = -1;
        selectedVMs.clear();
        updateVMCards();
        renderFavorites();
        showToast('已取消选择', 'info');
    } else {
        currentFavoriteIndex = index;
        loadFavoriteToSelection(index);
    }
}

function loadFavoriteToSelection(index) {
    if (typeof index === 'undefined') {
        if (selectedVMs.size === 0) {
            showToast('请先点击选择一个收藏', 'error');
            return;
        }
        const dashboardTab = document.querySelector('.nav-btn[data-tab="dashboard"]');
        if (dashboardTab) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            dashboardTab.classList.add('active');
            document.getElementById('dashboard').classList.add('active');
        }
        updateVMCards();
        showToast(`已加载 ${selectedVMs.size} 台虚拟机到选择`, 'info');
        return;
    }

    if (vmData.length === 0) {
        showToast('请先刷新加载虚拟机列表', 'error');
        return;
    }

    const fav = favorites[index];
    if (!fav) {
        showToast('收藏不存在', 'error');
        return;
    }

    selectedVMs.clear();
    currentFavoriteIndex = index;
    let loadedCount = 0;

    fav.vms.forEach(favVm => {
        const match = vmData.find(v => v.name === favVm.name && v.server_host === favVm.server_host);
        if (match) {
            selectedVMs.add(match.name + '|' + match.server_host);
            loadedCount++;
        }
    });

    updateVMCards();
    renderFavorites();

    const dashboardTab = document.querySelector('.nav-btn[data-tab="dashboard"]');
    if (dashboardTab) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        dashboardTab.classList.add('active');
        document.getElementById('dashboard').classList.add('active');
    }

    showToast(`已加载 "${fav.name}" (${loadedCount}台)`, 'info');
}

async function deleteFavorite(index) {
    const fav = favorites[index];
    if (!fav) return;

    favorites.splice(index, 1);
    const result = await apiRequest('/favorites', {
        method: 'POST',
        body: JSON.stringify({ favorites })
    });

    if (result.success) {
        showToast('收藏已删除', 'success');
        await loadFavorites();
    } else {
        showToast('删除失败', 'error');
    }
}

function openSaveFavoriteModal() {
    if (selectedVMs.size === 0) {
        showToast('请先在虚拟机概览中选择虚拟机', 'error');
        return;
    }

    const modal = document.getElementById('save-favorite-modal');
    const nameInput = document.getElementById('favorite-name');
    const countSpan = document.getElementById('selected-count');
    const namesDiv = document.getElementById('selected-vms-names');

    if (!modal) return;

    nameInput.value = '';
    const selectedList = getSelectedVMList();
    countSpan.textContent = selectedList.length;
    namesDiv.textContent = selectedList.map(v => v.name).join(', ');

    modal.style.display = 'flex';
    nameInput.focus();
}

function closeSaveFavoriteModal() {
    const modal = document.getElementById('save-favorite-modal');
    if (modal) modal.style.display = 'none';
}

async function confirmSaveFavorite() {
    const nameInput = document.getElementById('favorite-name');
    const name = nameInput.value.trim();

    if (!name) {
        showToast('请输入收藏名称', 'error');
        return;
    }

    const selectedList = getSelectedVMList();
    if (selectedList.length === 0) {
        showToast('请先选择虚拟机', 'error');
        return;
    }

    const newFavorite = {
        name: name,
        vms: selectedList.map(vm => ({ name: vm.name, server_host: vm.server_host, server: vm.server }))
    };

    favorites.push(newFavorite);

    const result = await apiRequest('/favorites', {
        method: 'POST',
        body: JSON.stringify({ favorites })
    });

    if (result.success) {
        showToast('收藏已保存', 'success');
        closeSaveFavoriteModal();
        await loadFavorites();
    } else {
        showToast('保存失败', 'error');
    }
}

async function loadCredentials() {
    showLoading('加载凭据...');
    try {
        const result = await apiRequest('/servers');
        if (result.success) {
            servers = result.servers || [];
            renderCredentialsList();
        }
    } catch (e) {
        console.error('加载服务器配置失败:', e);
    } finally {
        setTimeout(hideLoading, 100);
    }
}

function renderCredentialsList() {
    const listDiv = document.getElementById('credentials-list');
    if (!listDiv) return;

    if (servers.length === 0) {
        listDiv.innerHTML = '<p class="text-muted">暂无配置</p>';
        return;
    }

    const serverCards = servers.map((server, index) => `
        <div class="credential-card">
            <div class="credential-info">
                <strong>${escapeHtml(server.name) || escapeHtml(server.host)}</strong>
                <span>${escapeHtml(server.host)}</span>
            </div>
            <div class="credential-actions">
                <button class="btn btn-primary btn-sm" onclick="editServer(${index})">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deleteServer(${index})">删除</button>
            </div>
        </div>
    `).join('');

    listDiv.innerHTML = `<div class="credentials-grid">${serverCards}</div>`;
}

function openAddCredentialModal() {
    const modal = document.getElementById('add-credential-modal');
    if (!modal) return;

    document.getElementById('server-name').value = '';
    document.getElementById('server-host').value = '';
    document.getElementById('server-username').value = '';
    document.getElementById('server-password').value = '';
    const testResult = document.getElementById('connection-test-result');
    if (testResult) testResult.style.display = 'none';

    document.getElementById('credential-modal-title').textContent = '🖥️ 添加服务器';
    document.getElementById('add-credential-submit-btn').textContent = '添加';
    document.getElementById('add-credential-submit-btn').onclick = confirmAddCredential;
    document.getElementById('add-credential-cancel-btn').style.display = 'none';
    editingServerIndex = -1;

    modal.style.display = 'flex';
}

function closeAddCredentialModal() {
    const modal = document.getElementById('add-credential-modal');
    if (modal) modal.style.display = 'none';
    editingServerIndex = -1;
}

function openWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.style.display = 'flex';
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.style.display = 'none';
    localStorage.setItem('welcomeShown', 'true');
}

function showHelp() {
    closeWelcomeModal();
    window.open('https://github.com/ericyaoxr/esxi-vm-manager/blob/main/README.md', '_blank');
}

async function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'flex';

    const result = await apiRequest('/config');
    if (result.success && result.config) {
        const config = result.config;
        const usernameInput = document.getElementById('setting-auth-username');
        const passwordInput = document.getElementById('setting-auth-password');
        const ipWhitelistCheckbox = document.getElementById('setting-ip-whitelist');
        const allowedIpsInput = document.getElementById('setting-allowed-ips');

        if (usernameInput) usernameInput.value = config.basic_auth_username || '';
        if (passwordInput) passwordInput.value = '';
        if (ipWhitelistCheckbox) ipWhitelistCheckbox.checked = config.ip_whitelist_enabled || false;
        if (allowedIpsInput) allowedIpsInput.value = (config.allowed_ips || []).join('\n');
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
}

async function testConnection() {
    const name = document.getElementById('server-name').value.trim();
    const host = document.getElementById('server-host').value.trim();
    const username = document.getElementById('server-username').value.trim();
    const password = document.getElementById('server-password').value;

    const resultDiv = document.getElementById('connection-test-result');
    if (!host || !username || !password) {
        resultDiv.className = 'connection-test-result error';
        resultDiv.textContent = '请填写完整信息后再测试';
        resultDiv.style.display = 'block';
        return;
    }

    resultDiv.className = 'connection-test-result testing';
    resultDiv.textContent = '正在测试连接...';
    resultDiv.style.display = 'block';

    const testServer = { name, host, username, password };
    const result = await apiRequest('/servers/check', {
        method: 'POST',
        body: JSON.stringify({ server: testServer })
    });

    if (result.success) {
        resultDiv.className = 'connection-test-result success';
        resultDiv.textContent = '✅ 连接成功！服务器信息正确';
    } else {
        resultDiv.className = 'connection-test-result error';
        const errorMsg = result.error || '连接失败';
        let hint = '';
        if (errorMsg.includes('getaddrinfo') || errorMsg.includes('Name or service not known')) {
            hint = '（请检查 IP 地址是否正确）';
        } else if (errorMsg.includes('authentication') || errorMsg.includes('password')) {
            hint = '（请检查用户名和密码）';
        } else if (errorMsg.includes('connection')) {
            hint = '（请检查网络是否畅通）';
        }
        resultDiv.textContent = '❌ 连接失败: ' + errorMsg + hint;
    }
}

async function confirmAddCredential() {
    const name = document.getElementById('server-name').value.trim();
    const host = document.getElementById('server-host').value.trim();
    const username = document.getElementById('server-username').value.trim();
    const password = document.getElementById('server-password').value;

    if (!host || !username || !password) {
        showToast('请填写完整信息', 'error');
        return;
    }

    const newServer = { name, host, username, password };

    servers.push(newServer);
    const result = await apiRequest('/servers', {
        method: 'POST',
        body: JSON.stringify({ servers })
    });

    if (result.success) {
        showToast('服务器已添加', 'success');
        closeAddCredentialModal();
        renderCredentialsList();
        checkConnection();
        loadServerDetail(true);
        loadVMs();
    } else {
        showToast('保存失败', 'error');
    }
}

function editServer(index) {
    const server = servers[index];
    if (!server) return;

    document.getElementById('server-name').value = server.name || '';
    document.getElementById('server-host').value = server.host || '';
    document.getElementById('server-username').value = server.username || '';
    document.getElementById('server-password').value = server.password || '';
    const testResult = document.getElementById('connection-test-result');
    if (testResult) testResult.style.display = 'none';

    document.getElementById('add-credential-modal').style.display = 'flex';
    document.getElementById('credential-modal-title').textContent = '🖥️ 编辑服务器';
    editingServerIndex = index;
    document.getElementById('add-credential-submit-btn').textContent = '保存修改';
    document.getElementById('add-credential-submit-btn').onclick = () => confirmEditCredential(index);
    document.getElementById('add-credential-cancel-btn').style.display = 'inline-block';
    document.getElementById('add-credential-cancel-btn').onclick = () => {
        closeAddCredentialModal();
        editingServerIndex = -1;
    };
}

async function confirmEditCredential(index) {
    const name = document.getElementById('server-name').value.trim();
    const host = document.getElementById('server-host').value.trim();
    const username = document.getElementById('server-username').value.trim();
    const password = document.getElementById('server-password').value;

    if (!host || !username || !password) {
        showToast('请填写完整信息', 'error');
        return;
    }

    servers[index] = { name, host, username, password };
    const result = await apiRequest('/servers', {
        method: 'POST',
        body: JSON.stringify({ servers })
    });

    if (result.success) {
        showToast('服务器已更新', 'success');
        closeAddCredentialModal();
        editingServerIndex = -1;
        renderCredentialsList();
        checkConnection();
        loadServerDetail(true);
        loadVMs();
    } else {
        showToast('保存失败', 'error');
    }
}

async function deleteServer(index) {
    servers.splice(index, 1);
    const result = await apiRequest('/servers', {
        method: 'POST',
        body: JSON.stringify({ servers })
    });

    if (result.success) {
        showToast('服务器已删除', 'success');
        renderCredentialsList();
        checkConnection();
        loadServerDetail(true);
        loadVMs();
    } else {
        showToast('删除失败', 'error');
    }
}

async function refreshLogs() {
    try {
        const result = await apiRequest('/logs');
        const logContent = document.getElementById('log-content');

        if (result && result.success && logContent) {
            logContent.textContent = result.logs || '暂无日志记录';
            logContent.scrollTop = logContent.scrollHeight;
        } else if (logContent) {
            logContent.textContent = '加载日志失败: ' + (result?.error || '未知错误');
        }
    } catch (e) {
        console.error('加载日志失败:', e);
        const logContent = document.getElementById('log-content');
        if (logContent) logContent.textContent = '加载日志失败: ' + e.message;
    }
}

async function clearLogs() {
    try {
        const result = await apiRequest('/logs/clear', { method: 'POST' });
        if (result.success) {
            showToast('日志已清空', 'success');
            refreshLogs();
        } else {
            showToast('清空失败', 'error');
        }
    } catch (e) {
        showToast('清空失败: ' + e.message, 'error');
    }
}

let logAutoRefresh = null;
let logRefreshInterval = 5000;
function startLogAutoRefresh() {
    stopLogAutoRefresh();
    logAutoRefresh = setInterval(() => {
        refreshLogs();
    }, logRefreshInterval);
}

function stopLogAutoRefresh() {
    if (logAutoRefresh) {
        clearInterval(logAutoRefresh);
        logAutoRefresh = null;
    }
}

function toggleLogAutoRefresh(btn) {
    if (logAutoRefresh) {
        stopLogAutoRefresh();
        if (btn) btn.textContent = '▶ 自动刷新';
    } else {
        startLogAutoRefresh();
        if (btn) btn.textContent = '⏸ 停止刷新';
    }
}

let selectedTaskVMs = new Set();

function initSchedulerForm() {
    const vmSelector = document.getElementById('new-task-vms');
    if (!vmSelector) return;
    if (vmData.length === 0) {
        vmSelector.innerHTML = '<span class="text-muted">请先在控制台加载虚拟机</span>';
        return;
    }
    vmSelector.innerHTML = vmData.map(vm => {
        const safeName = escapeHtml(vm.name);
        const safeKey = escapeHtml(vm.name + '|' + vm.server_host);
        return `<span class="task-vm-item" data-vm="${safeKey}" onclick="toggleTaskVM(this)">${safeName}</span>`;
    }).join('');
}

function toggleTaskVM(el) {
    const vmKey = el.getAttribute('data-vm');
    if (selectedTaskVMs.has(vmKey)) {
        selectedTaskVMs.delete(vmKey);
        el.classList.remove('selected');
    } else {
        selectedTaskVMs.add(vmKey);
        el.classList.add('selected');
    }
}

async function createTask() {
    const name = document.getElementById('new-task-name').value.trim();
    if (!name) { showToast('请输入任务名称', 'error'); return; }
    if (selectedTaskVMs.size === 0) { showToast('请选择至少一台虚拟机', 'error'); return; }

    const action = document.getElementById('new-task-action').value;
    const timeParts = document.getElementById('new-task-time').value.split(':');
    const selectedDays = Array.from(document.querySelectorAll('input[name="new-task-days"]:checked')).map(cb => cb.value);
    const delay = parseInt(document.getElementById('new-task-delay').value) || 0;
    if (selectedDays.length === 0) { showToast('请选择至少一个执行日期', 'error'); return; }

    const task = {
        id: Math.random().toString(36).substring(2, 10),
        name: name,
        trigger_type: 'cron',
        action: action,
        delay: delay,
        timezone: 'Asia/Shanghai',
        cron: { hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), day_of_week: selectedDays.join(',') },
        target_vms: Array.from(selectedTaskVMs).map(key => {
            const [n, server_host] = key.split('|');
            return { name: n, server_host };
        }),
        enabled: true
    };

    try {
        const result = await apiRequest('/scheduler/tasks', { method: 'POST', body: JSON.stringify(task) });
        if (result.success) {
            showToast('任务已创建', 'success');
            resetTaskForm();
        } else {
            showToast('创建失败: ' + (result.error || '未知错误'), 'error');
        }
        loadTasks();
    } catch (e) {
        showToast('创建失败: ' + e.message, 'error');
        loadTasks();
    }
}

function resetTaskForm() {
    document.getElementById('new-task-name').value = '';
    document.getElementById('new-task-action').value = 'start';
    document.getElementById('new-task-time').value = '09:00';
    document.querySelectorAll('input[name="new-task-days"]').forEach((cb, i) => cb.checked = i < 5);
    document.getElementById('new-task-delay').value = 0;
    selectedTaskVMs.clear();
    document.querySelectorAll('.task-vm-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('new-task-submit-btn').textContent = '创建任务';
    document.getElementById('new-task-submit-btn').onclick = createTask;
    const cancelBtn = document.getElementById('new-task-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

let editingTaskId = null;

async function openEditTaskModal(taskId) {
    try {
        const result = await apiRequest('/scheduler/tasks');
        if (!result) {
            showToast('加载任务信息失败: 无响应', 'error');
            return;
        }
        if (!result.success) {
            showToast('加载任务信息失败: ' + (result.error || '未知错误'), 'error');
            return;
        }
        if (!result.tasks) {
            showToast('加载任务信息失败: 无任务数据', 'error');
            return;
        }

        const task = result.tasks.find(t => t.id === taskId);
        if (!task) {
            showToast('加载任务信息失败: 未找到任务', 'error');
            return;
        }

        editingTaskId = taskId;
        document.getElementById('new-task-name').value = task.name || '';
        document.getElementById('new-task-action').value = task.action || 'start';
        document.getElementById('new-task-time').value = `${String(task.cron?.hour || 0).padStart(2, '0')}:${String(task.cron?.minute || 0).padStart(2, '0')}`;

        const days = (task.cron?.day_of_week || '').split(',').filter(d => d);
        document.querySelectorAll('input[name="new-task-days"]').forEach(cb => {
            cb.checked = days.includes(cb.value);
        });

        document.getElementById('new-task-delay').value = task.delay || 0;

        selectedTaskVMs.clear();
        document.querySelectorAll('.task-vm-item').forEach(el => el.classList.remove('selected'));
        if (task.target_vms && Array.isArray(task.target_vms)) {
            task.target_vms.forEach(vm => {
                const key = `${vm.name}|${vm.server_host}`;
                selectedTaskVMs.add(key);
                const el = document.querySelector(`.task-vm-item[data-vm="${vm.name}"][data-server="${vm.server_host}"]`);
                if (el) el.classList.add('selected');
            });
        }

        document.getElementById('new-task-submit-btn').textContent = '保存修改';
        document.getElementById('new-task-submit-btn').onclick = updateTask;
        const cancelBtn = document.getElementById('new-task-cancel-btn');
        if (cancelBtn) {
            cancelBtn.style.display = 'inline-block';
            cancelBtn.onclick = cancelEditTask;
        }

        document.getElementById('new-task-modal')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error('Edit task error:', e);
        showToast('加载任务信息失败: ' + e.message, 'error');
    }
}

function cancelEditTask() {
    editingTaskId = null;
    resetTaskForm();
}

async function updateTask() {
    const name = document.getElementById('new-task-name').value.trim();
    if (!name) { showToast('请输入任务名称', 'error'); return; }
    if (selectedTaskVMs.size === 0) { showToast('请选择至少一台虚拟机', 'error'); return; }

    const action = document.getElementById('new-task-action').value;
    const timeParts = document.getElementById('new-task-time').value.split(':');
    const selectedDays = Array.from(document.querySelectorAll('input[name="new-task-days"]:checked')).map(cb => cb.value);
    const delay = parseInt(document.getElementById('new-task-delay').value) || 0;
    if (selectedDays.length === 0) { showToast('请选择至少一个执行日期', 'error'); return; }

    const task = {
        id: editingTaskId,
        name: name,
        trigger_type: 'cron',
        action: action,
        delay: delay,
        timezone: 'Asia/Shanghai',
        cron: { hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), day_of_week: selectedDays.join(',') },
        target_vms: Array.from(selectedTaskVMs).map(key => {
            const [n, server_host] = key.split('|');
            return { name: n, server_host };
        }),
        enabled: true
    };

    try {
        const result = await apiRequest('/scheduler/tasks', { method: 'POST', body: JSON.stringify(task) });
        if (result.success) {
            showToast('任务已更新', 'success');
            editingTaskId = null;
            resetTaskForm();
        } else {
            showToast('更新失败: ' + (result.error || '未知错误'), 'error');
        }
        loadTasks();
    } catch (e) {
        showToast('更新失败: ' + e.message, 'error');
        loadTasks();
    }
}

async function loadTasks() {
    showLoading('加载定时任务...');
    try {
        const result = await apiRequest('/scheduler/tasks');
        const tasksList = document.getElementById('tasks-list');
        if (!tasksList) return;

        if (result.success && result.tasks && result.tasks.length > 0) {
            const actionLabels = { 'start': '启动', 'stop': '停止', 'suspend': '挂起' };
            const actionIcons = { 'start': '▶', 'stop': '⏹', 'suspend': '⏸' };

            tasksList.innerHTML = result.tasks.map(task => {
                const days = task.cron?.day_of_week || '0-4';
                const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                const dayStr = days === '0-6' || days === '0,1,2,3,4,5,6' ? '每天'
                    : days.split(',').map(d => dayNames[parseInt(d)] || d).join(',');
                const time = `${String(task.cron?.hour || 0).padStart(2, '0')}:${String(task.cron?.minute || 0).padStart(2, '0')}`;
                const vmNames = task.target_vms?.map(v => v.name).join(', ') || '无';
                const delay = task.delay || 0;
                const delayStr = delay > 0 ? ` | 间隔${delay}秒` : '';
                const tzStr = task.timezone || 'CST';

                return `
                    <div class="task-list-item ${task.enabled ? '' : 'disabled'}">
                        <div class="task-info">
                            <div class="task-title">${actionIcons[task.action]} ${task.name}</div>
                            <div class="task-meta">⏰ ${time} ${tzStr} | ${dayStr}${delayStr} | ${vmNames}</div>
                        </div>
                        <div class="task-controls">
                            <button class="btn btn-sm btn-warning" onclick="openEditTaskModal('${task.id}')">✏️</button>
                            <button class="btn btn-sm btn-info" onclick="openWebhookModal()">🔔</button>
                            ${task.enabled
                                ? `<button class="btn btn-sm btn-secondary" onclick="toggleTask('${task.id}', false)">⏸</button>`
                                : `<button class="btn btn-sm btn-success" onclick="toggleTask('${task.id}', true)">▶</button>`
                            }
                            <button class="btn btn-sm btn-primary" onclick="runTaskNow('${task.id}')">▶▶</button>
                            <button class="btn btn-sm btn-danger" onclick="removeTask('${task.id}')">🗑️</button>
                        </div>
                    </div>`;
            }).join('');
        } else {
            tasksList.innerHTML = '<p class="text-muted">还没有定时任务</p>';
        }
    } catch (e) {
        console.error('加载任务失败:', e);
    } finally {
        setTimeout(hideLoading, 100);
    }
}

async function toggleTask(taskId, enabled) {
    try {
        const result = await apiRequest(`/scheduler/tasks/${taskId}/${enabled ? 'resume' : 'pause'}`, { method: 'POST' });
        if (result.success) {
            showToast(enabled ? '任务已恢复' : '任务已暂停', 'success');
            loadTasks();
        } else {
            showToast('操作失败', 'error');
        }
    } catch (e) {
        showToast('操作失败', 'error');
    }
}

async function runTaskNow(taskId) {
    try {
        showToast('正在执行...', 'info');
        const result = await apiRequest(`/scheduler/tasks/${taskId}/run`, { method: 'POST' });
        if (result.success) {
            const r = result.result;
            showToast(`完成: 成${r.success} 败${r.failed}`, r.failed > 0 ? 'warning' : 'success');
        } else {
            showToast('执行失败', 'error');
        }
    } catch (e) {
        showToast('执行失败', 'error');
    }
}

async function removeTask(taskId) {
    if (!confirm('确定删除?')) return;
    try {
        const result = await apiRequest(`/scheduler/tasks/${taskId}`, { method: 'DELETE' });
        if (result.success) {
            showToast('已删除', 'success');
            loadTasks();
        } else {
            showToast('删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

let currentVmDetail = null;

async function openVmDetail(vmName, serverHost, event) {
    if (event && event.stopPropagation) event.stopPropagation();

    const modal = document.getElementById('vm-detail-modal');
    const content = document.getElementById('vm-detail-content');
    const title = document.getElementById('vm-detail-title');

    if (!modal || !content) return;

    title.textContent = `🖥️ ${vmName}`;
    content.innerHTML = '<div class="vm-detail-loading">加载中...</div>';
    modal.style.display = 'flex';

    try {
        const result = await apiRequest(`/vm/${encodeURIComponent(vmName)}/detail?server_host=${encodeURIComponent(serverHost)}`);

        if (result.success && result.vm) {
            currentVmDetail = result.vm;
            renderVmDetail(result.vm);
        } else {
            content.innerHTML = `<div class="vm-detail-loading">加载失败: ${result.error || '未知错误'}</div>`;
        }
    } catch (e) {
        content.innerHTML = `<div class="vm-detail-loading">加载失败: ${e.message}</div>`;
    }
}

function renderVmDetail(vm) {
    const content = document.getElementById('vm-detail-content');
    if (!content) return;

    const stateClass = {
        'poweredOn': 'status-on',
        'poweredOff': 'status-off',
        'suspended': 'status-suspended'
    }[vm.state] || '';

    const stateText = {
        'poweredOn': '运行中',
        'poweredOff': '已停止',
        'suspended': '已挂起'
    }[vm.state] || vm.state;

    const uptime = formatUptime(vm.uptime_seconds);

    const guestInfo = vm.guest || {};
    const snapshotList = vm.snapshots?.snapshots || [];
    const networkList = vm.network || [];
    const diskList = vm.disks || [];

    content.innerHTML = `
        <div class="vm-detail-section">
            <h4>📋 基本信息</h4>
            <div class="vm-detail-grid">
                <div class="vm-detail-item">
                    <span class="label">状态</span>
                    <span class="value ${stateClass}">${stateText}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">服务器</span>
                    <span class="value">${escapeHtml(vm.server || vm.server_host)}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">CPU</span>
                    <span class="value">${vm.cpu?.count || 0} 核 ${vm.cpu?.threads ? `(${vm.cpu.threads} 线程)` : ''}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">内存</span>
                    <span class="value">${vm.memory?.total_gb || 0} GB</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">UUID</span>
                    <span class="value" style="font-size: 0.8rem; word-break: break-all;">${vm.uuid || 'N/A'}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">运行时间</span>
                    <span class="value">${uptime}</span>
                </div>
            </div>
        </div>

        <div class="vm-detail-section">
            <h4>💻 客户机信息</h4>
            <div class="vm-detail-grid">
                <div class="vm-detail-item">
                    <span class="label">IP地址</span>
                    <span class="value">${guestInfo.ip_address || 'N/A'}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">主机名</span>
                    <span class="value">${guestInfo.hostname || 'N/A'}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">操作系统</span>
                    <span class="value">${guestInfo.os_type || 'N/A'}</span>
                </div>
                <div class="vm-detail-item">
                    <span class="label">VMware Tools</span>
                    <span class="value">${guestInfo.tools_status || 'N/A'}</span>
                </div>
            </div>
        </div>

        <div class="vm-detail-section">
            <h4>🔗 网络适配器</h4>
            ${networkList.length > 0 ? networkList.map(nic => `
                <div class="vm-detail-item" style="margin-bottom: 8px;">
                    <span class="label">${escapeHtml(nic.name)}</span>
                    <span class="value">MAC: ${nic.mac || 'N/A'} | ${nic.connected ? '已连接' : '未连接'}</span>
                </div>
            `).join('') : '<p class="text-muted">无网络适配器</p>'}
        </div>

        <div class="vm-detail-section">
            <h4>💾 磁盘</h4>
            ${diskList.length > 0 ? diskList.map(disk => `
                <div class="vm-detail-item" style="margin-bottom: 8px;">
                    <span class="label">${escapeHtml(disk.name)}</span>
                    <span class="value">${disk.capacity_gb || 0} GB | ${disk.type || 'Unknown'}</span>
                </div>
            `).join('') : '<p class="text-muted">无磁盘信息</p>'}
        </div>

        <div class="vm-detail-section">
            <h4>📸 快照 (${vm.snapshots?.count || 0})</h4>
            ${snapshotList.length > 0 ? `
                <div class="snapshot-list">
                    ${snapshotList.map(snap => `
                        <div class="snapshot-item">
                            <div class="name">${escapeHtml(snap.name)}</div>
                            <div class="info">${snap.creation_time || ''} | ${snap.state || ''}</div>
                            ${snap.description ? `<div class="info">${escapeHtml(snap.description)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : '<p class="text-muted">无快照</p>'}
        </div>

        <div class="vm-detail-section">
            <h4>📝 其他</h4>
            <div class="vm-detail-grid">
                <div class="vm-detail-item">
                    <span class="label">VM路径</span>
                    <span class="value" style="font-size: 0.85rem; word-break: break-all;">${vm.vm_path || 'N/A'}</span>
                </div>
                ${vm.annotation ? `
                <div class="vm-detail-item" style="grid-column: span 2;">
                    <span class="label">备注</span>
                    <span class="value">${escapeHtml(vm.annotation)}</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时 ${minutes}分钟`;
    if (hours > 0) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
}

function closeVmDetailModal() {
    const modal = document.getElementById('vm-detail-modal');
    if (modal) modal.style.display = 'none';
    currentVmDetail = null;
}

function refreshVmDetail() {
    if (currentVmDetail) {
        openVmDetail(currentVmDetail.name, currentVmDetail.server_host, null);
    }
}

async function openVmPerformance(vmName, serverHost, event) {
    if (event && event.stopPropagation) event.stopPropagation();

    const modal = document.getElementById('vm-performance-modal');
    const title = document.getElementById('vm-performance-title');

    if (!modal) return;

    title.textContent = `📊 ${vmName} 性能监控`;
    modal.style.display = 'flex';

    document.getElementById('perf-cpu').textContent = '--';
    document.getElementById('perf-memory').textContent = '--';
    document.getElementById('perf-network').textContent = '--';
    document.getElementById('perf-cpu-bar').style.width = '0%';
    document.getElementById('perf-memory-bar').style.width = '0%';
    document.getElementById('performance-chart').innerHTML = '<div class="chart-placeholder">加载中...</div>';

    try {
        const result = await apiRequest(`/vm/${encodeURIComponent(vmName)}/performance?server_host=${encodeURIComponent(serverHost)}`);

        if (result.success) {
            const realtime = result.realtime || {};
            document.getElementById('perf-cpu').textContent = (realtime.cpu_percent || 0) + '%';
            document.getElementById('perf-memory').textContent = (realtime.memory_percent || 0) + '%';
            document.getElementById('perf-network').textContent = (realtime.network_kbps || 0) + ' KB/s';

            document.getElementById('perf-cpu-bar').style.width = (realtime.cpu_percent || 0) + '%';
            document.getElementById('perf-memory-bar').style.width = (realtime.memory_percent || 0) + '%';

            renderPerformanceChart(result.history || {});
        } else {
            document.getElementById('performance-chart').innerHTML = `<div class="chart-placeholder">加载失败: ${result.error || '未知错误'}</div>`;
        }
    } catch (e) {
        document.getElementById('performance-chart').innerHTML = `<div class="chart-placeholder">加载失败: ${e.message}</div>`;
    }
}

function renderPerformanceChart(history) {
    const chartDiv = document.getElementById('performance-chart');
    if (!chartDiv) return;

    const hasData = Object.keys(history).some(key => history[key] && history[key].length > 0);

    if (!hasData) {
        chartDiv.innerHTML = '<div class="chart-placeholder">暂无历史数据<br><small>性能历史数据需要ESXi开启性能监控</small></div>';
        return;
    }

    chartDiv.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <p style="color: var(--text-muted);">历史性能数据图表</p>
            <p style="color: var(--text-muted); font-size: 0.85rem;">CPU: ${history['cpu.usage.average']?.length || 0} 条记录</p>
            <p style="color: var(--text-muted); font-size: 0.85rem;">内存: ${history['mem.usage.average']?.length || 0} 条记录</p>
        </div>
    `;
}

function closeVmPerformanceModal() {
    const modal = document.getElementById('vm-performance-modal');
    if (modal) modal.style.display = 'none';
}

function refreshVmPerformance() {
    if (currentVmDetail) {
        openVmPerformance(currentVmDetail.name, currentVmDetail.server_host, null);
    }
}

function openVmPerformanceFromDetail() {
    if (currentVmDetail) {
        const vmName = currentVmDetail.name;
        const serverHost = currentVmDetail.server_host;
        closeVmDetailModal();
        openVmPerformance(vmName, serverHost, null);
    }
}

function openWebhookModal(taskId) {
    const modal = document.getElementById('webhook-modal');
    if (!modal) return;

    const settings = window.appSettings || {};
    const notification = settings.notification || {};

    document.getElementById('notification-enable').checked = notification.enabled || false;
    document.getElementById('wechat-enable').checked = notification.wechat_enabled || false;
    document.getElementById('wechat-url').value = notification.wechat_url || '';
    document.getElementById('dingtalk-enable').checked = notification.dingtalk_enabled || false;
    document.getElementById('dingtalk-url').value = notification.dingtalk_url || '';
    document.getElementById('feishu-enable').checked = notification.feishu_enabled || false;
    document.getElementById('feishu-url').value = notification.feishu_url || '';
    document.getElementById('slack-enable').checked = notification.slack_enabled || false;
    document.getElementById('slack-url').value = notification.slack_url || '';
    document.getElementById('telegram-enable').checked = notification.telegram_enabled || false;
    document.getElementById('telegram-bot-token').value = notification.telegram_bot_token || '';
    document.getElementById('telegram-chat-id').value = notification.telegram_chat_id || '';

    toggleNotificationChannels(notification.enabled || false);

    modal.style.display = 'flex';
}

function closeWebhookModal() {
    const modal = document.getElementById('webhook-modal');
    if (modal) modal.style.display = 'none';
}

async function saveWebhookConfig() {
    const notification = {
        enabled: document.getElementById('notification-enable').checked,
        wechat_enabled: document.getElementById('wechat-enable').checked,
        wechat_url: document.getElementById('wechat-url').value.trim(),
        dingtalk_enabled: document.getElementById('dingtalk-enable').checked,
        dingtalk_url: document.getElementById('dingtalk-url').value.trim(),
        feishu_enabled: document.getElementById('feishu-enable').checked,
        feishu_url: document.getElementById('feishu-url').value.trim(),
        slack_enabled: document.getElementById('slack-enable').checked,
        slack_url: document.getElementById('slack-url').value.trim(),
        telegram_enabled: document.getElementById('telegram-enable').checked,
        telegram_bot_token: document.getElementById('telegram-bot-token').value.trim(),
        telegram_chat_id: document.getElementById('telegram-chat-id').value.trim()
    };

    try {
        const result = await apiRequest('/settings', {
            method: 'POST',
            body: JSON.stringify({ notification: notification })
        });

        if (result.success) {
            showToast('通知设置已保存', 'success');
            closeWebhookModal();
        } else {
            showToast('保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

function toggleNotificationChannels(enabled) {
    const channelsDiv = document.getElementById('notification-channels');
    if (channelsDiv) {
        channelsDiv.style.opacity = enabled ? '1' : '0.5';
        channelsDiv.style.pointerEvents = enabled ? 'auto' : 'none';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            const targetTab = document.getElementById(tabId);
            if (targetTab) targetTab.classList.add('active');

            switch (tabId) {
                case 'logs':
                    refreshLogs();
                    startLogAutoRefresh();
                    break;
                case 'credentials':
                    loadCredentials();
                    stopLogAutoRefresh();
                    break;
                case 'servers':
                    loadServerDetail();
                    stopLogAutoRefresh();
                    break;
                case 'scheduler':
                    loadTasks();
                    initSchedulerForm();
                    stopLogAutoRefresh();
                    break;
                case 'settings':
                    loadSettingsForPage();
                    stopLogAutoRefresh();
                    break;
                case 'vms':
                    loadVMs();
                    stopLogAutoRefresh();
                    break;
                case 'dashboard':
                    stopLogAutoRefresh();
                    break;
            }
        });
    });

    const delaySlider = document.getElementById('delay-slider');
    const delayValue = document.getElementById('delay-value');
    if (delaySlider && delayValue) {
        delaySlider.addEventListener('input', function() {
            currentDelay = parseInt(this.value);
            delayValue.textContent = currentDelay;
            const currentDelayDisplay = document.getElementById('current-delay-value');
            if (currentDelayDisplay) currentDelayDisplay.textContent = currentDelay;
            const estimatedTimeEl = document.getElementById('estimated-time-value');
            if (estimatedTimeEl) {
                const selectedList = getSelectedVMList();
                estimatedTimeEl.textContent = selectedList.length > 0 ? (selectedList.length - 1) * currentDelay : 0;
            }
        });
        delaySlider.addEventListener('change', function() {
            saveSettings();
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey || e.metaKey) {
            switch(e.key.toLowerCase()) {
                case 'r':
                    e.preventDefault();
                    refreshStatus();
                    showToast('已刷新', 'info');
                    break;
                case 'a':
                    e.preventDefault();
                    selectAllVMs();
                    break;
                case 's':
                    e.preventDefault();
                    if (selectedVMs.size > 0) {
                        openSaveFavoriteModal();
                    } else {
                        showToast('请先选择虚拟机', 'warning');
                    }
                    break;
            }
        }
    });

    await loadSettings();

    checkConnection();
    loadServerDetail();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
            registration.active.postMessage({ type: 'CLEAR_CACHE' });
        });
    }

    if (!localStorage.getItem('welcomeShown') && servers.length === 0) {
        setTimeout(() => openWelcomeModal(), 500);
    }
});
