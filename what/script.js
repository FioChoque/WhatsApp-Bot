// Variables globales
let selected = new Set();
let autoFiles = [];
let currentStatus = 'disconnected';
let historyData = [];
let currentContacts = [];
let currentBatch = 1;
const BATCH_SIZE = 50;

// Iconos para estados
const statusIcons = {
    'connected': 'fas fa-check-circle',
    'qr-required': 'fas fa-qrcode',
    'disconnected': 'fas fa-times-circle',
    'error': 'fas fa-exclamation-triangle'
};

function updateConfigurationView() {
    const estadoFilter = document.getElementById('estadoFilter').value;
    const weekSection = document.getElementById('weekSection');
    const adherenteMessage = document.getElementById('adherenteMessage');
    const messageBox = document.getElementById('messageBox');
    
    if (estadoFilter === 'adherente') {
        weekSection.classList.add('hidden');
        weekSection.style.display = 'none';
        adherenteMessage.style.display = 'block';
        
        document.getElementById('weekSelect').value = '';
        document.getElementById('autoFilesBox').style.display = 'none';
        autoFiles = [];
        
        messageBox.placeholder = 'Escribe tu mensaje personalizado para adherentes...\nPuedes usar variables como {nombre}';
        document.getElementById('messageBox').value = '';
        
    } else {
        weekSection.classList.remove('hidden');
        weekSection.style.display = 'block';
        adherenteMessage.style.display = 'none';
        
        messageBox.placeholder = 'Escribe tu mensaje aquí... \nTambién puedes usar variables como {nombre}, {semana}, etc.';
    }
}

function updateStatusIndicator() {
    const indicator = document.getElementById('statusIndicator');
    indicator.className = 'status-indicator ' + currentStatus;
    
    const statusMap = {
        'connected': { title: 'Conectado', desc: 'WhatsApp está listo para enviar mensajes' },
        'qr-required': { title: 'QR Requerido', desc: 'Escanee el código QR con WhatsApp' },
        'disconnected': { title: 'Desconectado', desc: 'Conectándose a WhatsApp...' },
        'error': { title: 'Error', desc: 'Error de conexión con WhatsApp' }
    };
    
    const status = statusMap[currentStatus];
    document.getElementById('statusTitle').innerHTML = 
        `<i class="${statusIcons[currentStatus]}"></i> ${status.title}`;
    document.getElementById('statusDescription').textContent = status.desc;
}

async function loadStatus() {
    try {
        const r = await fetch('/status');
        const d = await r.json();
        document.getElementById('statusText').textContent = d.status;
        
        if (d.qr) {
            currentStatus = 'qr-required';
            document.getElementById('qr').style.display = 'block';
            document.getElementById('qr').src = d.qr;
            document.getElementById('sendButton').disabled = true;
        } else if (d.status === 'Conectado') {
            currentStatus = 'connected';
            document.getElementById('qr').style.display = 'none';
            updateSendButton();
        } else {
            currentStatus = 'disconnected';
            document.getElementById('qr').style.display = 'none';
            document.getElementById('sendButton').disabled = true;
        }
        
        updateStatusIndicator();
    } catch (error) {
        currentStatus = 'error';
        updateStatusIndicator();
        showNotification('Error al cargar estado', 'error');
    }
}

