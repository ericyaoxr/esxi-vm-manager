const API_BASE = '/api';

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

let vmData = [];
let servers = [];
let selectedVMs = new Set();
let favorites = [];
let currentDelay = 30;
let currentFavoriteIndex = -1;
let isProcessing = false;

function setBatchButtonsDisabled(disabled) {
    const btns = document.querySelectorAll('.batch-panel .btn');
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
        const result = await apiRequest('/settings');
        if (result.success && result.settings) {
            currentDelay = result.settings.delay || 30;
            updateDelayDisplay();
        }
    } catch (e) {
        console.warn('加载设置失败:', e);
    }
}

function updateDelayDisplay() {
    const delaySlider = document.getElementById('delay-slider');
    const delayValue = document.getElementById('delay-value');
    if (delaySlider) delaySlider.value = currentDelay;
    if (delayValue) delayValue.textContent = currentDelay;
}

async function saveSettings() {
    try {
        await apiRequest('/settings', {
            method: 'POST',
            body: JSON.stringify({ delay: currentDelay })
        });
    } catch (e) {
        console.warn('保存设置失败:', e);
    }
}

async function apiRequest(endpoint, options = {}) {
    try {
        const response = await fetch(API_BASE + endpoint, {
            headers: {
                'Content-Type': 'application/json',
            },
            ...options
        });
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { success: false, error: error.message };
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast');
    if (!container) return;

    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function checkConnection() {
    try {
        const result = await apiRequest('/status');
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');

        if (result.connected) {
            indicator.className = 'status-indicator online';
            const serverCount = result.servers ? result.servers.length : 0;
            text.textContent = `已连接 ${serverCount} 台服务器`;
        } else {
            indicator.className = 'status-indicator offline';
            text.textContent = '未连接';
        }
        return result.connected;
    } catch (e) {
        console.error('检查连接失败:', e);
        return false;
    }
}

async function refreshStatus() {
    await checkConnection();
    await loadServers();
    await loadVMs();
    await loadFavorites();
    updateVMCards();
}

async function loadServers() {
    try {
        const result = await apiRequest('/servers');
        if (result.success) {
            servers = result.servers || [];
        }
    } catch (e) {
        console.error('加载服务器失败:', e);
    }
}

async function loadServerDetail() {
    try {
        const result = await apiRequest('/servers/detail');
        const serverListDiv = document.getElementById('server-list');
        if (!serverListDiv) return;

        console.log('Server detail result:', result);

        if (!result.success || !result.servers || result.servers.length === 0) {
            serverListDiv.innerHTML = `
                <div class="empty-state">
                    <span class="icon">🖧</span>
                    <p class="text-muted">暂无服务器信息</p>
                </div>`;
            return;
        }

        const serverCards = result.servers.map(server => {
            if (!server.connected) {
                return `
                    <div class="server-card error">
                        <div class="server-card-header">
                            <span class="server-name">${escapeHtml(server.name) || server.host}</span>
                            <span class="server-status offline">离线</span>
                        </div>
                        <p class="text-muted" style="color: var(--danger);">${escapeHtml(server.error) || '连接失败'}</p>
                    </div>
                `;
            }

            const cpuPercent = server.cpu.usage_percent;
            const cpuClass = cpuPercent > 80 ? 'high' : cpuPercent > 60 ? 'medium' : 'low';

            const memPercent = server.memory.usage_percent;
            const memClass = memPercent > 80 ? 'high' : memPercent > 60 ? 'medium' : 'low';

            const diskRows = server.disks.map(disk => {
                const diskPercent = disk.usage_percent;
                const diskClass = diskPercent > 90 ? 'high' : diskPercent > 70 ? 'medium' : 'low';
                return `
                    <tr>
                        <td>${disk.name}</td>
                        <td>${formatSize(disk.capacity)}</td>
                        <td>${formatSize(disk.free)}</td>
                        <td><span class="resource-fill ${diskClass}">${disk.usage_percent.toFixed(1)}%</span></td>
                    </tr>
                `;
            }).join('');

            const remark = escapeHtml(server.remark || '');

            return `
                <div class="server-card">
                    <div class="server-card-header">
                        <span class="server-name">${escapeHtml(server.name) || server.host}</span>
                        <span class="server-status online">在线</span>
                    </div>
                    <div class="server-info-grid">
                        <div class="server-info-item">
                            <label>型号</label>
                            <span>${escapeHtml(server.model) || 'N/A'}</span>
                        </div>
                        <div class="server-info-item">
                            <label>厂商</label>
                            <span>${escapeHtml(server.server_vendor) || 'N/A'}</span>
                        </div>
                        <div class="server-info-item">
                            <label>地址</label>
                            <span>${server.host}</span>
                        </div>
                        <div class="server-info-item">
                            <label>版本</label>
                            <span>${server.version} (Build ${server.build})</span>
                        </div>
                        <div class="server-info-item">
                            <label>虚拟机</label>
                            <span>${server.vm_count} 台</span>
                        </div>
                        <div class="server-info-item">
                            <label>备注</label>
                            <span>${remark || '暂无'}</span>
                        </div>
                    </div>
                    <div class="resource-bar">
                        <div class="resource-label">
                            <span class="resource-name">CPU</span>
                            <span class="resource-value">${server.cpu.usage_ghz || 0} / ${server.cpu.total_ghz || 0} GHz (${cpuPercent}%)</span>
                        </div>
                        <div class="resource-track">
                            <div class="resource-fill ${cpuClass}" style="width: ${cpuPercent}%"></div>
                        </div>
                    </div>
                    <div class="resource-bar">
                        <div class="resource-label">
                            <span class="resource-name">内存</span>
                            <span class="resource-value">${formatSize(server.memory.usage)} / ${formatSize(server.memory.total)} (${memPercent}%)</span>
                        </div>
                        <div class="resource-track">
                            <div class="resource-fill ${memClass}" style="width: ${memPercent}%"></div>
                        </div>
                    </div>
                    <table class="disk-table">
                        <tr><th>名称</th><th>总容量</th><th>剩余</th><th>使用率</th></tr>
                        ${diskRows}
                    </table>
                </div>
            `;
        }).join('');

        serverListDiv.innerHTML = serverCards;
    } catch (e) {
        console.error('加载服务器详情失败:', e);
        const serverListDiv = document.getElementById('server-list');
        if (serverListDiv) {
            serverListDiv.innerHTML = `
                <div class="empty-state">
                    <span class="icon">⚠</span>
                    <p class="text-muted">加载失败</p>
                </div>`;
        }
    }
}

function formatSize(gb) {
    if (gb >= 1024) {
        return (gb / 1024).toFixed(2) + ' TB';
    }
    return gb.toFixed(1) + ' GB';
}

async function loadVMs() {
    try {
        const result = await apiRequest('/vms');
        const vmListDiv = document.getElementById('vm-list');
        const vmOverviewDiv = document.getElementById('vm-overview');

        if (result.success && result.vms) {
            vmData = result.vms;

            if (vmData.length === 0) {
                if (vmListDiv) vmListDiv.innerHTML = `
                    <div class="empty-state">
                        <span class="icon">🖥️</span>
                        <p class="text-muted">未找到虚拟机</p>
                    </div>`;
                if (vmOverviewDiv) vmOverviewDiv.innerHTML = `
                    <div class="empty-state">
                        <span class="icon">🖥️</span>
                        <p class="text-muted">未找到虚拟机</p>
                    </div>`;
                return;
            }

            const vmCards = vmData.map(vm => createVMCard(vm)).join('');
            if (vmOverviewDiv) vmOverviewDiv.innerHTML = vmCards;

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
                        <div class="server-group-header">
                            <span class="server-group-title">🖧 ${escapeHtml(group.server)}</span>
                            <span class="server-group-count">${group.vms.length} 台</span>
                        </div>
                        <div class="vm-grid">${serverVmCards}</div>
                    </div>
                `;
            });
            if (vmListDiv) vmListDiv.innerHTML = groupedHtml;
        } else {
            const msg = result.error || '加载虚拟机失败';
            if (vmListDiv) vmListDiv.innerHTML = `
                <div class="empty-state">
                    <span class="icon">⚠</span>
                    <p class="text-muted">${msg}</p>
                </div>`;
            if (vmOverviewDiv) vmOverviewDiv.innerHTML = `
                <div class="empty-state">
                    <span class="icon">⚠</span>
                    <p class="text-muted">加载虚拟机失败</p>
                </div>`;
        }
    } catch (e) {
        console.error('加载虚拟机失败:', e);
        const vmListDiv = document.getElementById('vm-list');
        const vmOverviewDiv = document.getElementById('vm-overview');
        if (vmListDiv) vmListDiv.innerHTML = `
            <div class="empty-state">
                <span class="icon">⚠</span>
                <p class="text-muted">加载失败</p>
            </div>`;
        if (vmOverviewDiv) vmOverviewDiv.innerHTML = `
            <div class="empty-state">
                <span class="icon">⚠</span>
                <p class="text-muted">加载失败</p>
            </div>`;
    }
}

function createVMCard(vm) {
    const stateClass = vm.state === 'poweredOn' ? 'running' : vm.state === 'poweredOff' ? 'stopped' : 'suspended';
    const isPoweredOff = vm.state === 'poweredOff';
    const canSuspend = vm.state === 'poweredOn';
    const canStart = vm.state === 'poweredOff' || vm.state === 'suspended';
    const key = vm.name + '|' + vm.server_host;
    const isSelected = selectedVMs.has(key);
    const stateText = {
        'poweredOn': '运行中',
        'poweredOff': '已停止',
        'suspended': '已挂起'
    }[vm.state] || '未知';

    return `
        <div class="vm-card ${isSelected ? 'selected' : ''}" data-vm-name="${vm.name}" data-server-host="${vm.server_host}">
            <div class="vm-card-header" onclick="handleVMCardClick(event, '${vm.name}', '${vm.server_host}')">
                <input type="checkbox" class="vm-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleVMSelection('${vm.name}', '${vm.server_host}')">
                <span class="vm-name" title="${vm.server || ''}">${escapeHtml(vm.name)}</span>
                <span class="state-badge ${stateClass}">${stateText}</span>
            </div>
            <div class="vm-card-body">
                <div class="vm-info">
                    <div class="vm-info-item">
                        <span class="vm-info-label">服务器</span>
                        <span class="vm-info-value">${vm.server || vm.server_host}</span>
                    </div>
                    <div class="vm-info-item">
                        <span class="vm-info-label">状态</span>
                        <span class="vm-info-value">${stateText}</span>
                    </div>
                    <div class="vm-info-item">
                        <span class="vm-info-label">CPU</span>
                        <span class="vm-info-value">${vm.cpu || 0} 核</span>
                    </div>
                    <div class="vm-info-item">
                        <span class="vm-info-label">内存</span>
                        <span class="vm-info-value">${vm.memory || 0} GB</span>
                    </div>
                </div>
            </div>
            <div class="vm-card-footer btn-group" data-vm-name="${vm.name}" data-server-host="${vm.server_host}">
                ${canSuspend ? `<button class="btn btn-warning btn-sm" onclick="suspendVM('${vm.name}', '${vm.server_host}', event)">⏸ 挂起</button>` : ''}
                ${canStart ? `<button class="btn btn-success btn-sm" onclick="startVM('${vm.name}', '${vm.server_host}', event)">▶ 启动</button>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="refreshStatus()">🔄 刷新</button>
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

function filterVMs() {
    const searchInput = document.getElementById('vm-search');
    const searchTerm = searchInput.value.toLowerCase();
    const vmCards = document.querySelectorAll('.vm-card');

    vmCards.forEach(card => {
        const vmName = card.getAttribute('data-vm-name').toLowerCase();
        const serverHost = card.getAttribute('data-server-host').toLowerCase();
        if (vmName.includes(searchTerm) || serverHost.includes(searchTerm)) {
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
    if (countBadge) countBadge.textContent = selectedVMs.size;

    const selectedList = getSelectedVMList();
    const vmItems = selectedList.map(vm => {
        return `
            <div class="favorite-item">
                <div class="favorite-info">
                    <span class="favorite-name">${escapeHtml(vm.name)}</span>
                    <span class="favorite-meta">${vm.server || vm.server_host}</span>
                </div>
            </div>
        `;
    }).join('');

    previewList.innerHTML = vmItems;
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

    setBatchButtonsDisabled(true);
    setVmsButtonsDisabled(true);
    vmList.forEach(vm => setVMButtonsDisabled(vm.name, vm.server_host, true));
    showBatchProgress(vmList.length);
    showVmsProgress(vmList.length);
    startExecutionTimer(startTime);

    startProgressCountdown(() => {
        updateBatchProgress(currentProcessedVMs);
        updateVmsProgress(currentProcessedVMs);
    });

    const result = await apiRequest('/batch-vm-action', {
        method: 'POST',
        body: JSON.stringify({
            vms: vmList.map(vm => ({ name: vm.name, server_host: vm.server_host, action: 'suspend' })),
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

    setBatchButtonsDisabled(true);
    setVmsButtonsDisabled(true);
    vmList.forEach(vm => setVMButtonsDisabled(vm.name, vm.server_host, true));
    showBatchProgress(vmList.length);
    showVmsProgress(vmList.length);
    startExecutionTimer(startTime);

    startProgressCountdown(() => {
        updateBatchProgress(currentProcessedVMs);
        updateVmsProgress(currentProcessedVMs);
    });

    const result = await apiRequest('/batch-vm-action', {
        method: 'POST',
        body: JSON.stringify({
            vms: vmList.map(vm => ({ name: vm.name, server_host: vm.server_host, action: 'start' })),
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
    const batchBadge = document.getElementById('execution-badge');
    const batchTime = document.getElementById('execution-time');

    if (batchBadge) batchBadge.style.display = 'inline-flex';

    if (executionTimer) clearInterval(executionTimer);
    executionTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const timeStr = elapsed < 60 ? `${elapsed}秒` : `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;
        if (batchTime) batchTime.textContent = timeStr;
    }, 1000);
}

function stopExecutionTimer(target = 'batch') {
    if (executionTimer) {
        clearInterval(executionTimer);
        executionTimer = null;
    }

    const batchBadge = document.getElementById('execution-badge');
    if (batchBadge) {
        setTimeout(() => {
            batchBadge.style.display = 'none';
        }, 2000);
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
    if (progressText) progressText.textContent = `正在处理...`;
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
    if (progressText) progressText.textContent = `正在处理 (${currentProcessedVMs}/${currentTotalVMs})...`;
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
    if (progressText) progressText.textContent = `正在处理...`;
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
    if (progressText) progressText.textContent = `正在处理 (${currentProcessedVMs}/${currentTotalVMs})...`;
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

    const result = await apiRequest('/vm/suspend', {
        method: 'POST',
        body: JSON.stringify({ name: vmName, server_host: serverHost })
    });

    isProcessing = false;
    setVmsButtonsDisabled(false);
    setVMButtonsDisabled(vmName, serverHost, false);

    if (result.success) {
        showToast(`虚拟机 ${vmName} 挂起成功`, 'success');
        await refreshStatus();
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

    const result = await apiRequest('/vm/start', {
        method: 'POST',
        body: JSON.stringify({ name: vmName, server_host: serverHost })
    });

    isProcessing = false;
    setVmsButtonsDisabled(false);
    setVMButtonsDisabled(vmName, serverHost, false);

    if (result.success) {
        showToast(`虚拟机 ${vmName} 启动成功`, 'success');
        await refreshStatus();
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
        quickDiv.innerHTML = `
            <div class="empty-state">
                <span class="icon">📌</span>
                <p class="text-muted">暂无收藏</p>
            </div>`;
        return;
    }

    const favCards = favorites.map((fav, index) => {
        const isActive = index === currentFavoriteIndex;
        return `
        <div class="favorite-item ${isActive ? 'active' : ''}" data-index="${index}" onclick="loadFavoriteToSelection(${index})">
            <div class="favorite-info">
                <span class="favorite-name">${escapeHtml(fav.name)}</span>
                <span class="favorite-meta">${fav.vms.length}台</span>
            </div>
            <button class="btn btn-danger btn-sm favorite-delete" onclick="event.stopPropagation(); deleteFavorite(${index})">🗑️</button>
        </div>
    `}).join('');

    quickDiv.innerHTML = favCards;
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
            document.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('active'));
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
        document.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('active'));
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
    namesDiv.innerHTML = selectedList.map(v => `<span class="task-vm-chip">${escapeHtml(v.name)}</span>`).join('');

    modal.classList.add('show');
    nameInput.focus();
}

function closeSaveFavoriteModal() {
    const modal = document.getElementById('save-favorite-modal');
    if (modal) modal.classList.remove('show');
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
    try {
        const result = await apiRequest('/servers');
        if (result.success) {
            servers = result.servers || [];
            renderCredentialsList();
        }
    } catch (e) {
        console.error('加载服务器配置失败:', e);
    }
}

function renderCredentialsList() {
    const listDiv = document.getElementById('credentials-list');
    if (!listDiv) return;

    if (servers.length === 0) {
        listDiv.innerHTML = `
            <div class="empty-state">
                <span class="icon">🖥️</span>
                <p class="text-muted">暂无配置</p>
            </div>`;
        return;
    }

    const serverCards = servers.map((server, index) => `
        <div class="credential-card">
            <div class="credential-info">
                <span class="credential-name">${escapeHtml(server.name) || server.host}</span>
                <span class="credential-host">${server.host}</span>
            </div>
            <button class="btn btn-danger btn-sm" onclick="deleteServer(${index})">🗑️ 删除</button>
        </div>
    `).join('');

    listDiv.innerHTML = serverCards;
}

function openAddCredentialModal() {
    const modal = document.getElementById('add-credential-modal');
    if (!modal) return;

    document.getElementById('server-name').value = '';
    document.getElementById('server-host').value = '';
    document.getElementById('server-username').value = '';
    document.getElementById('server-password').value = '';

    modal.classList.add('show');
}

function closeAddCredentialModal() {
    const modal = document.getElementById('add-credential-modal');
    if (modal) modal.classList.remove('show');
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

    const checkResult = await apiRequest('/servers/check', {
        method: 'POST',
        body: JSON.stringify({ server: newServer })
    });

    if (!checkResult.success) {
        showToast('连接失败: ' + checkResult.error, 'error');
        return;
    }

    servers.push(newServer);
    const result = await apiRequest('/servers', {
        method: 'POST',
        body: JSON.stringify({ servers })
    });

    if (result.success) {
        showToast('服务器已添加', 'success');
        closeAddCredentialModal();
        renderCredentialsList();
        await refreshStatus();
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
        await refreshStatus();
    } else {
        showToast('删除失败', 'error');
    }
}

async function refreshLogs() {
    try {
        const result = await apiRequest('/logs');
        const logContent = document.getElementById('log-content');

        if (result && result.success && logContent) {
            logContent.textContent = result.logs || '暂无日志';
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
        if (btn) btn.innerHTML = '<span>▶</span> 自动刷新';
    } else {
        startLogAutoRefresh();
        if (btn) btn.innerHTML = '<span>⏸</span> 停止刷新';
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
    vmSelector.innerHTML = vmData.map(vm => `
        <span class="task-vm-chip" data-vm="${vm.name}|${vm.server_host}" onclick="toggleTaskVM(this)">${escapeHtml(vm.name)}</span>
    `).join('');
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

document.querySelectorAll('.day-chip input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', function() {
        const label = this.parentElement;
        if (this.checked) {
            label.classList.add('selected');
        } else {
            label.classList.remove('selected');
        }
    });
});

async function createTask() {
    const name = document.getElementById('new-task-name').value.trim();
    if (!name) { showToast('请输入任务名称', 'error'); return; }
    if (selectedTaskVMs.size === 0) { showToast('请选择至少一台虚拟机', 'error'); return; }

    const action = document.getElementById('new-task-action').value;
    const timeParts = document.getElementById('new-task-time').value.split(':');
    const selectedDays = Array.from(document.querySelectorAll('input[name="new-task-days"]:checked')).map(cb => cb.value);
    if (selectedDays.length === 0) { showToast('请选择至少一个执行日期', 'error'); return; }

    const task = {
        id: Math.random().toString(36).substring(2, 10),
        name: name,
        trigger_type: 'cron',
        action: action,
        cron: { hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), day_of_week: selectedDays.join(',') },
        target_vms: Array.from(selectedTaskVMs).map(key => {
            const [n, server_host] = key.split('|');
            return { name: n, server_host };
        }),
        enabled: true,
        notify_enabled: document.getElementById('new-task-notify').checked
    };

    if (task.notify_enabled) {
        const webhookUrl = document.getElementById('new-task-wechat-url').value.trim();
        if (webhookUrl) task.wechat = { enabled: true, webhook_url: webhookUrl };
    }

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
    document.getElementById('new-task-notify').checked = false;
    document.getElementById('new-task-wechat-url').value = '';
    document.getElementById('new-task-wechat-config').style.display = 'none';
    document.querySelectorAll('input[name="new-task-days"]').forEach((cb, i) => cb.checked = i < 5);
    document.querySelectorAll('.day-chip').forEach((label, i) => {
        if (i < 5) label.classList.add('selected');
        else label.classList.remove('selected');
    });
    selectedTaskVMs.clear();
    document.querySelectorAll('.task-vm-chip').forEach(el => el.classList.remove('selected'));
    document.getElementById('new-task-submit-btn').innerHTML = '<span>✓</span> 创建任务';
    document.getElementById('new-task-submit-btn').onclick = createTask;
    const cancelBtn = document.getElementById('new-task-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

let editingTaskId = null;

async function openEditTaskModal(taskId) {
    try {
        const result = await apiRequest('/scheduler/tasks');
        console.log('Edit task result:', result);
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
        document.getElementById('new-task-notify').checked = task.notify_enabled || false;
        if (task.wechat?.webhook_url) {
            document.getElementById('new-task-wechat-url').value = task.wechat.webhook_url;
            document.getElementById('new-task-wechat-config').style.display = 'block';
        }

        const days = (task.cron?.day_of_week || '').split(',').filter(d => d);
        document.querySelectorAll('input[name="new-task-days"]').forEach(cb => {
            cb.checked = days.includes(cb.value);
        });
        document.querySelectorAll('.day-chip').forEach(label => {
            const input = label.querySelector('input');
            if (input) {
                if (days.includes(input.value)) {
                    label.classList.add('selected');
                } else {
                    label.classList.remove('selected');
                }
            }
        });

        selectedTaskVMs.clear();
        document.querySelectorAll('.task-vm-chip').forEach(el => el.classList.remove('selected'));
        if (task.target_vms && Array.isArray(task.target_vms)) {
            task.target_vms.forEach(vm => {
                const key = `${vm.name}|${vm.server_host}`;
                selectedTaskVMs.add(key);
                const el = document.querySelector(`.task-vm-chip[data-vm="${vm.name}|${vm.server_host}"]`);
                if (el) el.classList.add('selected');
            });
        }

        document.getElementById('new-task-submit-btn').innerHTML = '<span>✓</span> 保存修改';
        document.getElementById('new-task-submit-btn').onclick = updateTask;
        const cancelBtn = document.getElementById('new-task-cancel-btn');
        if (cancelBtn) {
            cancelBtn.style.display = 'inline-flex';
            cancelBtn.onclick = cancelEditTask;
        }
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
    if (selectedDays.length === 0) { showToast('请选择至少一个执行日期', 'error'); return; }

    const task = {
        id: editingTaskId,
        name: name,
        trigger_type: 'cron',
        action: action,
        cron: { hour: parseInt(timeParts[0]), minute: parseInt(timeParts[1]), day_of_week: selectedDays.join(',') },
        target_vms: Array.from(selectedTaskVMs).map(key => {
            const [n, server_host] = key.split('|');
            return { name: n, server_host };
        }),
        enabled: true,
        notify_enabled: document.getElementById('new-task-notify').checked
    };

    if (task.notify_enabled) {
        const webhookUrl = document.getElementById('new-task-wechat-url').value.trim();
        if (webhookUrl) task.wechat = { enabled: true, webhook_url: webhookUrl };
    }

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

                return `
                    <div class="task-item ${task.enabled ? '' : 'disabled'}">
                        <div class="task-info">
                            <div class="task-name">
                                <span>${actionIcons[task.action] || '▶'}</span>
                                <span>${escapeHtml(task.name)}</span>
                                ${task.notify_enabled ? '<span>🔔</span>' : ''}
                            </div>
                            <div class="task-meta">
                                <span>⏰ ${time}</span>
                                <span>${dayStr}</span>
                                <span>${vmNames}</span>
                            </div>
                        </div>
                        <div class="task-controls">
                            <button class="btn btn-secondary btn-sm" onclick="openEditTaskModal('${task.id}')">✏️</button>
                            ${task.enabled
                                ? `<button class="btn btn-secondary btn-sm" onclick="toggleTask('${task.id}', false)">⏸</button>`
                                : `<button class="btn btn-success btn-sm" onclick="toggleTask('${task.id}', true)">▶</button>`
                            }
                            <button class="btn btn-primary btn-sm" onclick="runTaskNow('${task.id}')">▶▶</button>
                            <button class="btn btn-danger btn-sm" onclick="removeTask('${task.id}')">🗑️</button>
                        </div>
                    </div>`;
            }).join('');
        } else {
            tasksList.innerHTML = `
                <div class="empty-state">
                    <span class="icon">⏰</span>
                    <p class="text-muted">暂无定时任务</p>
                </div>`;
        }
    } catch (e) {
        console.error('加载任务失败:', e);
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
            showToast(`完成: 成功${r.success} 失败${r.failed}`, r.failed > 0 ? 'warning' : 'success');
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

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('active'));

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

    document.getElementById('new-task-notify')?.addEventListener('change', function() {
        document.getElementById('new-task-wechat-config').style.display = this.checked ? 'block' : 'none';
    });

    await loadSettings();
    await refreshStatus();
});