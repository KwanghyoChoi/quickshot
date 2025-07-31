const { ipcRenderer } = require('electron');

let currentPreviewData = null;
let clipboardHistory = [];
let selectedItems = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  loadClipboardHistory();
  setupKeyboardShortcuts();
});

function initializeEventListeners() {
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      startCapture(mode);
    });
  });

  document.getElementById('saveBtn').addEventListener('click', saveImage);
  document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
  document.getElementById('selectAllBtn').addEventListener('click', selectAllItems);
  document.getElementById('saveSelectedBtn').addEventListener('click', saveSelectedItems);

  document.getElementById('setFixedAreaBtn').addEventListener('click', async () => {
    document.getElementById('fixedAreaDialog').style.display = 'none';
    // 새 영역 설정
    await ipcRenderer.invoke('set-fixed-area', null);
    await ipcRenderer.invoke('start-capture', 'fixed');
  });

  // 현재 영역 캡처 버튼 추가
  const captureCurrentBtn = document.createElement('button');
  captureCurrentBtn.id = 'captureCurrentFixedBtn';
  captureCurrentBtn.textContent = '현재 영역 캡처';
  captureCurrentBtn.style.display = 'none';
  document.querySelector('.dialog-content').insertBefore(captureCurrentBtn, document.getElementById('setFixedAreaBtn'));
  
  captureCurrentBtn.addEventListener('click', async () => {
    document.getElementById('fixedAreaDialog').style.display = 'none';
    const fixedArea = await ipcRenderer.invoke('get-fixed-area');
    if (fixedArea) {
      // 메인 창 최소화 (메인 프로세스에서 처리)
      await ipcRenderer.invoke('minimize-main-window');
      
      // 잠시 대기 후 캡처
      setTimeout(async () => {
        await ipcRenderer.invoke('capture-screen', fixedArea, false);
      }, 200);
    }
  });

  document.getElementById('clearFixedAreaBtn').addEventListener('click', async () => {
    await ipcRenderer.invoke('set-fixed-area', null);
    updateFixedAreaInfo();
  });

  document.getElementById('closeDialogBtn').addEventListener('click', () => {
    document.getElementById('fixedAreaDialog').style.display = 'none';
  });

  const fixedBtn = document.querySelector('[data-mode="fixed"]');
  fixedBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showFixedAreaDialog();
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      startCapture('rectangle');
    } else if (e.key === 'F2') {
      startCapture('fixed');
    } else if (e.key === 'F3') {
      startCapture('window');
    } else if (e.key === 'F4') {
      startCapture('fullscreen');
    }
  });
}

async function startCapture(mode) {
  if (mode === 'fixed') {
    const fixedArea = await ipcRenderer.invoke('get-fixed-area');
    if (fixedArea) {
      // 이미 고정 영역이 있으면 선택 다이얼로그 표시
      showFixedAreaDialog();
      return;
    }
  }
  
  await ipcRenderer.invoke('start-capture', mode);
}

async function loadClipboardHistory() {
  clipboardHistory = await ipcRenderer.invoke('get-clipboard-history');
  selectedItems.clear();
  renderClipboardHistory();
  updateSelectedButton();
}

function renderClipboardHistory() {
  const container = document.getElementById('clipboardHistory');
  
  if (clipboardHistory.length === 0) {
    container.innerHTML = '<div class="history-placeholder">캡처 기록이 없습니다</div>';
    return;
  }

  container.innerHTML = '';
  
  clipboardHistory.forEach((item, index) => {
    const historyItem = createHistoryItem(item, index);
    container.appendChild(historyItem);
  });
}

