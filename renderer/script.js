/**
 * UI & State Orchestrator for Screenshot to PDF Maker.
 * Backed by native HTML5 workflows and multi-environment fail-safes.
 */

// Application Project State
let state = {
  screenshots: [], // List of: { id, dataUrl, name, rotation: 0, width: 800, height: 600, ocrText: '', ocrStatus: 'pending' }
  zoom: 80,
  theme: 'dark',
  globalOcrEnabled: true
};

// Undo / Redo Stacks
const historyStack = [];
const redoStack = [];

// DOM Query Selectors
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');
const captureBtn = document.getElementById('captureBtn');
const fileUploadInput = document.getElementById('fileUploadInput');
const dropZone = document.getElementById('dropZone');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const countBadge = document.getElementById('countBadge');
const screenshotsList = document.getElementById('screenshotsList');
const emptyState = document.getElementById('emptyState');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const zoomLevel = document.getElementById('zoomLevel');
const liveA4Paper = document.getElementById('liveA4Paper');
const pdfPaperContent = document.getElementById('pdfPaperContent');
const pdfTotalPages = document.getElementById('pdfTotalPages');
const pdfTotalCount = document.getElementById('pdfTotalCount');
const exportPDFBtn = document.getElementById('exportPDFBtn');
const toastContainer = document.getElementById('toastContainer');

// --- Dual Environment Detection & Startup ---
const isElectron = typeof window.electronAPI !== 'undefined';

window.addEventListener('DOMContentLoaded', () => {
  // Load saved project from localStorage if it exists
  const loadedState = localStorage.getItem('screenshot_pdf_project');
  if (loadedState) {
    try {
      const parsed = JSON.parse(loadedState);
      if (Array.isArray(parsed.screenshots)) {
        state.screenshots = parsed.screenshots;
        state.theme = parsed.theme || 'dark';
        state.zoom = parsed.zoom || 80;
        state.globalOcrEnabled = parsed.globalOcrEnabled !== undefined ? parsed.globalOcrEnabled : true;
      }
    } catch (e) {
      console.warn('Failed to parse cached project:', e);
    }
  }

  // Bind Global OCR Toggle switch
  const globalOcrCheckbox = document.getElementById('globalOcrCheckbox');
  if (globalOcrCheckbox) {
    globalOcrCheckbox.checked = state.globalOcrEnabled;
    globalOcrCheckbox.addEventListener('change', (e) => {
      pushHistory();
      state.globalOcrEnabled = e.target.checked;
      
      // Update all existing screenshots to match
      state.screenshots.forEach(item => {
        item.ocrEnabled = state.globalOcrEnabled;
        if (state.globalOcrEnabled) {
          if (item.ocrStatus === 'skipped' || !item.ocrText) {
            triggerOCRTask(item.id);
          }
        } else {
          item.ocrStatus = 'skipped';
        }
      });
      
      saveStateToStorage();
      render();
      showToast(`Global OCR is now ${state.globalOcrEnabled ? 'Enabled' : 'Disabled'}`, 'info');
    });
  }

  // Set initial theme classes
  applyTheme();
  updateZoomLabel();
  
  // Register Electron Shortcut Callback
  if (isElectron) {
    window.electronAPI.onTriggerCapture(() => {
      triggerCaptureWorkflow();
    });
    window.electronAPI.onNewScreenshotCaptured((dataUrl) => {
      appendScreenshot(dataUrl, 'Captured Screenshot');
    });
  }

  render();
});

// --- Theme Toggler ---
function applyTheme() {
  if (state.theme === 'light') {
    document.body.classList.add('light-theme');
    if (sunIcon) sunIcon.classList.remove('hidden');
    if (moonIcon) moonIcon.classList.add('hidden');
  } else {
    document.body.classList.remove('light-theme');
    if (sunIcon) sunIcon.classList.add('hidden');
    if (moonIcon) moonIcon.classList.remove('hidden');
  }
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    pushHistory();
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    saveStateToStorage();
  });
}