async function loadContacts() {
    try {
        const estado = document.getElementById('estadoFilter').value;
        const cita = document.getElementById('citaFilter').value;
        const r = await fetch('/contacts?estado=' + estado + '&cita=' + cita);
        const data = await r.json();
        const list = document.getElementById('contactList');
        
        currentContacts = data;
        
        if (data.length === 0) {
            list.innerHTML = '<div class="loading">No se encontraron contactos</div>';
            updateBatchInfo();
            return;
        }
        
        list.innerHTML = '';
        
        data.forEach((c, index) => {
            const item = document.createElement('div');
            item.className = 'contact-item';
            item.dataset.index = index + 1;
            
            let estadoIcon = '📊';
            if (c.estado === 'adherente') estadoIcon = '✅';
            if (c.estado === 'no adherente') estadoIcon = '❌';
            
            let citaInfo = '';
            if (c.fecha_cita && c.horas_restantes !== null) {
                const fechaCita = new Date(c.fecha_cita).toLocaleString();
                let citaColor = '#666';
                let citaIcon = 'fas fa-clock';
                
                if (c.horas_restantes <= 3) {
                    citaColor = '#dc3545';
                    citaIcon = 'fas fa-exclamation-triangle';
                } else if (c.horas_restantes <= 24) {
                    citaColor = '#ff9800';
                    citaIcon = 'fas fa-hourglass-half';
                } else {
                    citaColor = '#28a745';
                    citaIcon = 'fas fa-calendar-check';
                }
                
                citaInfo = `<br><small style="color: ${citaColor}; font-size: 0.85em;">
                    <i class="${citaIcon}"></i> Cita: ${fechaCita} (${c.horas_restantes}h restantes)
                </small>`;
            }
            
            item.innerHTML = `
                <span class="contact-index">${index + 1}</span>
                <input type="checkbox" class="contact-checkbox" id="contact_${c.number}">
                <div class="contact-info">
                    <h4>${c.name}</h4>
                    <p><i class="fas fa-phone"></i> ${c.number} • ${estadoIcon} ${c.estado}${citaInfo}</p>
                </div>
            `;
            
            const chk = item.querySelector('input');
            chk.checked = selected.has(c.number);
            if (chk.checked) item.classList.add('selected');
            
            chk.onchange = () => toggleContact(c.number, chk.checked, item);
            
            list.appendChild(item);
        });
        
        updateSelectedCount();
        updateConfigurationView();
        highlightCurrentBatch();
        updateBatchInfo();
        
    } catch (error) {
        document.getElementById('contactList').innerHTML = 
            '<div class="loading error">Error al cargar contactos</div>';
    }
}

function highlightCurrentBatch() {
    const start = (currentBatch - 1) * BATCH_SIZE + 1;
    const end = Math.min(currentBatch * BATCH_SIZE, currentContacts.length);
    
    document.querySelectorAll('.contact-item').forEach(item => {
        const index = parseInt(item.dataset.index);
        if (index >= start && index <= end) {
            item.classList.add('in-current-batch');
        } else {
            item.classList.remove('in-current-batch');
        }
    });
}

function updateBatchInfo() {
    const start = (currentBatch - 1) * BATCH_SIZE + 1;
    const end = Math.min(currentBatch * BATCH_SIZE, currentContacts.length);
    const totalBatches = Math.ceil(currentContacts.length / BATCH_SIZE);
    
    document.getElementById('currentBatchDisplay').textContent = 
        `Lote ${currentBatch} de ${totalBatches}`;
    document.getElementById('batchRangeDisplay').textContent = 
        `${start} - ${end}`;
    
    const progress = (currentBatch / totalBatches) * 100;
    document.getElementById('batchProgressBar').style.width = `${progress}%`;
    
    document.getElementById('prevBatchBtn').disabled = currentBatch === 1;
    document.getElementById('nextBatchBtn').disabled = currentBatch === totalBatches;
}

function selectCurrentBatch() {
    const start = (currentBatch - 1) * BATCH_SIZE + 1;
    const end = Math.min(currentBatch * BATCH_SIZE, currentContacts.length);
    
    currentContacts.forEach((contact, index) => {
        const position = index + 1;
        if (position >= start && position <= end) {
            selected.add(contact.number);
            const checkbox = document.getElementById(`contact_${contact.number}`);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.closest('.contact-item').classList.add('selected');
            }
        }
    });
    
    updateSelectedCount();
    updateSendButton();
    showNotification(`Seleccionados contactos del ${start} al ${end}`, 'success');
}

function deselectCurrentBatch() {
    const start = (currentBatch - 1) * BATCH_SIZE + 1;
    const end = Math.min(currentBatch * BATCH_SIZE, currentContacts.length);
    
    currentContacts.forEach((contact, index) => {
        const position = index + 1;
        if (position >= start && position <= end) {
            selected.delete(contact.number);
            const checkbox = document.getElementById(`contact_${contact.number}`);
            if (checkbox) {
                checkbox.checked = false;
                checkbox.closest('.contact-item').classList.remove('selected');
            }
        }
    });
    
    updateSelectedCount();
    updateSendButton();
    showNotification(`Deseleccionados contactos del ${start} al ${end}`, 'info');
}