function createHistoryItem(item, index) {
  const div = document.createElement('div');
  div.className = 'history-item';
  div.dataset.index = index;
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'history-item-checkbox';
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    if (e.target.checked) {
      selectedItems.add(index);
      div.classList.add('selected');
    } else {
      selectedItems.delete(index);
      div.classList.remove('selected');
    }
    updateSelectedButton();
  });
  
  const img = document.createElement('img');
  img.src = item.dataUrl;
  img.alt = 'Captured image';
  
  const timestamp = document.createElement('div');
  timestamp.className = 'history-timestamp';
  timestamp.textContent = new Date(item.timestamp).toLocaleString('ko-KR');
  
  const actions = document.createElement('div');
  actions.className = 'history-item-actions';
  
  const useBtn = document.createElement('button');
  useBtn.className = 'history-item-btn';
  useBtn.textContent = '사용';
  useBtn.onclick = (e) => {
    e.stopPropagation();
    useHistoryItem(item);
  };
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'history-item-btn';
  deleteBtn.textContent = '삭제';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    deleteHistoryItem(index);
  };
  
  actions.appendChild(useBtn);
  actions.appendChild(deleteBtn);
  
  div.appendChild(checkbox);
  div.appendChild(img);
  div.appendChild(timestamp);
  div.appendChild(actions);
  
  div.addEventListener('click', () => {
    showPreview(item.dataUrl);
  });
  
  return div;
}

function useHistoryItem(item) {
  showPreview(item.dataUrl);
  copyToClipboard();
}

async function deleteHistoryItem(index) {
  clipboardHistory = await ipcRenderer.invoke('delete-clipboard-item', index);
  selectedItems.clear();
  renderClipboardHistory();
  updateSelectedButton();
}

async function clearHistory() {
  if (confirm('모든 캡처 기록을 삭제하시겠습니까?')) {
    await ipcRenderer.invoke('clear-clipboard-history');
    clipboardHistory = [];
    selectedItems.clear();
    renderClipboardHistory();
    clearPreview();
    updateSelectedButton();
  }
}

function showPreview(dataUrl) {
  currentPreviewData = dataUrl;
  const previewImage = document.getElementById('previewImage');
  previewImage.src = dataUrl;
  previewImage.classList.add('active');
  
  document.getElementById('saveBtn').disabled = false;
  document.getElementById('copyBtn').disabled = false;
}

function clearPreview() {
  currentPreviewData = null;
  const previewImage = document.getElementById('previewImage');
  previewImage.src = '';
  previewImage.classList.remove('active');
  
  document.getElementById('saveBtn').disabled = true;
  document.getElementById('copyBtn').disabled = true;
}

async function saveImage() {
  if (!currentPreviewData) return;
  
  const result = await ipcRenderer.invoke('save-image-dialog', currentPreviewData);
  if (result.success) {
    alert(`이미지가 저장되었습니다: ${result.filePath}`);
  } else if (result.error) {
    alert(`저장 실패: ${result.error}`);
  }
}

async function copyToClipboard() {
  if (!currentPreviewData) return;
  
  await ipcRenderer.invoke('copy-to-clipboard', currentPreviewData);
  
  const copyBtn = document.getElementById('copyBtn');
  const originalText = copyBtn.textContent;
  copyBtn.textContent = '복사됨!';
  copyBtn.style.background = '#27ae60';
  
  setTimeout(() => {
    copyBtn.textContent = originalText;
    copyBtn.style.background = '';
  }, 2000);
}

async function showFixedAreaDialog() {
  const dialog = document.getElementById('fixedAreaDialog');
  dialog.style.display = 'flex';
  await updateFixedAreaInfo();
  
  const fixedArea = await ipcRenderer.invoke('get-fixed-area');
  const captureCurrentBtn = document.getElementById('captureCurrentFixedBtn');
  const setFixedAreaBtn = document.getElementById('setFixedAreaBtn');
  
  if (fixedArea) {
    captureCurrentBtn.style.display = 'block';
    setFixedAreaBtn.textContent = '새 영역 설정';
  } else {
    captureCurrentBtn.style.display = 'none';
    setFixedAreaBtn.textContent = '영역 설정';
  }
}