// --- Push History Wrapper (for Undo/Redo) ---
function pushHistory() {
  // Save deep copy of list elements to undo heap
  historyStack.push(JSON.stringify(state.screenshots));
  redoStack.length = 0; // Clear redo heap on fresh commits
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = historyStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

undoBtn.addEventListener('click', () => {
  if (historyStack.length > 0) {
    redoStack.push(JSON.stringify(state.screenshots));
    state.screenshots = JSON.parse(historyStack.pop());
    updateUndoRedoButtons();
    render();
    saveStateToStorage();
    showToast('Undo operation executed', 'info');
  }
});

redoBtn.addEventListener('click', () => {
  if (redoStack.length > 0) {
    historyStack.push(JSON.stringify(state.screenshots));
    state.screenshots = JSON.parse(redoStack.pop());
    updateUndoRedoButtons();
    render();
    saveStateToStorage();
    showToast('Redo operation executed', 'info');
  }
});

// --- Auto-Save persistence ---
function saveStateToStorage() {
  localStorage.setItem('screenshot_pdf_project', JSON.stringify({
    screenshots: state.screenshots,
    theme: state.theme,
    zoom: state.zoom,
    globalOcrEnabled: state.globalOcrEnabled
  }));
}

// --- Zoom Controls ---
function updateZoomLabel() {
  zoomLevel.textContent = `${state.zoom}%`;
  liveA4Paper.style.transform = `scale(${state.zoom / 100})`;
}

zoomIn.addEventListener('click', () => {
  if (state.zoom < 150) {
    state.zoom += 10;
    updateZoomLabel();
    saveStateToStorage();
  }
});

zoomOut.addEventListener('click', () => {
  if (state.zoom > 30) {
    state.zoom -= 10;
    updateZoomLabel();
    saveStateToStorage();
  }
});

// --- Toast Alerts Provider ---
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `p-3.5 rounded-lg text-xs font-semibold shadow-lg text-white transition-all duration-300 transform translate-y-2 opacity-0 select-none flex items-center space-x-2 shrink-0 max-w-[320px] pointer-events-auto`;
  
  if (type === 'success') {
    toast.className += ' bg-emerald-600 border border-emerald-500';
  } else if (type === 'error') {
    toast.className += ' bg-rose-600 border border-rose-500';
  } else if (type === 'info') {
    toast.className += ' bg-indigo-600 border border-indigo-500';
  }

  toast.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
       <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>${message}</span>
  `;

  toastContainer.appendChild(toast);

  // Trigger entering animations
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 50);

  // Auto clean-up toast
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-[-10px]');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Screenshot Capture Workflow ---
async function triggerCaptureWorkflow() {
  if (isElectron) {
    window.electronAPI.startAreaCapture();
  } else {
    // Elegant browser-native Display Capture Fallback
    try {
      showToast('Initializing Web displays prompt...', 'info');
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" }
      });
      
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      video.onloadedmetadata = () => {
        setTimeout(() => {
          // Draw standard frame on canvas to capture screenshot
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const dataUrl = canvas.toDataURL('image/jpeg');
          appendScreenshot(dataUrl, 'Captured Snippet');
          
          // Terminate capture thread gracefully
          stream.getTracks().forEach(track => track.stop());
        }, 300);
      };
    } catch (e) {
      console.warn('Display access declined or unsupported:', e);
      showToast('Capture aborted / blocked by browser permissions', 'error');
    }
  }
}

captureBtn.addEventListener('click', () => {
  triggerCaptureWorkflow();
});

// --- Upload Workflow ---
if (dropZone) {
  dropZone.addEventListener('click', () => {
    fileUploadInput.click();
  });
}

fileUploadInput.addEventListener('change', (e) => {
  handleFilesSelection(e.target.files);
});

// --- Drag & Drop Core Event Handlers ---
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-indigo-500', 'bg-indigo-500/5');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-indigo-500', 'bg-indigo-500/5');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-indigo-500', 'bg-indigo-500/5');
  if (e.dataTransfer.files) {
    handleFilesSelection(e.dataTransfer.files);
  }
});

function handleFilesSelection(files) {
  if (!files || files.length === 0) return;
  
  let validFilesCount = 0;
  pushHistory();

  Array.from(files).forEach((file) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast(`Unsupported file type: ${file.name}`, 'error');
      return;
    }

    validFilesCount++;
    const reader = new FileReader();
    reader.onload = (event) => {
      appendScreenshot(event.target.result, file.name || 'Uploaded Document');
    };
    reader.readAsDataURL(file);
  });

  if (validFilesCount > 0) {
    fileUploadInput.value = ''; // Reset input selection cache
  }
}

// --- Append New Screenshot item to List ---
function appendScreenshot(dataUrl, filename) {
  // Create an Image node to resolve initial dims
  const img = new Image();
  img.src = dataUrl;
  img.onload = async () => {
    // Save to physical temporary folder
    const tempSaveRes = await window.electronAPI.saveTempImage(dataUrl);

    const newItem = {
      id: 'shot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      dataUrl: dataUrl,
      filePath: tempSaveRes.success ? tempSaveRes.filePath : '',
      name: filename.split('.')[0] || 'Unlabeled Snippet',
      rotation: 0,
      width: img.naturalWidth || 800,
      height: img.naturalHeight || 600,
      scale: 100,
      ocrEnabled: state.globalOcrEnabled,
      ocrText: '',
      ocrStatus: 'pending'
    };

    state.screenshots.push(newItem);
    showToast(`Added: ${newItem.name}`);
    
    // Automatically trigger background local OCR
    triggerOCRTask(newItem.id);
    
    render();
    saveStateToStorage();
  };
}

// --- Background Tesseract OCR Task ---
function triggerOCRTask(itemId) {
  const idx = state.screenshots.findIndex(s => s.id === itemId);
  if (idx === -1) return;

  if (state.screenshots[idx].ocrEnabled === false) {
    state.screenshots[idx].ocrStatus = 'skipped';
    state.screenshots[idx].ocrText = '';
    renderListOnly();
    return;
  }

  state.screenshots[idx].ocrStatus = 'processing';
  renderListOnly(); // Refresh list to show running spinner state

  // Invoke standalone OCR engine (supports English and Hindi)
  if (typeof Tesseract !== 'undefined') {
    Tesseract.recognize(
      state.screenshots[idx].dataUrl,
      'eng+hin',
      {
        logger: m => {
          if (m && m.status === 'recognizing') {
            const pct = Math.floor(m.progress * 100);
            updateOCRProgressInUI(itemId, pct);
          }
        }
      }
    ).then(({ data: { text } }) => {
      const liveIdx = state.screenshots.findIndex(s => s.id === itemId);
      if (liveIdx !== -1) {
        state.screenshots[liveIdx].ocrText = text || '';
        state.screenshots[liveIdx].ocrStatus = 'complete';
        renderListOnly();
        renderA4PaperRepresentation();
        saveStateToStorage();
        showToast(`OCR Completed for '${state.screenshots[liveIdx].name}'`, 'info');
      }
    }).catch(err => {
      console.error('Tesseract OCR engine error:', err);
      const liveIdx = state.screenshots.findIndex(s => s.id === itemId);
      if (liveIdx !== -1) {
        state.screenshots[liveIdx].ocrStatus = 'failed';
        renderListOnly();
      }
    });
  } else {
    // If CDN fails, write a silent offline placeholder text layer
    state.screenshots[idx].ocrStatus = 'failed';
    renderListOnly();
  }
}

function updateOCRProgressInUI(itemId, pct) {
  const pctTag = document.getElementById(`ocrPercent_${itemId}`);
  if (pctTag) {
    pctTag.textContent = `${pct}%`;
  }
}

// --- Action Controls on Specific screenshot cards ---
async function deleteScreenshot(id) {
  pushHistory();
  const item = state.screenshots.find(s => s.id === id);
  if (item && item.filePath) {
    await window.electronAPI.deleteTempImage(item.filePath);
  }
  state.screenshots = state.screenshots.filter(s => s.id !== id);
  render();
  saveStateToStorage();
  showToast('Screenshot removed', 'info');
}

/**
 * Rotate Screenshot by baking the rotation into a canvas
 * This ensures the exported PDF respects the orientation
 */
function rotateScreenshot(id) {
  pushHistory();
  const index = state.screenshots.findIndex(s => s.id === id);
  if (index === -1) return;

  const item = state.screenshots[index];
  const originalImg = new Image();
  originalImg.src = item.dataUrl;
  
  originalImg.onload = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Switch width and height for 90/270 degrees rotation
    canvas.width = originalImg.naturalHeight;
    canvas.height = originalImg.naturalWidth;
    
    // Perform rotation transformation around the canvas center
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(90 * Math.PI / 180);
    ctx.drawImage(originalImg, -originalImg.naturalWidth / 2, -originalImg.naturalHeight / 2);
    
    // Save back high quality representation
    item.dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    
    // Update structural dimensions
    item.width = canvas.width;
    item.height = canvas.height;
    
    showToast(`Rotated: ${item.name} clockwise`);
    
    // Re-trigger OCR on the rotated text for enhanced layout matching
    triggerOCRTask(id);
    
    render();
    saveStateToStorage();
  };
}

function updateScreenshotName(id, newName) {
  const index = state.screenshots.findIndex(s => s.id === id);
  if (index !== -1 && newName && newName.trim().length > 0) {
    state.screenshots[index].name = newName;
    saveStateToStorage();
    renderA4PaperRepresentation();
  }
}

function updateScreenshotOCRContent(id, newOCRText) {
  const index = state.screenshots.findIndex(s => s.id === id);
  if (index !== -1) {
    state.screenshots[index].ocrText = newOCRText;
    saveStateToStorage();
    renderA4PaperRepresentation();
  }
}

function updateScreenshotScale(id, newScale) {
  const index = state.screenshots.findIndex(s => s.id === id);
  if (index !== -1) {
    const scaleVal = parseInt(newScale, 10) || 100;
    state.screenshots[index].scale = scaleVal;
    
    // Live update the label text on the slider
    const cardEl = document.querySelector(`[data-id="${id}"]`);
    if (cardEl) {
      const label = cardEl.querySelector('.scale-value-label');
      if (label) {
        label.textContent = `${scaleVal}%`;
      }
    }
    
    renderA4PaperRepresentation();
  }
}

function updateScreenshotScaleFinished(id, newScale) {
  pushHistory();
  saveStateToStorage();
}

function toggleCardOcr(id) {
  const index = state.screenshots.findIndex(s => s.id === id);
  if (index === -1) return;
  
  pushHistory();
  const currentVal = state.screenshots[index].ocrEnabled !== false;
  const newVal = !currentVal;
  state.screenshots[index].ocrEnabled = newVal;
  
  if (newVal) {
    if (state.screenshots[index].ocrStatus === 'skipped' || !state.screenshots[index].ocrText) {
      triggerOCRTask(id);
    }
  } else {
    state.screenshots[index].ocrStatus = 'skipped';
  }
  
  render();
  saveStateToStorage();
}

window.updateScreenshotScale = updateScreenshotScale;
window.updateScreenshotScaleFinished = updateScreenshotScaleFinished;
window.toggleCardOcr = toggleCardOcr;

// --- Drag & Drop Sorting Mechanics (List Items) ---
let dragSourceId = null;

function handleDragStart(e) {
  dragSourceId = e.target.getAttribute('data-id');
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  const targetLI = e.target.closest('[draggable="true"]');
  if (targetLI) {
    targetLI.classList.add('border-indigo-500');
  }
}

function handleDragLeave(e) {
  const targetLI = e.target.closest('[draggable="true"]');
  if (targetLI) {
    targetLI.classList.remove('border-indigo-500');
  }
}

function handleDrop(e) {
  e.preventDefault();
  const targetLI = e.target.closest('[draggable="true"]');
  if (targetLI) {
    targetLI.classList.remove('border-indigo-500');
    const targetId = targetLI.getAttribute('data-id');
    
    if (dragSourceId && targetId && dragSourceId !== targetId) {
      pushHistory();
      
      const sourceIdx = state.screenshots.findIndex(s => s.id === dragSourceId);
      const targetIdx = state.screenshots.findIndex(s => s.id === targetId);
      
      if (sourceIdx !== -1 && targetIdx !== -1) {
        const itemToMove = state.screenshots.splice(sourceIdx, 1)[0];
        state.screenshots.splice(targetIdx, 0, itemToMove);
        
        render();
        saveStateToStorage();
        showToast('List sequence updated', 'info');
      }
    }
  }
  
  // Clean up dragging visual styles
  const allDraggables = document.querySelectorAll('#screenshotsList > div');
  allDraggables.forEach(div => div.classList.remove('dragging'));
}

// Clear all active project records
clearAllBtn.addEventListener('click', async () => {
  if (state.screenshots.length === 0) return;
  
  if (confirm('Are you sure you want to delete all screenshots in the current project stack?')) {
    pushHistory();
    await window.electronAPI.clearTempDir();
    state.screenshots = [];
    render();
    saveStateToStorage();
    showToast('Project cleared', 'info');
  }
});

// --- RENDER PIPELINE ---
function render() {
  renderListOnly();
  renderA4PaperRepresentation();
  updateUndoRedoButtons();
  updateGlobalOcrToggleBtnStyle();
}

function updateGlobalOcrToggleBtnStyle() {
  const checkbox = document.getElementById('globalOcrCheckbox');
  if (checkbox) {
    checkbox.checked = state.globalOcrEnabled;
  }
}

// Render left workspace items list
function renderListOnly() {
  const count = state.screenshots.length;
  countBadge.textContent = count;
  pdfTotalCount.textContent = count;

  // Toggle empty states
  if (count === 0) {
    emptyState.classList.remove('hidden');
    clearAllBtn.classList.add('opacity-40', 'pointer-events-none');
    exportPDFBtn.disabled = true;
  } else {
    emptyState.classList.add('hidden');
    clearAllBtn.classList.remove('opacity-40', 'pointer-events-none');
    exportPDFBtn.disabled = false;
  }

  // Preserve list nodes and flush
  const existingItems = Array.from(screenshotsList.querySelectorAll('.screenshot-item-card'));
  existingItems.forEach(el => el.remove());

  state.screenshots.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `screenshot-item-card group bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-start space-x-4 transition hover:border-indigo-500/50 hover:shadow-lg relative cursor-grab`;
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', item.id);
    
    // Bind HTML5 drag channels
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);

    // Setup OCR badge
    let ocrBadgeMarkup = '';
    let copyButtonMarkup = '';
    if (item.ocrStatus === 'skipped') {
      ocrBadgeMarkup = `<span class="text-[10px] text-slate-500 bg-slate-900 border border-slate-800 py-0.5 px-2 rounded-full">OCR Disabled</span>`;
    } else if (item.ocrStatus === 'pending') {
      ocrBadgeMarkup = `<span class="text-[10px] text-slate-500 bg-slate-900 border border-slate-800 py-0.5 px-2 rounded-full">OCR Idle</span>`;
    } else if (item.ocrStatus === 'processing') {
      ocrBadgeMarkup = `
        <span class="text-[10px] text-indigo-400 bg-indigo-950/40 border border-indigo-900/60 py-0.5 px-2 rounded-full flex items-center space-x-1">
          <svg class="animate-spin h-2.5 w-2.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          <span id="ocrPercent_${item.id}">Recognizing...</span>
        </span>
      `;
    } else if (item.ocrStatus === 'complete') {
      ocrBadgeMarkup = `<span class="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 py-0.5 px-2 rounded-full">OCR Searchable</span>`;
      copyButtonMarkup = `
        <button class="text-[10px] text-indigo-400 hover:text-indigo-300 bg-indigo-950/20 border border-indigo-900/50 py-0.5 px-2.5 rounded-full cursor-pointer transition select-none flex items-center space-x-1 active:scale-95" onclick="copyCardOCRText('${item.id}'); event.stopPropagation();" title="Copy extracted text to clipboard">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          <span>Copy OCR</span>
        </button>
      `;
    } else {
      ocrBadgeMarkup = `<span class="text-[10px] text-rose-400 bg-rose-950/40 border border-rose-900/60 py-0.5 px-2 rounded-full">OCR Offline</span>`;
    }

    card.innerHTML = `
      <!-- Index Marker -->
      <div class="absolute top-3 left-3 h-5 w-5 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-mono font-bold text-slate-400 select-none">
        ${index + 1}
      </div>

      <!-- Thumbnail image pane -->
      <div class="w-24 h-20 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center relative select-none shrink-0 mt-3">
        <img src="${item.dataUrl}" class="max-w-full max-h-full object-contain" alt="Thumbnail">
      </div>

      <!-- Settings panel -->
      <div class="flex-1 min-w-0 pr-6 mt-3">
        <input type="text" value="${item.name}" class="text-sm font-semibold text-slate-200 bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none w-full pb-0.5 mb-1" placeholder="Add custom label..." onblur="updateScreenshotName('${item.id}', this.value)" title="Click to rename document anchor">
        
        <div class="flex items-center space-x-2 mt-1.5 flex-wrap gap-y-1">
          ${ocrBadgeMarkup}
          ${copyButtonMarkup}
          <span class="text-[10px] text-slate-500 font-mono">${item.width}x${item.height}px</span>
        </div>

        <!-- Image Scaling/Size Control -->
        <div class="mt-2.5 flex items-center space-x-2 text-xs">
          <span class="text-slate-400 font-medium text-[10px] uppercase tracking-wider">Size:</span>
          <input type="range" min="10" max="100" step="5" value="${item.scale || 100}" 
                 class="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none" 
                 oninput="updateScreenshotScale('${item.id}', this.value)" 
                 onchange="updateScreenshotScaleFinished('${item.id}', this.value)">
          <span class="text-slate-300 font-mono text-[10px] w-10 text-right scale-value-label font-semibold">${item.scale || 100}%</span>
        </div>

        <!-- OCR PlainText Input for correction -->
        <div class="mt-2 text-xs">
          <textarea class="w-full bg-slate-950 border border-slate-800 rounded p-1 text-[11px] font-mono text-slate-400 focus:outline-none focus:border-indigo-600 focus:text-slate-200 placeholder-slate-700 h-10 resize-none leading-relaxed" placeholder="Extracted OCR text layer..." onchange="updateScreenshotOCRContent('${item.id}', this.value)">${item.ocrText}</textarea>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="absolute top-3 right-3 flex items-center space-x-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition duration-150">
        <!-- OCR Toggle Switch -->
        <label class="relative inline-flex items-center cursor-pointer mr-1" title="${item.ocrEnabled !== false ? 'OCR Enabled (Click to Disable)' : 'OCR Disabled (Click to Enable)'}" onclick="event.stopPropagation();">
          <input type="checkbox" class="sr-only peer" ${item.ocrEnabled !== false ? 'checked' : ''} onchange="toggleCardOcr('${item.id}')">
          <div class="w-9 h-5 bg-slate-800 rounded-full peer peer-checked:bg-emerald-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-500 after:border-slate-400 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-white"></div>
        </label>
        <!-- Rotate Button -->
        <button class="p-1.5 bg-slate-900 text-slate-400 hover:text-indigo-400 rounded-lg border border-slate-800 hover:border-indigo-900/50 transition cursor-pointer" onclick="rotateScreenshot('${item.id}'); event.stopPropagation();" title="Rotate Screenshot 90deg CW">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 19v-5h-5.21M12 21a9 9 0 009-9H3a9 9 0 009 9z" />
          </svg>
        </button>
        <!-- Delete Button -->
        <button class="p-1.5 bg-slate-900 text-slate-400 hover:text-rose-400 rounded-lg border border-slate-800 hover:border-rose-900/50 transition cursor-pointer" onclick="deleteScreenshot('${item.id}'); event.stopPropagation();" title="Delete Screenshot">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    `;

    screenshotsList.appendChild(card);
  });
}

// Render right A4 mockup representation based on scale and margins
function renderA4PaperRepresentation() {
  const contentNode = document.getElementById('pdfPaperContent');
  
  // Clear preview block
  contentNode.innerHTML = '';

  if (state.screenshots.length === 0) {
    contentNode.innerHTML = `
      <div id="paperEmptyPlaceholder" class="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400 py-32">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p class="text-xs text-slate-400 leading-relaxed font-sans">Active paper is currently blank.</p>
        <p class="text-[10px] text-slate-400 mt-1 max-w-[200px]">Added screen segments are automatically placed here conforming to strict margin rules.</p>
      </div>
    `;
    pdfTotalPages.textContent = '1';
    return;
  }

  // Simple layout calculation to display page cuts visually
  const a4WidthPt = 555; // 595.28 - 2*20 Margin width
  const pageHeightLimitPt = 801.89; // Max height for image on page
  
  let currentY = 0;
  let simulatedPages = 1;

  state.screenshots.forEach((item, index) => {
    // Width ratio taking account of user scale
    const scale = (item.scale || 100) / 100;
    const imgRatio = item.height / item.width;
    const scaledW = a4WidthPt * scale;
    const scaledH = a4WidthPt * imgRatio * scale;

    // Check boundary
    if (index > 0 && currentY + scaledH > pageHeightLimitPt) {
      simulatedPages++;
      currentY = 0;

      // Render a horizontal dashed separator for multi-page cut visualize
      const pageCut = document.createElement('div');
      pageCut.className = 'w-full border-t-2 border-dashed border-rose-500 py-2 relative flex items-center justify-center';
      pageCut.innerHTML = `<span class="bg-rose-500 text-white font-semibold text-[9px] px-2 py-0.5 rounded-full uppercase absolute transform translate-y-[-1px]">PDF Page Break (${simulatedPages - 1} &rarr; ${simulatedPages})</span>`;
      contentNode.appendChild(pageCut);
    }

    // Append picture block container
    const wrapper = document.createElement('div');
    wrapper.className = 'w-full py-2 flex flex-col items-center relative';
    
    const imgEl = document.createElement('img');
    imgEl.src = item.dataUrl;
    imgEl.className = 'border border-slate-300 rounded shadow-sm max-h-[800px] object-contain transition-transform';
    imgEl.style.width = `${item.scale || 100}%`;
    
    wrapper.appendChild(imgEl);

    // If searchable text is embedded and enabled, overlay a tiny selector visual badge
    if (item.ocrEnabled !== false && item.ocrText && item.ocrText.trim().length > 0) {
      const textOverlay = document.createElement('div');
      textOverlay.className = 'text-left mt-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded text-[9px] font-mono whitespace-pre-wrap select-all leading-normal';
      textOverlay.style.width = `${item.scale || 100}%`;
      textOverlay.textContent = `Searchable Text Layer: "${item.ocrText.substring(0, 200)}${item.ocrText.length > 200 ? '...' : ''}"`;
      wrapper.appendChild(textOverlay);
    }

    contentNode.appendChild(wrapper);
    currentY += scaledH + 20; // Include A4 margins and gapspacing
  });

  pdfTotalPages.textContent = simulatedPages;
}

// --- PDF Compilation Trigger & Export ---
// --- PDF Compilation Trigger & Export ---
const exportModal = document.getElementById('exportModal');
const exportModalContent = document.getElementById('exportModalContent');
const pdfFilenameInput = document.getElementById('pdfFilenameInput');
const closeExportModalBtn = document.getElementById('closeExportModalBtn');
const confirmExportBtn = document.getElementById('confirmExportBtn');

function showExportModal() {
  if (state.screenshots.length === 0) return;
  
  const pad = (n) => n.toString().padStart(2, '0');
  const d = new Date();
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  pdfFilenameInput.value = `screenshot_database_${dateStr}.pdf`;
  
  exportModal.classList.remove('hidden');
  setTimeout(() => {
    exportModalContent.classList.remove('scale-95', 'opacity-0');
    exportModalContent.classList.add('scale-100', 'opacity-100');
  }, 10);
}

function hideExportModal() {
  exportModalContent.classList.remove('scale-100', 'opacity-100');
  exportModalContent.classList.add('scale-95', 'opacity-0');
  setTimeout(() => {
    exportModal.classList.add('hidden');
  }, 200);
}

if (closeExportModalBtn) {
  closeExportModalBtn.addEventListener('click', hideExportModal);
}

if (exportModal) {
  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) {
      hideExportModal();
    }
  });
}

exportPDFBtn.addEventListener('click', () => {
  showExportModal();
});

if (confirmExportBtn) {
  confirmExportBtn.addEventListener('click', async () => {
    let filename = pdfFilenameInput.value.trim();
    if (!filename) {
      showToast('Please enter a valid filename', 'error');
      return;
    }
    
    if (!filename.toLowerCase().endsWith('.pdf')) {
      filename += '.pdf';
    }
    
    hideExportModal();
    
    exportPDFBtn.disabled = true;
    const originalLabel = exportPDFBtn.innerHTML;
    exportPDFBtn.innerHTML = `
      <svg class="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
      <span>Generating PDF...</span>
    `;

    try {
      const dataUri = await window.pdfManager.generateCompilationPDF(state.screenshots);

      if (isElectron) {
        const saveResponse = await window.electronAPI.savePDF(dataUri, filename);
        if (saveResponse && saveResponse.success) {
          showToast(`PDF saved to Documents folder successfully!`);
        } else {
          showToast(`Save failed: ${saveResponse.error || 'Disk Error'}`, 'error');
        }
      } else {
        const byteCharacters = atob(dataUri.split(',')[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const pdfBlob = new Blob([byteArray], { type: 'application/pdf' });
        
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(pdfBlob);
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        showToast('PDF compiled successfully! Check browser downloads.');
      }
    } catch (error) {
      console.error('PDF compiling failure:', error);
      showToast(`Failed to build PDF: ${error.message}`, 'error');
    } finally {
      exportPDFBtn.innerHTML = originalLabel;
      exportPDFBtn.disabled = false;
    }
  });
}

// Global copy OCR handler
window.copyCardOCRText = function(id) {
  const item = state.screenshots.find(s => s.id === id);
  if (item && item.ocrText) {
    navigator.clipboard.writeText(item.ocrText);
    showToast('Extracted OCR text copied to clipboard!');
  } else {
    showToast('No OCR text layer available to copy', 'error');
  }
};

// Bind Create New PDF button
const createNewPDFBtn = document.getElementById('createNewPDFBtn');
if (createNewPDFBtn) {
  createNewPDFBtn.addEventListener('click', async () => {
    if (state.screenshots.length === 0 || confirm('Initialize a new PDF? This will clear all screenshots in your active workspace.')) {
      pushHistory();
      await window.electronAPI.clearTempDir();
      state.screenshots = [];
      render();
      saveStateToStorage();
      showToast('Workspace cleared. Started a new PDF compilation.', 'info');
    }
  });
}

// Bind Save PDF button
const savePDFBtn = document.getElementById('savePDFBtn');
if (savePDFBtn) {
  savePDFBtn.addEventListener('click', () => {
    exportPDFBtn.click();
  });
}

// Bind Open PDF Folder button
const openPDFFolderBtn = document.getElementById('openPDFFolderBtn');
if (openPDFFolderBtn) {
  openPDFFolderBtn.addEventListener('click', async () => {
    const res = await window.electronAPI.openPDFFolder();
    if (res && res.success) {
      showToast('Opened saved PDFs folder');
    } else {
      showToast(`Could not open folder: ${res ? res.error : 'Unknown error'}`, 'error');
    }
  });
}

// Bind Open Existing PDF button
const pdfImportInput = document.getElementById('pdfImportInput');
const openExistingPDFBtn = document.getElementById('openExistingPDFBtn');
if (openExistingPDFBtn && pdfImportInput) {
  openExistingPDFBtn.addEventListener('click', () => {
    pdfImportInput.click();
  });

  pdfImportInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('Opening and rendering PDF...', 'info');

    const reader = new FileReader();
    reader.onload = async function (event) {
      try {
        const typedarray = new Uint8Array(event.target.result);

        if (typeof pdfjsLib !== 'undefined') {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

          const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
          pushHistory();

          let pageCount = 0;
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            const tempSaveRes = await window.electronAPI.saveTempImage(dataUrl);

            const newItem = {
              id: 'shot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5) + '_' + pageNum,
              dataUrl: dataUrl,
              filePath: tempSaveRes.success ? tempSaveRes.filePath : '',
              name: `Imported Page ${pageNum}`,
              rotation: 0,
              width: viewport.width,
              height: viewport.height,
              scale: 100,
              ocrEnabled: state.globalOcrEnabled,
              ocrText: '',
              ocrStatus: 'pending'
            };

            state.screenshots.push(newItem);
            pageCount++;

            // Auto trigger OCR scanning
            triggerOCRTask(newItem.id);
          }

          render();
          saveStateToStorage();
          showToast(`Imported ${pageCount} pages successfully!`);
        } else {
          showToast('PDF.js library could not be loaded from CDN', 'error');
        }
      } catch (error) {
        console.error('Failed to parse existing PDF:', error);
        showToast(`Failed to parse PDF: ${error.message}`, 'error');
      } finally {
        pdfImportInput.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