function nextBatch() {
    const totalBatches = Math.ceil(currentContacts.length / BATCH_SIZE);
    if (currentBatch < totalBatches) {
        currentBatch++;
        highlightCurrentBatch();
        updateBatchInfo();
        showNotification(`Mostrando lote ${currentBatch}`, 'info');
    }
}

function previousBatch() {
    if (currentBatch > 1) {
        currentBatch--;
        highlightCurrentBatch();
        updateBatchInfo();
        showNotification(`Mostrando lote ${currentBatch}`, 'info');
    }
}

function toggleContact(number, isChecked, element) {
    if (isChecked) {
        selected.add(number);
        element.classList.add('selected');
    } else {
        selected.delete(number);
        element.classList.remove('selected');
    }
    updateSelectedCount();
    updateSendButton();
}

function selectAll() {
    const checkboxes = document.querySelectorAll('.contact-checkbox');
    checkboxes.forEach(chk => {
        chk.checked = true;
        const number = chk.id.replace('contact_', '');
        selected.add(number);
        chk.closest('.contact-item').classList.add('selected');
    });
    updateSelectedCount();
    updateSendButton();
}

function deselectAll() {
    selected.clear();
    document.querySelectorAll('.contact-checkbox').forEach(chk => {
        chk.checked = false;
        chk.closest('.contact-item').classList.remove('selected');
    });
    updateSelectedCount();
    updateSendButton();
}

function updateSelectedCount() {
    const count = selected.size;
    const countElement = document.getElementById('selectedCount');
    const badgeElement = document.getElementById('selectedBadge');
    
    if (count === 0) {
        countElement.textContent = 'No hay contactos seleccionados';
        badgeElement.textContent = '0';
    } else {
        countElement.textContent = `${count} contacto${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}`;
        badgeElement.textContent = count;
    }
}

function updateSendButton() {
    const sendButton = document.getElementById('sendButton');
    sendButton.disabled = selected.size === 0 || currentStatus !== 'connected';
}

document.getElementById('weekSelect').addEventListener('change', async e => {
    const week = e.target.value;
    if (!week) {
        document.getElementById('autoFilesBox').style.display = 'none';
        document.getElementById('messageBox').value = '';
        return;
    }
    
    try {
        showNotification('Cargando configuración de la semana...', 'info');
        
        const msgRes = await fetch('/mensaje-semana/' + week);
        const msgData = await msgRes.json();
        document.getElementById('messageBox').value = msgData.mensaje || '';
        
        const filesRes = await fetch('/archivos-semana/' + week);
        const filesData = await filesRes.json();
        autoFiles = filesData;
        
        if (filesData.length > 0) {
            const filesList = filesData.map(f => {
                let icon = 'fas fa-file';
                if (f.tipo === 'pdf') icon = 'fas fa-file-pdf';
                if (f.tipo === 'image') icon = 'fas fa-file-image';
                if (f.tipo === 'document') icon = 'fas fa-file-word';
                return `<div class="file-list-item">
                    <div class="file-icon"><i class="${icon}"></i></div>
                    <span>${f.nombre_original}</span>
                </div>`;
            }).join('');
            document.getElementById('autoFilesList').innerHTML = filesList;
            document.getElementById('autoFilesBox').style.display = 'block';
        } else {
            document.getElementById('autoFilesBox').style.display = 'none';
        }
        
        showNotification(`Configuración de la semana ${week} cargada`, 'success');
    } catch (error) {
        showNotification('Error al cargar configuración', 'error');
    }
});

document.getElementById('sendButton').addEventListener('click', function() {
    if (selected.size === 0) {
        showNotification('Selecciona al menos un contacto', 'warning');
        return;
    }
    
    document.getElementById('confirmMessage').textContent = 
        `¿Estás seguro de que deseas enviar el mensaje a ${selected.size} contacto(s) seleccionado(s)?`;
    document.getElementById('confirmModal').style.display = 'flex';
});