async function updateFixedAreaInfo() {
  const fixedArea = await ipcRenderer.invoke('get-fixed-area');
  const infoSpan = document.getElementById('fixedAreaInfo');
  
  if (fixedArea) {
    infoSpan.textContent = `${fixedArea.x}, ${fixedArea.y} - ${fixedArea.width}×${fixedArea.height}`;
  } else {
    infoSpan.textContent = '없음';
  }
}

ipcRenderer.on('capture-complete', (event, dataUrl) => {
  showPreview(dataUrl);
  loadClipboardHistory();
});

ipcRenderer.on('capture-error', (event, error) => {
  alert(`캡처 오류: ${error}`);
});

ipcRenderer.on('show-clipboard-history', () => {
  loadClipboardHistory();
  document.querySelector('.clipboard-section').scrollIntoView({ behavior: 'smooth' });
});

ipcRenderer.on('fixed-area-saved', (event, bounds) => {
  // 고정 영역이 저장되었을 때 알림
  const notification = new Notification('영역고정 설정 완료', {
    body: `고정 영역이 설정되었습니다: ${bounds.width}×${bounds.height}`,
  });
});

ipcRenderer.on('show-fixed-area-dialog', () => {
  showFixedAreaDialog();
});

ipcRenderer.on('show-window-selection', (event, windows) => {
  showWindowSelectionModal(windows);
});

ipcRenderer.on('capture-saved', (event, data) => {
  const { filePath, fileName } = data;
  
  // 성공 알림 표시
  const notification = new Notification('캡쳐 완료!', {
    body: `이미지가 저장되었습니다.\n파일: ${fileName}\n경로: Downloads/screenshot/\n\n클립보드에도 복사되었습니다.`,
    icon: null // 기본 아이콘 사용
  });
  
  // 5초 후 자동으로 알림 닫기
  setTimeout(() => {
    if (notification) {
      notification.close();
    }
  }, 5000);
  
  console.log('Image saved to:', filePath);
});

function selectAllItems() {
  const allItems = document.querySelectorAll('.history-item');
  const selectAllBtn = document.getElementById('selectAllBtn');
  
  if (selectedItems.size === allItems.length) {
    // 전체 해제
    selectedItems.clear();
    allItems.forEach(item => {
      item.classList.remove('selected');
      item.querySelector('.history-item-checkbox').checked = false;
    });
    selectAllBtn.textContent = '전체 선택';
  } else {
    // 전체 선택
    selectedItems.clear();
    allItems.forEach((item, index) => {
      selectedItems.add(index);
      item.classList.add('selected');
      item.querySelector('.history-item-checkbox').checked = true;
    });
    selectAllBtn.textContent = '전체 해제';
  }
  updateSelectedButton();
}