function closeModal() {
    document.getElementById('confirmModal').style.display = 'none';
}

async function confirmSend() {
    closeModal();
    
    try {
        const formData = new FormData();
        formData.append('message', document.getElementById('messageBox').value);
        formData.append('selectedContacts', JSON.stringify([...selected]));
        formData.append('autoFiles', JSON.stringify(autoFiles));
        
        updateCurrentStatus('Preparando envío...', 'info');
        
        const response = await fetch('/send', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showNotification(`Envío iniciado: ${selected.size} contacto(s)`, 'success');
            updateCurrentStatus(`Envío completado: ${result.stats.completados} exitosos, ${result.stats.fallidos} fallidos`, 'success');
        } else {
            showNotification('Error: ' + result, 'error');
            updateCurrentStatus('Error al iniciar envío', 'error');
        }
        
    } catch (error) {
        showNotification('Error al enviar: ' + error.message, 'error');
        updateCurrentStatus('Error de conexión', 'error');
    }
}

function clearHistory() {
    document.getElementById('clearHistoryModal').style.display = 'flex';
}

function closeClearHistoryModal() {
    document.getElementById('clearHistoryModal').style.display = 'none';
}

async function confirmClearHistory() {
    try {
        const response = await fetch('/clear-history', { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            historyData = data.history || [];
            renderHistory();
            closeClearHistoryModal();
            showNotification('Historial limpiado', 'success');
            updateCurrentStatus('Listo para nuevos envíos', 'info');
        }
    } catch (error) {
        console.error('Error al limpiar historial:', error);
        showNotification('Error al limpiar historial', 'error');
    }
}

function updateCurrentStatus(message, type = 'info') {
    const statusElement = document.getElementById('currentStatus');
    statusElement.textContent = message;
    statusElement.className = 'status-content';
    
    if (type === 'success') {
        statusElement.classList.add('active');
        statusElement.style.background = '#e8f5e9';
        statusElement.style.color = '#2e7d32';
    } else if (type === 'error') {
        statusElement.style.background = '#f8d7da';
        statusElement.style.color = '#721c24';
    } else if (type === 'info') {
        statusElement.style.background = '#d1ecf1';
        statusElement.style.color = '#0c5460';
    }
}

function renderHistory() {
    const historyElement = document.getElementById('history');
    
    if (!historyData || historyData.length === 0) {
        historyElement.innerHTML = `
            <div class="history-empty">
                <i class="fas fa-inbox fa-2x" style="color: #dee2e6; margin-bottom: 10px;"></i><br>
                No hay envíos recientes
            </div>
        `;
        return;
    }
    
    const validHistory = historyData.filter(item => 
        item && typeof item === 'object' && item.id
    );
    
    if (validHistory.length === 0) {
        historyElement.innerHTML = `
            <div class="history-empty">
                <i class="fas fa-inbox fa-2x" style="color: #dee2e6; margin-bottom: 10px;"></i><br>
                No hay envíos recientes
            </div>
        `;
        return;
    }
    
    const sortedHistory = [...validHistory].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    historyElement.innerHTML = sortedHistory.map(item => {
        let statusClass = 'info';
        let statusIcon = 'fas fa-info-circle';
        let statusText = 'Información';
        
        if (item.type === 'send_success' || item.type === 'file_sent' || item.type === 'manual_file_sent') {
            statusClass = 'success';
            statusIcon = 'fas fa-check-circle';
            statusText = 'Enviado';
        } else if (item.type === 'send_error' || item.type === 'file_error' || item.type === 'manual_file_error' || item.type === 'contact_error') {
            statusClass = 'error';
            statusIcon = 'fas fa-times-circle';
            statusText = 'Error';
        } else if (item.type === 'system' || item.action === 'CLEAR_HISTORY') {
            statusClass = 'info';
            statusIcon = 'fas fa-cog';
            statusText = 'Sistema';
        } else if (item.type === 'batch_pause') {
            statusClass = 'warning';
            statusIcon = 'fas fa-pause-circle';
            statusText = 'Pausa';
        } else if (item.type === 'connection') {
            statusClass = 'info';
            statusIcon = 'fas fa-plug';
            statusText = 'Conexión';
        } else if (item.type === 'send_start') {
            statusClass = 'info';
            statusIcon = 'fas fa-play';
            statusText = 'Inicio';
        } else if (item.type === 'send_complete') {
            statusClass = 'success';
            statusIcon = 'fas fa-flag-checkered';
            statusText = 'Completado';
        }
        
        let time = '';
        let date = '';
        try {
            const dateObj = new Date(item.timestamp);
            time = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            date = dateObj.toLocaleDateString();
        } catch (e) {
            time = '--:--:--';
            date = '--/--/----';
        }
        
        let contactDisplay = 'Sistema';
        let fileDisplay = '';
        let messageDisplay = item.message || '';
        
        if (item.contact) {
            contactDisplay = item.name ? `${item.name} (${item.contact})` : item.contact;
        }
        
        if (item.file) {
            fileDisplay = item.file;
        } else if (item.method === 'text') {
            fileDisplay = 'Mensaje de texto';
        }
        
        if (item.error) {
            messageDisplay = `Error: ${item.error}`;
        }
        
        if (item.type === 'send_start') {
            messageDisplay = `Enviando a ${item.totalContacts} contactos en ${item.totalBatches} lotes`;
        }
        
        if (item.type === 'send_complete') {
            messageDisplay = `${item.completed} exitosos, ${item.failed} fallidos en ${item.totalTime} segundos`;
        }
        
        if (item.action === 'CLEAR_HISTORY') {
            messageDisplay = 'Historial limpiado manualmente';
        }
        
        return `
            <div class="history-item ${statusClass}">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <strong><i class="${statusIcon}"></i> ${statusText}</strong>
                        <div style="margin-top: 5px;">
                            <span style="font-weight: 500;">${contactDisplay}</span>
                            ${fileDisplay ? `<br><small style="color: #666;">📎 ${fileDisplay}</small>` : ''}
                            ${messageDisplay ? `<br><small style="color: #666; font-style: italic;">${messageDisplay}</small>` : ''}
                        </div>
                    </div>
                    <div style="text-align: right; min-width: 100px;">
                        <small style="color: #666; display: block;">${time}</small>
                        <small style="color: #999; font-size: 0.85em;">${date}</small>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadSendStatus() {
    try {
        const r = await fetch('/send-status');
        const d = await r.json();
        
        if (d.current) {
            if (d.current.currentContact && d.current.currentContact.number) {
                updateCurrentStatus(`${d.current.detailedStatus}`, 'info');
            }
        }
        
        if (d.history && Array.isArray(d.history)) {
            historyData = d.history.filter(item => 
                item && typeof item === 'object' && item.id
            );
            renderHistory();
        } else {
            historyData = [];
            renderHistory();
        }
        
        if (!d.current?.currentContact?.number && historyData.length === 0) {
            updateCurrentStatus('Listo para enviar mensajes', 'info');
        }
        
    } catch (error) {
        console.error('Error al cargar estado:', error);
    }
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            notification.style.display = 'none';
            notification.style.animation = 'slideIn 0.3s ease';
        }, 300);
    }, 5000);
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('estadoFilter').addEventListener('change', () => {
        loadContacts();
        updateConfigurationView();
        currentBatch = 1;
    });

    document.getElementById('citaFilter').addEventListener('change', () => {
        loadContacts();
        currentBatch = 1;
    });

    document.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
    });

    loadStatus();
    loadContacts();
    updateStatusIndicator();
    updateConfigurationView();
    loadSendStatus();

    setInterval(loadStatus, 3000);
    setInterval(loadSendStatus, 2000);

    updateSendButton();
});

window.selectAll = selectAll;
window.deselectAll = deselectAll;
window.closeModal = closeModal;
window.confirmSend = confirmSend;
window.clearHistory = clearHistory;
window.closeClearHistoryModal = closeClearHistoryModal;
window.confirmClearHistory = confirmClearHistory;
window.selectCurrentBatch = selectCurrentBatch;
window.deselectCurrentBatch = deselectCurrentBatch;
window.nextBatch = nextBatch;
window.previousBatch = previousBatch;