function updateSelectedButton() {
  const saveSelectedBtn = document.getElementById('saveSelectedBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const allItems = document.querySelectorAll('.history-item');
  
  saveSelectedBtn.disabled = selectedItems.size === 0;
  saveSelectedBtn.textContent = `선택 저장 (${selectedItems.size})`;
  
  if (selectedItems.size === allItems.length && allItems.length > 0) {
    selectAllBtn.textContent = '전체 해제';
  } else {
    selectAllBtn.textContent = '전체 선택';
  }
}

async function saveSelectedItems() {
  if (selectedItems.size === 0) return;
  
  try {
    console.log('Saving selected items:', selectedItems.size);
    
    // 메인 프로세스에서 폴더 선택 다이얼로그 열기
    const result = await ipcRenderer.invoke('select-folder-dialog');
    
    if (result.canceled) return;
    
    const folderPath = result.filePaths[0];
    console.log('Selected folder:', folderPath);
    
    let savedCount = 0;
    let failedCount = 0;
    
    // 선택된 이미지들을 순차적으로 저장
    for (const index of selectedItems) {
      if (index < clipboardHistory.length) {
        const item = clipboardHistory[index];
        const timestamp = new Date(item.timestamp).toISOString().replace(/[:.]/g, '-');
        const fileName = `selected_${timestamp}.png`;
        const filePath = `${folderPath}\\${fileName}`;
        
        console.log(`Saving item ${index}: ${fileName}`);
        
        const saveResult = await ipcRenderer.invoke('save-image', item.dataUrl, filePath);
        if (saveResult.success) {
          savedCount++;
          console.log(`Successfully saved: ${fileName}`);
        } else {
          failedCount++;
          console.error(`Failed to save: ${fileName}`, saveResult.error);
        }
      }
    }
    
    // 결과 알림
    if (failedCount > 0) {
      alert(`${savedCount}개의 이미지가 저장되었습니다.\n${failedCount}개의 이미지 저장에 실패했습니다.`);
    } else {
      alert(`${savedCount}개의 이미지가 저장되었습니다.`);
    }
    
    // 선택 초기화
    selectedItems.clear();
    document.querySelectorAll('.history-item').forEach(item => {
      item.classList.remove('selected');
      item.querySelector('.history-item-checkbox').checked = false;
    });
    updateSelectedButton();
    
  } catch (error) {
    console.error('Error in saveSelectedItems:', error);
    alert(`저장 중 오류가 발생했습니다: ${error.message}`);
  }
}

function showWindowSelectionModal(windows) {
  console.log('Showing window selection modal with', windows.length, 'windows');
  
  // 기존 모달이 있으면 제거
  const existingModal = document.getElementById('windowSelectionModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // 모달 생성
  const modal = document.createElement('div');
  modal.id = 'windowSelectionModal';
  modal.innerHTML = `
    <div class="modal-overlay" style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
    ">
      <div class="modal-content" style="
        background: white;
        padding: 20px;
        border-radius: 10px;
        max-width: 800px;
        max-height: 600px;
        overflow-y: auto;
      ">
        <h3 style="margin: 0 0 15px 0; text-align: center;">캡처할 창을 선택하세요 (${windows.length}개)</h3>
        <div class="window-grid" style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        "></div>
        <div style="text-align: center;">
          <button id="cancelWindowSelection" style="
            padding: 10px 20px;
            background: #666;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
          ">취소</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const grid = modal.querySelector('.window-grid');
  
  // 각 창에 대한 카드 생성
  windows.forEach(window => {
    const windowCard = document.createElement('div');
    windowCard.style.cssText = `
      border: 2px solid #ddd;
      border-radius: 8px;
      padding: 10px;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
      background: #f9f9f9;
    `;
    
    windowCard.innerHTML = `
      <img src="${window.thumbnail}" style="
        width: 100%;
        height: 120px;
        object-fit: cover;
        border-radius: 4px;
        margin-bottom: 8px;
      ">
      <div style="
        font-size: 14px;
        word-break: break-word;
        line-height: 1.2;
        font-weight: bold;
      ">${window.name}</div>
    `;
    
    windowCard.addEventListener('mouseover', () => {
      windowCard.style.borderColor = '#007bff';
      windowCard.style.background = '#e7f3ff';
      windowCard.style.transform = 'scale(1.02)';
    });
    
    windowCard.addEventListener('mouseout', () => {
      windowCard.style.borderColor = '#ddd';
      windowCard.style.background = '#f9f9f9';
      windowCard.style.transform = 'scale(1)';
    });
    
    windowCard.addEventListener('click', async () => {
      modal.remove();
      console.log('Capturing window:', window.name, window.id);
      await ipcRenderer.invoke('capture-window', window.id);
    });
    
    grid.appendChild(windowCard);
  });
  
  // 취소 버튼 이벤트
  modal.querySelector('#cancelWindowSelection').addEventListener('click', () => {
    modal.remove();
  });
  
  // 오버레이 클릭으로 닫기
  modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target === modal.querySelector('.modal-overlay')) {
      modal.remove();
    }
  });
}